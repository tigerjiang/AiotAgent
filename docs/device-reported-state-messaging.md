# 设备状态上报消息协议说明

## 目的

`src/messaging` 定义设备通过 MQTT 上报状态时的 Topic、JSON 事件格式和统一解码流程。该层位于 MQTT Broker 与业务状态处理之间，负责把不可信的字符串和二进制负载转换成经过验证的强类型事件。

当前模块只进行协议校验，不写入数据库，也不直接修改设备状态。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `device-state-topic.ts` | 构造和解析状态上报 MQTT Topic |
| `device-reported-state-event.ts` | 定义版本化事件及设备状态的 Zod Schema |
| `decode-reported-state.ts` | 统一执行 Topic、JSON、Schema 和身份一致性校验 |
| `grill-reported-state.json` | 一条合法的烤炉状态上报示例 |
| `test/decode-reported-state.test.ts` | 验证消息契约及主要安全边界 |

## MQTT Topic

状态上报采用固定格式：

```text
aiot/v1/tenants/{tenantId}/devices/{deviceId}/state/reported
```

示例：

```text
aiot/v1/tenants/brisk-it/devices/grill-demo-001/state/reported
```

Topic 共八段：

| 位置 | 内容 |
| ---: | --- |
| 0 | `aiot` |
| 1 | `v1` |
| 2 | `tenants` |
| 3 | `tenantId` |
| 4 | `devices` |
| 5 | `deviceId` |
| 6 | `state` |
| 7 | `reported` |

`tenantId` 和 `deviceId` 长度为 1～64，只允许字母、数字、下划线和连字符。该限制会拒绝 `/`、`+`、`#` 和空白，防止 Topic 层级注入及 MQTT 通配符注入。

## 状态事件

事件顶层字段包括：

- `schemaVersion`：当前固定为 `1.0`，用于后续协议演进。
- `eventId`：UUID，可供消费端进行事件去重。
- `tenantId`、`deviceId`：消息声明的设备身份。
- `deviceType`：受领域层 `DeviceTypeSchema` 限制。
- `sequence`：设备侧递增的非负整数，可用于拒绝重复或乱序状态。
- `reportedAt`：必须包含时区信息的 ISO 日期时间。
- `firmwareVersion`：设备固件版本。
- `state`：设备当前阶段、温度、计时器、探针和错误码。

事件与 `state` 都使用 Zod 的 `strict()`，任何未定义字段都会被拒绝。例如，设备不能在上报消息中夹带 `confirmed: true`。

## 解码流程

`decodeReportedStateMessage(topic, payload)` 按以下顺序处理：

```text
原始 Topic 与 Buffer/string Payload
  -> 校验 Topic 固定结构和动态 ID
  -> 按 UTF-8 转换 Buffer
  -> JSON.parse
  -> Zod 校验事件 Schema
  -> 比较 Topic 与 Payload 的 tenantId/deviceId
  -> 返回强类型 topic 和 event
```

先校验 Topic 可以尽早丢弃错误路由；最后再次比较 Topic 与 Payload 身份，可以阻止攻击者向合法 Topic 发布另一租户或设备的伪造事件。

## 返回结果与错误码

解码器使用 `success` 判别联合：

```ts
type DecodeReportedStateResult =
  | {
      success: true;
      topic: ReportedStateTopic;
      event: DeviceReportedStateEvent;
    }
  | {
      success: false;
      code:
        | "INVALID_MQTT_TOPIC"
        | "INVALID_JSON"
        | "INVALID_REPORTED_STATE"
        | "TOPIC_PAYLOAD_IDENTITY_MISMATCH";
      details?: string;
    };
```

| 错误码 | 含义 |
| --- | --- |
| `INVALID_MQTT_TOPIC` | Topic 段数、常量、ID 长度或字符集不合法 |
| `INVALID_JSON` | Payload 不是合法 JSON |
| `INVALID_REPORTED_STATE` | JSON 不满足事件 Schema；`details` 包含字段问题 |
| `TOPIC_PAYLOAD_IDENTITY_MISMATCH` | Topic 和 Payload 的租户或设备身份不同 |

可预期的外部输入错误会作为结果返回，而不是抛出异常，方便 MQTT 消费循环记录、计数并丢弃坏消息。`buildReportedStateTopic` 面向可信服务端调用者，输入不合法时会抛出 Zod 校验异常。

## 使用示例

```ts
const result = decodeReportedStateMessage(topic, payload);

if (!result.success) {
  logger.warn({ code: result.code }, "Discard invalid state event");
  return;
}

await handleReportedState(result.topic, result.event);
```

下游仍需实现持久化层面的防护，例如按 `eventId` 去重、按 `sequence` 拒绝乱序事件，以及确认设备属于对应租户。

## 验证

```bash
npm run typecheck
npx vitest run test/decode-reported-state.test.ts
```

测试覆盖 Topic 构造与解析、Buffer 解码、身份不一致、MQTT 通配符注入、额外字段和非法 JSON。
