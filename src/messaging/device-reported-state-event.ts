import { z } from "zod";
import {
    DeviceTypeSchema,
} from "../domain/device-command.js";
import {
    DevicePhaseSchema,
} from "../device/device-state.js";

// 租户和设备标识限制为 MQTT Topic 可安全表达的字符，禁止通配符、斜杠和
// 空白进入消息身份字段。
const EntityIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

// 设备状态采用严格对象：固件不能借由附加字段传入服务端未定义的控制信号。
const ReportedStateSchema = z.object({
    phase: DevicePhaseSchema,
    currentTemperatureFahrenheit:
        z.number().finite().min(0).max(600),

    targetTemperatureFahrenheit: z
        .number()
        .int()
        .min(165)
        .max(500)
        .nullable(),

    timerRemainingSeconds: z
        .number()
        .int()
        .min(0)
        .nullable(),

    probeTemperatureFahrenheit: z
        .number()
        .finite()
        .min(-40)
        .max(500)
        .nullable(),

    probeTargetFahrenheit: z
        .number()
        .int()
        .min(100)
        .max(220)
        .nullable(),

    faultCodes: z
        // 限制单条错误码与数组数量，避免异常设备制造无限增长的消息负载。
        .array(z.string().min(1).max(64))
        .max(20),
}).strict();

/**
 * 设备上报事件的版本化运行时 Schema。
 *
 * 每个字段在进入业务层前都会被校验；schemaVersion 为后续协议演进提供明确
 * 分支，eventId 用于去重，sequence 用于识别重复或乱序事件。
 */
export const DeviceReportedStateEventSchema = z.object({
    schemaVersion: z.literal("1.0"),
    eventId: z.string().uuid(),
    tenantId: EntityIdSchema,
    deviceId: EntityIdSchema,
    deviceType: DeviceTypeSchema,
    // 设备每次上报递增，消费端可用它拒绝重复或乱序状态。
    sequence: z.number().int().nonnegative(),
    // 要求包含时区偏移，避免不同部署区域对本地时间产生歧义。
    reportedAt: z.string().datetime({
        offset: true,
    }),
    firmwareVersion: z
        .string()
        .min(1)
        .max(50),

    state: ReportedStateSchema,
}).strict();

// 类型直接由运行时 Schema 推导，防止 TypeScript 声明和实际校验规则漂移。
export type DeviceReportedStateEvent =
  z.infer<
    typeof DeviceReportedStateEventSchema
  >;
