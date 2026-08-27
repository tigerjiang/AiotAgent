import type {
    DeviceReportedStateEvent,
} from "./device-reported-state-event.js";

/**
 * 已通过协议校验、去重和顺序检查的设备状态快照。
 *
 * acceptedAt 表示服务端接受事件的时间；event.reportedAt 则是设备声明的
 * 上报时间。两者含义不同，因此都需要保留。
 */
export interface TrustedReportedStateSnapshot {
    event: DeviceReportedStateEvent;
    acceptedAt: string;
}

/** 投影更新结果；accepted 字段让调用方可以安全收窄具体结果类型。 */
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
    deviceId: string,
): string {
    // 租户和设备共同组成隔离键，避免不同租户下同名设备共享状态。
    return `${tenantId}:${deviceId}`;
}

function cloneEvent(
    event: DeviceReportedStateEvent,
): DeviceReportedStateEvent {
    // event.state 中只有 faultCodes 是可变引用类型，需要连同嵌套对象一起复制。
    // 这样调用方不能通过修改返回值绕过 apply 的顺序检查并篡改内部快照。
    return {
        ...event,
        state: {
            ...event.state,
            faultCodes: [...event.state.faultCodes],
        },
    };
}

function cloneSnapshot(
    snapshot: TrustedReportedStateSnapshot,
): TrustedReportedStateSnapshot {
    return {
        acceptedAt: snapshot.acceptedAt,
        event: cloneEvent(snapshot.event),
    };
}

/**
 * 单进程内存状态投影。
 *
 * 每台设备只保留最新被接受的快照，并记录已接受的 eventId。生产环境替换为
 * 数据库时，去重检查、sequence 比较和快照写入必须处于同一事务或条件更新
 * 中，否则并发消费者可能让旧事件覆盖新状态。
 */
export class InMemoryReportedStateProjection {
    // snapshots 保存查询用最新状态；acceptedEventIds 保存幂等消费记录。
    private readonly snapshots = new Map<string, TrustedReportedStateSnapshot>();
    private readonly acceptedEventIds = new Map<string, Set<string>>();

    apply(
        event: DeviceReportedStateEvent,
        acceptedAt: string,
    ): ApplyReportedStateResult {
        const key = buildDeviceKey(
            event.tenantId,
            event.deviceId
        );

        const current = this.snapshots.get(key);
        const eventIds = this.acceptedEventIds.get(key) ?? new Set<string>();

        // 先检查 eventId，使 Broker 重投同一消息得到明确的重复事件结果。
        if (current && eventIds.has(event.eventId)) {
            return {
                accepted: false,
                code: "DUPLICATE_EVENT",
                current: cloneSnapshot(current),
            };
        }

        // sequence 必须严格递增；相同 sequence 即使 eventId 不同也不能覆盖状态。
        if (current && event.sequence <= current.event.sequence) {
            return {
                accepted: false,
                code: "OUT_OF_ORDER_EVENT",
                current: cloneSnapshot(current),
                receivedSequence: event.sequence,
            };
        }

        const snapshot: TrustedReportedStateSnapshot = {
            // 写入时复制输入，避免发布者之后修改原对象影响内部状态。
            event: cloneEvent(event),
            acceptedAt,
        };
        eventIds.add(event.eventId);
        this.acceptedEventIds.set(key, eventIds);
        this.snapshots.set(key, snapshot);

        return {
            accepted: true,
            code: "APPLIED",
            // 读取时再次复制，防止调用方修改 Map 中保存的对象。
            snapshot: cloneSnapshot(snapshot),
        };
    }

    /** 获取指定租户设备的最新可信快照，不暴露内部可变引用。 */
    getLatest(
        tenantId: string,
        deviceId: string,
    ): TrustedReportedStateSnapshot | undefined {

        const snapshot = this.snapshots.get(buildDeviceKey(tenantId, deviceId));
        return snapshot ? cloneSnapshot(snapshot) : undefined;
    }
}
