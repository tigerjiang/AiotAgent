这个类可以把它理解成一个“审批保险箱 + 状态机”。

它不负责启动设备，只负责保存一条待审批操作，并确保这条操作：

- 只能由对应设备处理
- 只能成功处理一次
- 过期后不能执行
- 拒绝后不能再批准
- 并发批准时不会重复执行

文件：[in-memory-approval-store.ts](/Users/jiangzehu/work/AiotAgent/src/approval/in-memory-approval-store.ts)

## 1. 它保存的是什么？

每次模型提出启动烹饪后，系统都会创建一个 `PendingDeviceAction`：

```ts
export interface PendingDeviceAction {
    approvalId: string;
    deviceId: string;
    deviceType: string;
    toolName: "start_cooking";
    arguments: Record<string, unknown>;
    callId: string;
    continuationInput: unknown[];
    createdAt: string;
    expiresAt: string;
    status: ApprovalStatus;
}
```

例如：

```ts
{
    approvalId: "approval-abc",
    deviceId: "oven-001",
    deviceType: "convection_oven",
    toolName: "start_cooking",
    arguments: {
        temperatureFahrenheit: 375,
        durationMinutes: 30,
        probeTargetFahrenheit: null
    },
    callId: "call-start-cooking",
    continuationInput: [/* 模型上下文 */],
    createdAt: "2026-08-17T00:00:00.000Z",
    expiresAt: "2026-08-17T00:05:00.000Z",
    status: "pending"
}
```

这里最重要的是：客户端只拿到 `approvalId`，真正的工具名和参数都保存在服务端。

用户确认时，大致只需要发送：

```ts
{
    approvalId: "approval-abc",
    decision: "approve"
}
```

客户端不需要、也不应该再次提交：

```ts
{
    temperatureFahrenheit: 500
}
```

否则客户端可能在确认阶段偷偷替换原来展示给用户的参数。

## 2. 审批有哪些状态？

```ts
export type ApprovalStatus =
    | "pending"
    | "executing"
    | "executed"
    | "rejected"
    | "expired"
    | "failed";
```

状态转换可以理解为：

```text
                    ┌→ executed
pending → executing ┤
   │                └→ failed
   │
   ├→ rejected
   │
   └→ expired
```

各状态含义：

| 状态 | 含义 |
|---|---|
| `pending` | 等待用户确认 |
| `executing` | 已有人取得执行权，设备调用正在进行 |
| `executed` | 设备执行成功 |
| `failed` | 设备执行过，但失败了 |
| `rejected` | 用户取消 |
| `expired` | 审批超过有效期 |

只有 `pending` 可以进入下一步。

其余状态都不能再次批准或拒绝。

## 3. `items` 是什么？

```ts
private readonly items =
    new Map<string, PendingDeviceAction>();
```

它是内存中的审批记录表：

```text
approvalId      PendingDeviceAction
-----------------------------------------
abc-123      -> 等待启动 oven-001
def-456      -> 等待启动 grill-002
```

相当于一个非常简化的数据库：

```ts
items.get(approvalId);
items.set(approvalId, action);
```

这里的“内存”意味着：

- 服务重启后数据会消失
- 多个服务实例之间不能共享
- 适合测试、演示和单进程开发
- 不适合直接作为生产环境审批存储

生产环境通常会换成数据库或 Redis，但接口和状态转换逻辑可以保留。

## 4. `create()`：创建待审批操作

```ts
create(
    input: Omit<
        PendingDeviceAction,
        "approvalId" | "status"
    >
): PendingDeviceAction {
    const action: PendingDeviceAction = {
        ...input,
        approvalId: randomUUID(),
        status: "pending",
    };

    this.items.set(action.approvalId, action);
    return action;
}
```

调用方不负责设置：

```ts
approvalId
status
```

这是 `Omit` 的作用：

```ts
Omit<
    PendingDeviceAction,
    "approvalId" | "status"
>
```

也就是：“接收一个 `PendingDeviceAction`，但去掉 `approvalId` 和 `status`”。

因为这两个字段应该由审批存储控制：

```ts
approvalId: randomUUID(),
status: "pending"
```

创建过程是：

```text
模型提取参数
      ↓
StartCookingInputSchema 校验
      ↓
approvals.create(...)
      ↓
生成 UUID
      ↓
状态设为 pending
      ↓
保存到 Map
      ↓
把 approvalId 返回给客户端
```

## 5. `claim()`：取得唯一执行权

这是整个类最重要的方法。

```ts
claim(
    approvalId: string,
    deviceId: string,
    now = new Date(),
)
```

`claim` 可以理解为：

> 尝试领取这条审批的执行权。

它不是直接执行设备命令，而是检查这条审批能不能执行，然后将状态从：

```text
pending → executing
```

### 第一步：查找并验证设备归属

```ts
const action = this.items.get(approvalId);

if (!action || action.deviceId != deviceId) {
    return {
        success: false,
        code: "APPROVAL_NOT_FOUND"
    };
}
```

这里处理两种情况：

1. `approvalId` 不存在
2. 审批属于另一台设备

两种情况都返回：

```ts
APPROVAL_NOT_FOUND
```

为什么设备不匹配时不返回 `APPROVAL_DEVICE_MISMATCH`？

因为如果返回不同错误，攻击者就可以不断试探：

```text
这个 approvalId 存在，只是不属于我的设备。
```

统一返回 `APPROVAL_NOT_FOUND`，可以减少审批信息泄漏。

### 第二步：确认仍然是 `pending`

```ts
if (action.status !== "pending") {
    return {
        success: false,
        code: "APPROVAL_ALREADY_RESOLVED"
    };
}
```

只有 `pending` 可以被领取。

如果它已经是下面任何一种状态：

```text
executing
executed
failed
rejected
expired
```

就拒绝再次处理。

这就是“同一个审批只能执行一次”的核心保护。

### 第三步：检查是否过期

```ts
if (Date.parse(action.expiresAt) <= now.getTime()) {
    action.status = "expired";

    return {
        success: false,
        code: "APPROVAL_EXPIRED"
    };
}
```

例如：

```text
createdAt:  00:00
expiresAt:  00:05
now:        00:05
```

判断使用的是：

```ts
expiresAt <= now
```

所以恰好到 `00:05` 时已经过期。

过期后状态被改为：

```text
pending → expired
```

以后再次批准时，因为它不再是 `pending`，也不会执行。

### 第四步：同步占用

```ts
action.status = "executing";

return {
    success: true,
    action
};
```

这一步是防止重复执行的关键。

注意它发生在设备调用之前：

```ts
const claimed = approvals.claim(...);

if (!claimed.success) {
    return error;
}

await registry.execute(...);
```

因为 JavaScript 在遇到 `await` 之前会同步执行，所以第一个请求会立即把状态改成 `executing`。

假设用户快速点击两次确认：

```text
请求 A                   请求 B
  │                        │
  ├─ claim()               │
  │  pending → executing   │
  │                        ├─ claim()
  │                        │  发现 executing
  │                        │  返回重复处理错误
  │
  └─ await 设备执行
```

最终只有请求 A 可以操作设备。

如果不先设置 `executing`，可能出现：

```text
请求 A 看到 pending
请求 B 也看到 pending
请求 A 执行设备
请求 B 也执行设备
```

这就是为什么不能等设备调用结束后才修改审批状态。

## 6. `reject()`：拒绝审批

```ts
reject(
    approvalId: string,
    deviceId: string,
): boolean {
    const action = this.items.get(approvalId);

    if (
        !action ||
        action.deviceId !== deviceId ||
        action.status !== "pending"
    ) {
        return false;
    }

    action.status = "rejected";
    return true;
}
```

只有同时满足以下条件才能拒绝：

```text
审批存在
审批属于当前设备
审批状态为 pending
```

成功时：

```text
pending → rejected
```

失败时返回 `false`。

例如以下操作都会失败：

```text
重复拒绝 rejected 审批
拒绝正在 executing 的审批
拒绝已经 executed 的审批
用 oven-002 拒绝 oven-001 的审批
```

`reject()` 返回布尔值，而 `claim()` 返回详细错误，是因为当前调用方对拒绝失败统一处理：

```ts
return rejected
    ? { status: "rejected" }
    : {
        status: "error",
        code: "APPROVAL_NOT_PENDING"
    };
```

## 7. `finish()`：记录设备执行结果

```ts
finish(approvalId: string, success: boolean): void {
    const action = this.items.get(approvalId);

    if (action?.status === "executing") {
        action.status = success
            ? "executed"
            : "failed";
    }
}
```

它只能结束处于 `executing` 状态的审批：

```text
executing → executed
executing → failed
```

这样可以防止异常调用覆盖其他终态。例如：

```ts
finish(rejectedApprovalId, true);
```

不会把已经拒绝的审批错误地改成 `executed`。

在 agent 中，它位于设备工具执行之后：

```ts
const toolResult = await deps.registry.execute(...);

deps.approvals.finish(
    approvalId,
    toolResult.success
);
```

因此：

```text
设备操作成功 → executed
设备操作失败 → failed
```

注意 `failed` 也属于终态。

设备操作失败后，不能重新批准同一个审批。这样避免失败原因不明时自动重复发送高风险设备命令。若确实需要重试，应重新创建一条审批，让用户重新确认。

## 8. 完整成功路径

```text
用户：“375°F 烤 30 分钟”
             │
             ▼
模型提取 start_cooking 参数
             │
             ▼
approvals.create()
pending
             │
             ▼
返回 approvalId 给用户
             │
用户点击“确认”
             │
             ▼
approvals.claim()
pending → executing
             │
             ▼
执行设备工具
             │
             ▼
approvals.finish(true)
executing → executed
```

取消路径：

```text
pending
   │
reject()
   ▼
rejected
```

过期路径：

```text
pending
   │
claim() 时发现过期
   ▼
expired
```

设备执行失败路径：

```text
pending
   │ claim()
   ▼
executing
   │ 设备执行失败
   ▼
failed
```

一句话总结：`InMemoryApprovalStore` 的核心价值并不是“保存数据”，而是把 `pending → executing` 这次状态转换控制住，从而保证设备命令只能由正确设备、在有效期内、执行一次。