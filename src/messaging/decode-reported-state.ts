import {
    DeviceReportedStateEventSchema,
    type DeviceReportedStateEvent,
} from "./device-reported-state-event.js";
import {
    parseReportedStateTopic,
    type ReportedStateTopic,
} from "./device-state-topic.js";

/**
 * MQTT 状态消息的解码结果。
 *
 * 使用 success 作为可辨识联合的判别字段，调用方可以在不抛异常的情况下
 * 分别处理正常事件与协议错误。details 只补充 Schema 校验信息，不替代稳定
 * 的错误码。
 */
export type DecodeReportedStateResult =
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

/**
 * 按固定顺序验证 MQTT Topic、JSON、事件 Schema 和身份一致性。
 *
 * 函数只负责把不可信的 Broker 输入转换成可信领域数据，不保存设备状态。
 * 所有可预期的消息错误都以 DecodeReportedStateResult 返回。
 */
export function decodeReportedStateMessage(
    topic: string,
    payload: Buffer | string,
): DecodeReportedStateResult {
    // Topic 成本最低且携带路由身份，因此最先校验；非法 Topic 无需解析负载。
    const topicResult = parseReportedStateTopic(topic);
    if (!topicResult.success) {
        return topicResult;
    }

    let json: unknown;
    try {
        // MQTT 客户端通常提供 Buffer，同时接受 string 便于测试和其他传输层复用。
        json = JSON.parse(
            typeof payload === "string"
                ? payload
                : payload.toString("utf8"),
        );

    } catch {
        return {
            success: false,
            code: "INVALID_JSON",
        };
    }

    // JSON 可解析不代表内容可信；strict Schema 会拒绝未知字段和越界数值。
    const eventResult =
        DeviceReportedStateEventSchema.safeParse(
            json,
        );
    if (!eventResult.success) {
        return {
            success: false,
            code: "INVALID_REPORTED_STATE",
            details: eventResult.error.issues
                .map(issue => {
                    const path =
                        issue.path.join(".") || "payload";

                    return `${path}: ${issue.message}`;
                })
                .join("; "),
        };
    }

    const event = eventResult.data;
    const topicIdentity = topicResult.value;
    // 同时校验租户和设备，阻止攻击者在合法 Topic 下伪造其他设备的 payload。
    if (
        event.tenantId !== topicIdentity.tenantId ||
        event.deviceId !== topicIdentity.deviceId
    ) {
        return {
            success: false,
            code:
                "TOPIC_PAYLOAD_IDENTITY_MISMATCH",
        };
    }

    // 只有通过全部边界校验后，才向下游返回已收窄的强类型事件。
    return {
        success: true,
        topic: topicIdentity,
        event,
    };
}
