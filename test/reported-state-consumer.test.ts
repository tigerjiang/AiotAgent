import {
    describe,
    it,
    expect
} from "vitest";
import {
    InMemoryReportedStateProjection
} from "../src/messaging/in-memory-reported-state-projection";

import {
    ReportedStateConsumer,
    type Clock
} from "../src/messaging/reported-state-consumer";

const topic =
    "aiot/v1/tenants/brisk-it/devices/" +
    "grill-demo-001/state/reported";

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

const fixedClock: Clock = {
    now: () =>
        new Date("2026-08-21T00:00:05.000Z"),
};

function createConsumer(): ReportedStateConsumer {
    return new ReportedStateConsumer(
        new InMemoryReportedStateProjection(),
        fixedClock
    );
}

describe("ReportedStateConsumer", () => {

    it("applies a valid event and exposes the latest state", () => {
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
})
