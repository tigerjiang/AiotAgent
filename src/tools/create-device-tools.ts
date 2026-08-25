import { randomUUID } from "node:crypto";
import { date, z } from "zod";
import {
    DeviceCommandSchema,
    type DeviceCommand
} from "../domain/device-command.js";
import {
    defineDeviceTool
} from "./define-device-tool.js";
import type {
    DeviceTool,
    DeviceToolContext,
    DeviceToolResult
} from "./device-tool.js";

function buildCommand(
    context: DeviceToolContext,
    intent: DeviceCommand["intent"],
    parameters: unknown
): DeviceCommand {
    // deviceId、deviceType 和 issuedAt 只从可信执行上下文构造，模型参数无法
    // 指向其他设备；DeviceCommandSchema 再统一校验领域命令结构。
    return DeviceCommandSchema.parse({
        requestId: randomUUID(),
        deviceId: context.deviceId,
        deviceType: context.deviceType,
        intent,
        parameters,
        issuedAt: (
            context.now ?? new Date()
        ).toISOString(),
        requiresConfirmation: true
    });

}
async function executeCommand(
    command: DeviceCommand,
    context: DeviceToolContext
): Promise<DeviceToolResult> {
    // 是否已确认由审批编排器写入 context，不能由工具参数或模型自行声明。
    const result = await context.gateway.execute(
        command,
        {
            confirmed: context.confirmed,
            now: context.now,
        }
    );

    if (!result.success) {
        return result;
    }
    return {
        success: true,
        output: result.state
    };

}

const getDeviceStateTool = defineDeviceTool({
    name: "get_device_state",
    description:
        "Get the current connection and operating state of the user's active cooking device.",
    inputSchema: z.object({}).strict(),

    async handler(_input, context) {
        const state = await context.gateway.getState(
            context.deviceId
        );
        if (!state) {
            return {
                success: false,
                error: {
                    code: "DEVICE_NOT_FOUND",
                    message:
                        "The active device was not found."
                }
            };

        }
        return {
            success: true,
            output: state
        };
    },

});

const startCookingTool = defineDeviceTool({
    name: "start_cooking",
    description:
        "Start preheating the active cooking device at an explicitly provided temperature.",
    inputSchema: z.object({
        temperatureFahrenheit:
            z.number().int().min(165).max(500),
        durationMinutes:
            z.number().int().positive().nullable(),
        probeTargetFahrenheit:
            z.number().int().min(100).max(220)
                .nullable()
    }).strict(),

    async handler(input, context) {
        // nullable 字段在领域命令中用“字段缺失”表达未设置，因此只展开非 null 值。
        const command = buildCommand(
            context,
            "start_cooking",
            {
                temperatureFahrenheit:
                    input.temperatureFahrenheit,
                ...(input.durationMinutes === null
                    ? {}
                    : {
                        durationMinutes:
                            input.durationMinutes
                    }),
                ...(input.probeTargetFahrenheit === null
                    ? {}
                    : {
                        probeTargetFahrenheit:
                            input.probeTargetFahrenheit
                    })

            }

        );

        return executeCommand(command, context);

    }
});

const setTemperatureTool = defineDeviceTool({
    name: "set_temperature",

    description:
        "Change the active device target temperature while it is already ignited.",

    inputSchema: z.object({
        temperatureFahrenheit: z.number().int().min(165).max(500)
    }).strict(),

    async handler(input, context) {
        return executeCommand(
            buildCommand(
                context,
                "set_temperature",
                {
                    temperatureFahrenheit:
                        input.temperatureFahrenheit
                }
            ),
            context
        );

    }
});

const setTimerTool = defineDeviceTool({
    name: "set_timer",
    description: "Set a cooking timer on the active running device.",
    inputSchema: z.object({
        durationMinutes:
            z.number().int().positive().max(1440)
    })
        .strict(),

    async handler(input, context) {
        return executeCommand(
            buildCommand(
                context,
                "set_timer",
                {
                    durationMinutes: input.durationMinutes
                }

            ),
            context
        );
    }
})

const shutdownTool = defineDeviceTool({
    name: "shutdown",
    description:
        "Begin the safe shutdown process for the active cooking device.",
    inputSchema: z.object({}).strict(),

    async handler(input, context) {
        return executeCommand(
            buildCommand(
                context,
                "shutdown",
                {}
            ),
            context
        );
    }
})

export function createDeviceTools():
    DeviceTool[] {
    // 注册表只接收这里明确列出的工具，形成可执行设备能力的白名单。
    return [
        getDeviceStateTool,
        startCookingTool,
        setTemperatureTool,
        setTimerTool,
        shutdownTool
    ]
}

