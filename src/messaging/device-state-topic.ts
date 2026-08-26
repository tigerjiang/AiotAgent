import { z } from "zod";

// MQTT 的 +、# 和 / 具有路由语义，因此 ID 只允许安全的字母数字及 _、-。
const TopicIdSchema = z
    .string()
    .min(1)
    .max(64)
    .regex(
        /^[A-Za-z0-9_-]+$/,
        "Topic ID contains invalid characters",
    );
export interface ReportedStateTopic {
    tenantId: string;
    deviceId: string;
}

/**
 * 构建设备状态上报 Topic：
 * aiot/v1/tenants/{tenantId}/devices/{deviceId}/state/reported
 *
 * ID 会先经过运行时校验，避免调用方拼入 MQTT 通配符或额外层级。
 */
export function buildReportedStateTopic(
    input: ReportedStateTopic,
): string {

    const tenantId = TopicIdSchema.parse(input.tenantId);
    const deviceId = TopicIdSchema.parse(input.deviceId);

    return [
        "aiot",
        "v1",
        "tenants",
        tenantId,
        "devices",
        deviceId,
        "state",
        "reported",
    ].join("/");

}

/**
 * 解析并验证状态上报 Topic。
 *
 * 返回可辨识联合而不是抛出异常，因为 Broker 收到非法 Topic 属于可预期的
 * 外部输入错误，消费者通常应记录并丢弃该消息，而不是终止进程。
 */
export function parseReportedStateTopic(topic: string):
    | {
        success: true,
        value: ReportedStateTopic;
    }
    | {
        success: false,
        code: "INVALID_MQTT_TOPIC";
    } {
    const segments = topic.split("/");
    // 固定检查段数和协议常量，拒绝前后多余斜杠、错误版本和其他消息类型。
    if (segments.length !== 8 ||
        segments[0] !== "aiot" ||
        segments[1] !== "v1" ||
        segments[2] !== "tenants" ||
        segments[4] !== "devices" ||
        segments[6] !== "state" ||
        segments[7] !== "reported"
    ) {
        return {
            success: false,
            code: "INVALID_MQTT_TOPIC",
        };
    }

    // 固定段正确后，再校验两个动态身份段的长度和字符集。
    const parsed = z.object({
        tenantId: TopicIdSchema,
        deviceId: TopicIdSchema,
    }).safeParse({
        tenantId: segments[3],
        deviceId: segments[5],
    });
    if (!parsed.success) {
        return {
            success: false,
            code: "INVALID_MQTT_TOPIC",
        };
    }

    return {
        success: true,
        value: parsed.data,
    };
}
