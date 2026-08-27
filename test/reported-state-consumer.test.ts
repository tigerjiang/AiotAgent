import {
    describe,
    expect,
    it,
} from "vitest";
import {
    InMemoryReportedStateProjection,
} from "../src/messaging/in-memory-reported-state-projection.js";

import {
    ReportedStateConsumer,
    type Clock,
} from "../src/messaging/reported-state-consumer.js";

// Topic 身份必须与 baseEvent 中的 tenantId 和 deviceId 保持一致。
const topic =
    "aiot/v1/tenants/brisk-it/devices/" +
    "grill-demo-001/state/reported";

// 所有用例从同一条合法事件派生，只修改当前场景关注的字段。
const baseEvent = {
    schemaVersion: "1.0",
    eventId:
        "4495f9fe-f1c8-43b7-973e-85629542567d",
    tenantId: "brisk-it",
    deviceId: "grill-demo-001",
    deviceType: "pellet_grill",
    sequence: 42,
    reportedAt:
        "2026-08-21T00:00:00.000Z",
    firmwareVersion: "2.4.1",
    state: {
        phase: "cooking",
        currentTemperatureFahrenheit: 221,
        targetTemperatureFahrenheit: 225,
        timerRemainingSeconds: 5340,
        probeTemperatureFahrenheit: 165,
        probeTargetFahrenheit: 203,
        faultCodes: [],
    },
};

// 固定服务端接收时间，使 acceptedAt 的断言不依赖真实系统时钟。
const fixedClock: Clock = {
    now: () =>
        new Date("2026-08-21T00:00:05.000Z"),
};

function createConsumer(): ReportedStateConsumer {
    // 每个测试创建独立投影，避免事件 ID 和 sequence 在用例间互相污染。
    return new ReportedStateConsumer(
        new InMemoryReportedStateProjection(),
        fixedClock,
    );
}

/**
 * 覆盖合法事件投影、Broker 重投去重、乱序保护以及无效消息不产生状态副作用。
 */
describe("ReportedStateConsumer", () => {
    it("applies a valid event and exposes the latest state", () => {
        // 首条合法消息应成为该租户设备的最新可信快照。
        const consumer = createConsumer();
        const result = consumer.handle(
            topic,
            JSON.stringify(baseEvent)
        );
        expect(result).toMatchObject({
            accepted: true,
            code: "APPLIED",
            snapshot: {
                acceptedAt:
                    "2026-08-21T00:00:05.000Z",
                event: {
                    tenantId: "brisk-it",
                    deviceId: "grill-demo-001",
                    sequence: 42,
                },
            },
        });
        expect(consumer.getLatest("brisk-it",
            "grill-demo-001",)).toMatchObject({
                event: {
                    sequence: 42,
                    state: {
                        currentTemperatureFahrenheit: 221,
                    },
                },
            });
    });
    it("deduplicates an already accepted eventId", () => {
        // MQTT 至少一次投递可能重复发送相同消息，eventId 保证幂等。
        const consumer = createConsumer();

        consumer.handle(
            topic,
            JSON.stringify(baseEvent),
        );

        const duplicate = consumer.handle(
            topic,
            JSON.stringify(baseEvent),
        );

        expect(duplicate).toMatchObject({
            accepted: false,
            code: "DUPLICATE_EVENT",
            current: {
                event: {
                    sequence: 42,
                },
            },
        });
    });

    it("rejects an older sequence without changing state", () => {
        // 延迟到达的旧消息不能覆盖 sequence 更高的新状态。
        const consumer = createConsumer();

        consumer.handle(
            topic,
            JSON.stringify(baseEvent),
        );

        const outOfOrder = consumer.handle(
            topic,
            JSON.stringify({
                ...baseEvent,
                eventId:
                    "4b2f918a-c121-49e9-b553-fb55addf83d8",
                sequence: 41,
                state: {
                    ...baseEvent.state,
                    currentTemperatureFahrenheit: 180,
                },
            }),
        );

        expect(outOfOrder).toMatchObject({
            accepted: false,
            code: "OUT_OF_ORDER_EVENT",
            receivedSequence: 41,
            current: {
                event: {
                    sequence: 42,
                },
            },
        });

        expect(
            consumer.getLatest(
                "brisk-it",
                "grill-demo-001",
            )?.event.state.currentTemperatureFahrenheit,
        ).toBe(221);
    });
    it("rejects the same sequence with a different eventId", () => {
        // 相同 sequence 的不同 eventId 属于冲突事件，也不能覆盖当前状态。
        const consumer = createConsumer();

        consumer.handle(
            topic,
            JSON.stringify(baseEvent),
        );

        const conflict = consumer.handle(
            topic,
            JSON.stringify({
                ...baseEvent,
                eventId:
                    "1d4078a7-ffb4-4cf7-8fb8-75d02ef936c8",
            }),
        );

        expect(conflict).toMatchObject({
            accepted: false,
            code: "OUT_OF_ORDER_EVENT",
            receivedSequence: 42,
        });
    });
    it("applies a newer sequence", () => {
        // 只有严格递增的 sequence 才能推进设备状态投影。
        const consumer = createConsumer();

        consumer.handle(
            topic,
            JSON.stringify(baseEvent),
        );

        const newer = consumer.handle(
            topic,
            JSON.stringify({
                ...baseEvent,
                eventId:
                    "bc24310b-0146-4f36-953d-55d07fefadd7",
                sequence: 43,
                reportedAt:
                    "2026-08-21T00:00:10.000Z",
                state: {
                    ...baseEvent.state,
                    currentTemperatureFahrenheit: 224,
                },
            }),
        );

        expect(newer).toMatchObject({
            accepted: true,
            code: "APPLIED",
            snapshot: {
                event: {
                    sequence: 43,
                    state: {
                        currentTemperatureFahrenheit: 224,
                    },
                },
            },
        });
    });

    it("does not project an invalid payload", () => {
        // Schema 解码发生在 apply 之前，非法 sequence 不会创建任何快照。
        const consumer = createConsumer();

        const invalid = consumer.handle(
            topic,
            JSON.stringify({
                ...baseEvent,
                sequence: -1,
            }),
        );

        expect(invalid).toMatchObject({
            accepted: false,
            code: "INVALID_REPORTED_STATE",
        });

        expect(
            consumer.getLatest(
                "brisk-it",
                "grill-demo-001",
            ),
        ).toBeUndefined();
    });
    it("does not project a topic and payload identity mismatch", () => {
        // Payload 冒充其他设备时，消费者必须在投影前拒绝消息。
        const consumer = createConsumer();

        const mismatch = consumer.handle(
            topic,
            JSON.stringify({
                ...baseEvent,
                deviceId: "grill-demo-002",
            }),
        );

        expect(mismatch).toEqual({
            accepted: false,
            code:
                "TOPIC_PAYLOAD_IDENTITY_MISMATCH",
        });

        expect(
            consumer.getLatest(
                "brisk-it",
                "grill-demo-001",
            ),
        ).toBeUndefined();
    });
});
