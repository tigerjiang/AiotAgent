# 设备状态消费者与内存投影说明

## 目标

本模块承接设备状态上报协议解码层，将通过校验的 MQTT 事件安全地写入“最新设备状态”投影。它解决三个消费端常见问题：

- MQTT 至少一次投递造成同一事件重复到达。
- 网络延迟或 Broker 重连造成旧状态晚于新状态到达。
- 非法消息或身份不一致的消息污染可信设备状态。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/messaging/reported-state-consumer.ts` | 编排消息解码、服务端接收时间和投影更新 |
| `src/messaging/in-memory-reported-state-projection.ts` | 按租户和设备保存最新状态，执行去重及顺序检查 |
| `test/reported-state-consumer.test.ts` | 验证合法更新、重复、乱序、冲突和非法消息场景 |

Topic 和 Payload 的基础协议请参阅 `docs/device-reported-state-messaging.md`。

## 处理流程

```text
MQTT Topic + Payload
  -> decodeReportedStateMessage
     -> Topic 格式校验
     -> JSON 与事件 Schema 校验
     -> Topic/Payload 身份一致性校验
  -> ReportedStateConsumer
     -> 使用服务端时钟生成 acceptedAt
  -> InMemoryReportedStateProjection.apply
     -> 按 tenantId + deviceId 定位设备
     -> 按 eventId 去重
     -> 检查 sequence 严格递增
     -> 保存并返回最新可信快照
```

解码失败时不会调用 `apply`，因此无效 Payload 和身份不一致消息不会产生状态副作用。

## MQTT 订阅

消费者导出统一订阅过滤器：

```text
aiot/v1/tenants/+/devices/+/state/reported
```

这里的 `+` 是 Broker 订阅端使用的单层通配符。设备实际发布的具体 Topic 不能包含通配符，仍需通过 `parseReportedStateTopic` 严格校验。

## 最新状态投影

投影使用以下组合键隔离设备：

```text
{tenantId}:{deviceId}
```

不能只使用 `deviceId`，因为不同租户可能拥有同名设备。

可信快照结构如下：

```ts
interface TrustedReportedStateSnapshot {
  event: DeviceReportedStateEvent;
  acceptedAt: string;
}
```

- `event.reportedAt`：设备声明的上报时间，可能受设备时钟影响。
- `acceptedAt`：服务端接受并写入投影的时间，由注入的 `Clock` 生成。

投影在写入和读取时都会复制事件及 `faultCodes` 数组，避免调用方通过修改对象引用篡改内部状态。

## 去重与顺序规则

### 重复事件

同一设备已经接受过相同 `eventId` 时返回：

```json
{
  "accepted": false,
  "code": "DUPLICATE_EVENT"
}
```

这使消费者能够安全处理 MQTT 至少一次投递产生的重复消息。

### 乱序或冲突事件

新事件必须满足：

```text
received.sequence > current.sequence
```

较小 sequence 是晚到的旧消息；相同 sequence 但 eventId 不同是冲突消息。两者都返回 `OUT_OF_ORDER_EVENT`，并保持当前快照不变。

### 新事件

sequence 严格递增时返回 `APPLIED`，并用新事件替换最新快照。

## 结果类型

| code | accepted | 含义 |
| --- | --- | --- |
| `APPLIED` | `true` | 事件通过全部检查并更新投影 |
| `DUPLICATE_EVENT` | `false` | eventId 已被当前设备接受过 |
| `OUT_OF_ORDER_EVENT` | `false` | sequence 小于或等于当前值 |
| `INVALID_MQTT_TOPIC` | `false` | Topic 不符合协议 |
| `INVALID_JSON` | `false` | Payload 不是合法 JSON |
| `INVALID_REPORTED_STATE` | `false` | 事件不符合状态 Schema |
| `TOPIC_PAYLOAD_IDENTITY_MISMATCH` | `false` | Topic 与 Payload 身份不同 |

## 为什么注入 Clock

消费者不直接调用散落的 `new Date()`，而是依赖：

```ts
interface Clock {
  now(): Date;
}
```

生产环境默认使用系统时间；测试注入固定时钟，从而可以稳定断言 `acceptedAt`，不需要等待或模拟全局计时器。

## 当前实现限制

`InMemoryReportedStateProjection` 适用于本地开发和单进程测试，生产环境需要考虑：

- 进程重启后状态和 eventId 集合会丢失。
- 多实例消费者之间不共享内存。
- 已接受 eventId 集合会持续增长，需要保留周期或清理策略。
- 去重、sequence 比较和快照写入必须使用数据库事务或原子条件更新。
- 下游还应根据 `eventId` 建立持久化唯一约束，并监控重复、乱序和非法消息数量。

## 验证

```bash
npm run typecheck
npx vitest run test/reported-state-consumer.test.ts
```

测试覆盖首次应用、最新状态查询、重复 eventId、较旧 sequence、相同 sequence 冲突、较新 sequence、非法 Payload 和身份不一致消息。
