import { decodeReportedStateMessage } from "./decode-reported-state.js";
import {
    InMemoryReportedStateProjection,
    type ApplyReportedStateResult,
    type TrustedReportedStateSnapshot,
} from "./in-memory-reported-state-projection.js";

// “+” 只用于服务端订阅过滤器；具体设备发布的 Topic 仍必须通过严格解析器。
export const REPORTED_STATE_SUBSCRIPTION_TOPIC =
    "aiot/v1/tenants/+/devices/+/state/reported";

/** 可注入时钟让 acceptedAt 在测试中稳定、可重复。 */
export interface Clock {
    now(): Date;
}

const systemClock: Clock = {
    now: () => new Date(),
};

type DecodeFailureCode =
    | "INVALID_MQTT_TOPIC"
    | "INVALID_JSON"
    | "INVALID_REPORTED_STATE"
    | "TOPIC_PAYLOAD_IDENTITY_MISMATCH";

export type ConsumeReportedStateResult =
    | ApplyReportedStateResult
    | {
        accepted: false;
        code: DecodeFailureCode;
        detail?: string;
    };

/**
 * MQTT 状态上报的应用层消费者。
 *
 * 消费者先调用统一解码器建立信任边界，只有合法且身份一致的事件才会进入
 * 投影；投影随后负责 eventId 去重和 sequence 顺序保护。
 */
export class ReportedStateConsumer {
    constructor(
        private readonly projection: InMemoryReportedStateProjection,
        private readonly clock: Clock = systemClock,
    ) { }

    /** 处理一条 Broker 消息，并返回稳定的解码或投影结果。 */
    handle(
        topic: string,
        payload: Buffer | string,
    ): ConsumeReportedStateResult {
        const decoded = decodeReportedStateMessage(
            topic,
            payload,
        );

        if (!decoded.success) {
            // Schema 错误携带字段详情，其他解码错误只需要稳定错误码。
            if (decoded.details) {
                return {
                    accepted: false,
                    code: decoded.code,
                    detail: decoded.details,
                };
            }
            return {
                accepted: false,
                code: decoded.code,
            };
        }

        // acceptedAt 使用服务端时钟，不能相信设备可自行填写的 reportedAt。
        return this.projection.apply(
            decoded.event,
            this.clock.now().toISOString(),
        );
    }

    /** 提供最新投影查询，供 API 或其他应用服务读取。 */
    getLatest(
        tenantId: string,
        deviceId: string,
    ): TrustedReportedStateSnapshot | undefined {
        return this.projection.getLatest(tenantId, deviceId);
    }
}
