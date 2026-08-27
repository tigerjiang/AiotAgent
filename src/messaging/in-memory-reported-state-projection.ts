//实现内存状态投影

import { de } from "zod/locales";
import type {
    DeviceReportedStateEvent
} from "./device-reported-state-event";
export interface TrustedReportedStateSnapshot {
    event: DeviceReportedStateEvent;
    acceptedAt: string;
}
export type ApplyReportedStateResult =
    | {
        accepted: true;
        code: "APPLIED";
        snapshot: TrustedReportedStateSnapshot;
    }
    | {
        accepted: false;
        code: "DUPLICATE_EVENT";
        current: TrustedReportedStateSnapshot;
    }
    | {
        accepted: false;
        code: "OUT_OF_ORDER_EVENT";
        current: TrustedReportedStateSnapshot;
        receivedSequence: number;
    };

function buildDeviceKey(
    tenantId: string,
    deviceId: string
): string {
    return `${tenantId}:${deviceId}`;
}

function cloneEvent(
    event: DeviceReportedStateEvent
): DeviceReportedStateEvent {
    return {
        ...event,
        state: {
            ...event.state,
            faultCodes: [...event.state.faultCodes]
        }
    }
}

function cloneSnapshot(
    snapshot: TrustedReportedStateSnapshot
): TrustedReportedStateSnapshot {
    return {
        acceptedAt: snapshot.acceptedAt,
        event: cloneEvent(snapshot.event)
    }
}

export class InMemoryReportedStateProjection {
    private readonly snapshots = new Map<string, TrustedReportedStateSnapshot>();
    private readonly acceptedEventIds = new Map<string, Set<string>>();

    apply(
        event: DeviceReportedStateEvent,
        acceptedAt: string
    ): ApplyReportedStateResult {
        const key = buildDeviceKey(
            event.tenantId,
            event.deviceId
        );

        const current = this.snapshots.get(key);
        const eventIds = this.acceptedEventIds.get(key) ?? new Set<string>();

        if (current && eventIds.has(event.eventId)) {
            return {
                accepted: false,
                code: "DUPLICATE_EVENT",
                current: cloneSnapshot(current),
            }
        }
        if (current && event.sequence <= current.event.sequence) {
            return {
                accepted: false,
                code: "OUT_OF_ORDER_EVENT",
                current: cloneSnapshot(current),
                receivedSequence: event.sequence,
            };
        }

        const snapshot: TrustedReportedStateSnapshot = {
            event: cloneEvent(event),
            acceptedAt,
        };
        eventIds.add(event.eventId);
        this.acceptedEventIds.set(key, eventIds);
        this.snapshots.set(key, snapshot);

        return {
            accepted: true,
            code: "APPLIED",
            snapshot: cloneSnapshot(snapshot)
        };
    }

    getLatest(
        tenantId: string,
        deviceId: string
    ): TrustedReportedStateSnapshot | undefined {

        const snapshot = this.snapshots.get(buildDeviceKey(tenantId, deviceId));
        return snapshot ? cloneSnapshot(snapshot) : undefined;
    }
}