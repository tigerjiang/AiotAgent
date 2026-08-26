# Day 12：设备操作审批 HTTP API 实现说明

## 目标

Day 12 将第 11 天的 `start_cooking` 审批流程暴露成 App 可调用的 HTTP API，同时保持三个安全边界：

- 用户和设备身份只能来自服务端认证上下文。
- 提议请求不会直接执行设备操作。
- 决策请求只能批准或拒绝服务端已经保存的原始操作，不能重新提交参数。

## API

### 创建操作提议

```http
POST /v1/device-actions
Authorization: Bearer local-user-a
Content-Type: application/json

{
  "message": "把烤炉设置为 225°F，烹饪 120 分钟"
}
```

请求 Body 使用严格 Schema，只允许 `message`。`actorId`、`deviceId`、`deviceType` 等额外字段会导致 `400 INVALID_REQUEST`。

成功后返回待确认操作：

```json
{
  "status": "approval_required",
  "approvalId": "f2f7ac17-7a25-4be7-9300-79ec72bd37da",
  "expiresAt": "2026-08-19T00:05:00.000Z",
  "action": {
    "toolName": "start_cooking",
    "arguments": {
      "temperatureFahrenheit": 225,
      "durationMinutes": 120,
      "probeTargetFahrenheit": null
    }
  }
}
```

### 处理审批决定

```http
POST /v1/device-actions/:approvalId/decision
Authorization: Bearer local-user-a
Content-Type: application/json

{
  "decision": "approve"
}
```

Body 只能包含 `decision: "approve" | "reject"`。执行参数从服务端审批记录读取，因此 App 不能在确认阶段修改温度、时长或 `confirmed`。

## 调用链

```text
App 自然语言
  -> Fastify 严格校验 Body
  -> authenticate 生成 VerifiedDeviceContext
  -> DeviceActionApiService 适配认证上下文
  -> proposeStartCooking 创建并保存审批
  -> App 展示操作预览
  -> App 提交 approvalId 与 decision
  -> 服务端重新认证并校验审批所有权、状态和有效期
  -> resolveStartCooking 原子 claim 审批
  -> 以 confirmed: true 执行服务端保存的工具参数
  -> 返回真实设备执行结果
```

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/api/device-action-routes.ts` | 定义请求 Schema、认证边界、路由及 HTTP 状态码映射 |
| `src/api/build-app.ts` | 装配 Fastify 与路由，保持应用可通过 `inject` 测试 |
| `src/api/create-device-action-service.ts` | 将 HTTP 服务契约适配到审批 Agent，并固定 `confirmed: false` |
| `src/agent/start-cooking-approval-agent.ts` | 创建审批、处理决定、执行工具并续接模型结果 |
| `src/approval/in-memory-approval-store.ts` | 保存审批及维护状态机，绑定用户和设备 |
| `src/server.ts` | 创建共享依赖、提供本地认证替身并监听端口 |
| `test/device-action-routes.test.ts` | 验证请求边界、认证上下文和跨用户审批隔离 |

## 审批状态机

```text
pending -> executing -> executed
                     -> failed
pending -> rejected
pending -> expired
```

`claim` 在任何异步设备调用之前同步把状态从 `pending` 改为 `executing`，从而阻止并发确认或客户端重试导致重复执行。已执行、已拒绝、已过期或执行中的审批都不能再次领取。

审批同时绑定 `actorId` 和 `deviceId`。不匹配时统一返回 `APPROVAL_NOT_FOUND`，避免向其他用户泄露某个 `approvalId` 是否真实存在。

## HTTP 状态码

| 业务结果 | HTTP 状态码 | 说明 |
| --- | ---: | --- |
| `INVALID_REQUEST` | 400 | Body、路径参数或额外字段不合法 |
| `UNAUTHORIZED` | 401 | 缺少或未通过认证 |
| `APPROVAL_NOT_FOUND` | 404 | 审批不存在，或不属于当前用户/设备 |
| `APPROVAL_ALREADY_RESOLVED` | 409 | 审批已经被处理或正在执行 |
| `APPROVAL_NOT_PENDING` | 409 | 无法拒绝非 pending 审批 |
| `APPROVAL_EXPIRED` | 410 | 审批已超过有效期 |

## 本地运行

配置 `OPENAI_API_KEY`，然后运行：

```bash
npm run dev
```

本地入口仅接受演示 Token：

```text
Authorization: Bearer local-user-a
```

该认证逻辑不能直接用于生产。生产环境应验证 JWT 签名、Session 或 API Gateway 上下文，并校验用户是否有权操作目标设备。

## 验证

```bash
npm run typecheck
npm test
```

路由测试覆盖：Body 不能选择设备、认证上下文正确传递、未认证请求被拒绝、确认请求不能修改参数，以及其他用户不能消费已创建的审批。
