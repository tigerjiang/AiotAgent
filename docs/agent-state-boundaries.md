# Agent State 边界说明

## 目标

在允许 LLM 提出受约束 plan 的同时，把身份、可信设备状态、审批、验证和副作用都保留在应用代码控制之下。

## 字段归属

| 字段 | 可信写入方 | LLM 访问方式 |
|---|---|---|
| `input` | 已认证的 API 代码 | 只读 |
| `deviceState` | reported-state 投影 | 只读 |
| `plan` | planner 候选输出和 validator | 只能提出候选 |
| `approval` | approval store 和 API 服务 | 不可访问 |
| `errors` | validator、工具和系统节点 | 只读 |
| `output` | 验证后的响应节点 | 只能提供候选文本 |

## 文件职责

| 文件 | 职责 |
|---|---|
| `src/agent/agent-state.ts` | 定义 AgentState 的 Zod schema 和 TypeScript 类型 |
| `src/agent/agent-state-transitions.ts` | 提供创建状态、挂载可信设备状态、替换 plan、写入审批结果的状态转换入口 |
| `src/agent/agent-state-validator.ts` | 将完整 AgentState 转换为执行决策，本身不执行副作用 |
| `test/agent-state.test.ts` | 覆盖身份、可信状态、审批和 forbidden tool arguments 等安全边界 |

## 安全规则

1. LLM 永远不能替换完整的 `AgentState`。
2. `tenantId`、`userId`、`deviceId` 来自已认证的应用上下文。
3. MQTT reported state 只能通过 Day 14 的可信投影进入 AgentState。
4. 工具参数不能包含 `confirmed`、`approvalId`、身份字段或 requestId。
5. 只读工具可以不经过用户审批。
6. 写工具必须同时具备可信设备状态和应用代码持有的审批结果。
7. Validator 只返回执行决策，不执行任何副作用。
8. Device tools 和 gateway 是设备变更的唯一路径。

```text
receive_input
  -> read_trusted_state
  -> validate_state
  -> build_response
```

## Schema 加固说明

`AgentStateSchema` 使用 `input` 作为请求身份和用户文本的唯一字段。这个字段名必须和 `createInitialAgentState` 保持一致；如果误写成 `intput`，合法状态会解析失败，同时真正的 `input` 会被 strict schema 识别为未知字段。

`AgentInputSchema` 必须使用 `.strict()`。Zod 默认会丢弃 object 上的未知字段，如果不 strict，调用方传入 `isAdmin`、`role` 或替代身份提示时，schema 会静默丢弃这些字段而不是报错。边界处直接拒绝这些字段，可以明确保证身份和授权只来自已认证的应用代码，而不是 planner 输入或用户提供的 JSON。

`test/agent-state.test.ts` 中的关键用例：

- `creates a minimal initial state` 验证标准 `input` 字段会被保留。
- `rejects extra identity input fields` 验证注入身份或授权字段会在创建初始状态时抛错。

## 状态转换行为

`createInitialAgentState` 是请求身份和用户文本进入 AgentState 的入口。它会先解析原始 input，因此额外字段会在 planner 看到之前被拒绝。

`attachTrustedDeviceState` 只接受 reported-state 投影产生的 `TrustedReportedStateSnapshot`。这让设备状态和用户文本、工具参数、模型输出保持隔离。

`setCandidatePlan` 会解析候选 plan，并重置 approval、errors 和 output。这样可以避免旧审批或旧验证结果意外沿用到新的 plan 上。

`setApprovalState` 会先解析 approval store 的输出，再写入 AgentState。审批是应用工作流结果，不是 planner 可以直接提供的值。

## 执行验证

`validateAgentStateForExecution` 故意保持无副作用。它只返回三类决策：

- `ready`：plan 可以立即执行。
- `approval_required`：plan 包含写工具，需要应用审批。
- `rejected`：state 或 plan 违反执行边界。

validator 会在执行边界重新解析完整 state，检查 plan 是否存在，拒绝工具参数中的系统字段，要求写 plan 必须有可信设备状态，并要求写操作在执行前具备应用审批。

当前只读工具只有 `get_device_state`。任何未列入只读集合的新工具都会默认按写工具处理，因此新增工具会自动进入更严格的审批路径。
