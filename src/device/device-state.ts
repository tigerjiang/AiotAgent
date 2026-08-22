//创建设备状态模型
import { z } from "zod";
import { DeviceTypeSchema } from "../domain/device-command";
export const DeviceConnectionSchema = z.enum(
    [
        "online",
        "offline"
    ]
);

export const DevicePhaseSchema = z.enum([
    "idle",
    "preheating",
    "cooking",
    "shutting_down",
    "error"
]);

export const DeviceStateSchema = z.object({
    deviceId: z.string().min(1),
    deviceType: DeviceTypeSchema,
    connection: DeviceConnectionSchema,
    phase: DevicePhaseSchema,

    currentTemperatureFahrenheit:
        z.number().min(0).max(500),

    targetTemperatureFahrenheit:
        z.number().int().min(165).max(500).nullable(),

    timerRemainingMinutes:
        z.number().int().min(0).nullable(),

    updatedAt: z.string().datetime()
})

export type DeviceState = z.infer<typeof DeviceStateSchema>;