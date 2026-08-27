import { decodeReportedStateMessage } from "./decode-reported-state";
import {
    InMemoryReportedStateProjection,
    type ApplyReportedStateResult,
    type TrustedReportedStateSnapshot,
} from "./in-memory-reported-state-projection";

export const REPORTED_STATE_SUBSCRIPTION_TOPIC =
    "aiot/v1/tenants/+/devices/+/state/reported";
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
        detail: string;
    };

export class ReportedStateConsumer {
    constructor(
        private readonly projection: InMemoryReportedStateProjection,
        private readonly clock: Clock = systemClock,
    ) { }

    handle(
        topic: string,
        payload: Buffer | string
    ) {
        const decoded = decodeReportedStateMessage(
            topic,
            payload
        );

        if (!decoded.success) {
            if (decoded.details) {
                return {
                    accepted: false,
                    code: decoded.code,
                    detail: decoded.details
                };
            }
            return {
                accepted: false,
                code: decoded.code,
            };
        }
        return this.projection.apply(
            decoded.event,
            this.clock.now().toISOString()
        );
    }
    getLatest(
        tenantId: string,
        deviceId: string
    ): TrustedReportedStateSnapshot | undefined {
        return this.projection.getLatest(tenantId, deviceId);
    }
}