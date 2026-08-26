import { describe, expect, it } from "vitest";
import {
    buildReportedStateTopic,
    parseReportedStateTopic,
} from "../src/messaging/device-state-topic.js";
import { decodeReportedStateMessage } from
    "../src/messaging/decode-reported-state.js";

// Topic 身份与 validEvent 中的租户、设备必须完全一致。
const topic = "aiot/v1/tenants/brisk-it/devices/" +
    "grill-demo-001/state/reported";

// 复用一条通过完整 Schema 校验的基准事件，各失败用例只修改关注的字段。
const validEvent = {
    schemaVersion: "1.0",
    eventId:
        "4495f9fe-f1c8-43b7-973e-85629542567d",
    tenantId: "brisk-it",
    deviceId: "grill-demo-001",
    deviceType: "pellet_grill",
    sequence: 42,
    reportedAt:
        "2026-08-20T00:00:00.000Z",
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

/**
 * 覆盖从 Topic 构造到消息解码的协议边界，尤其验证 MQTT 通配符注入、未知
 * payload 字段和 Topic/Payload 身份不一致不会进入后续状态处理流程。
 */
describe("reported state MQTT contract", () => {
    it("builds and parses the topic", () => {
        // builder 与 parser 应保持往返一致，避免生产者和消费者使用不同格式。
        const built = buildReportedStateTopic({
            tenantId: "brisk-it",
            deviceId: "grill-demo-001",
        }
        );
        expect(built).toBe(topic);

        expect(
            parseReportedStateTopic(built),
        ).toEqual({
            success: true,
            value: {
                tenantId: "brisk-it",
                deviceId: "grill-demo-001",
            },
        });
    });
    it("decodes a valid state event", () => {
        // 使用 Buffer 模拟常见 MQTT 客户端交付的二进制 payload。
        const result = decodeReportedStateMessage(topic, Buffer.from(
            JSON.stringify(validEvent),
        ),)
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.event.sequence).toBe(42);
            expect(
                result.event.state.phase,
            ).toBe("cooking");
        }
    });

    it("rejects mismatched device identity", () => {
        // 即使 payload 本身 Schema 合法，也不能冒充 Topic 指向的另一台设备。
        const result =
            decodeReportedStateMessage(
                topic,
                JSON.stringify({
                    ...validEvent,
                    deviceId: "another-grill",
                }),
            );

        expect(result).toMatchObject({
            success: false,
            code:
                "TOPIC_PAYLOAD_IDENTITY_MISMATCH",
        });
    });

    it("rejects MQTT wildcard injection", () => {
        // “+” 是 MQTT 单层通配符，绝不能作为具体设备 ID 拼入发布 Topic。
        expect(() =>
            buildReportedStateTopic({
                tenantId: "brisk-it",
                deviceId: "+",
            }),
        ).toThrow();
    });

    it("rejects extra payload fields", () => {
        // strict Schema 拒绝 confirmed 等协议外字段，避免上报消息夹带控制语义。
        const result =
            decodeReportedStateMessage(
                topic,
                JSON.stringify({
                    ...validEvent,
                    confirmed: true,
                }),
            );

        expect(result).toMatchObject({
            success: false,
            code: "INVALID_REPORTED_STATE",
        });
    });
    it("rejects malformed JSON", () => {
        // 语法错误应成为稳定错误结果，而不是让消费循环抛异常退出。
        expect(
            decodeReportedStateMessage(
                topic,
                "{invalid",
            ),
        ).toEqual({
            success: false,
            code: "INVALID_JSON",
        });
    });
});
