/**
 * 内存设备网关，用于本地运行和测试领域规则。
 *
 * 它模拟真实设备适配器的最后一道安全边界：设备存在性、类型、在线状态、
 * 用户确认和运行阶段都在真正改变状态之前检查。生产网关应保持相同契约。
 */

import { fa } from "zod/locales";
import type { DeviceCommand } from "../domain/device-command";
import type {
    DeviceExecutionErrorCode,
    DeviceExecutionResult,
    DeviceGateway,
    ExecuteCommandOptions
} from "./device-gateway.js";

import {
    DeviceStateSchema,
    type DeviceState
} from "./device-state";
import { DatabaseSync } from "node:sqlite";

function failure(
    code: DeviceExecutionErrorCode,
    message: string
): DeviceExecutionResult {
    return {
        success: false,
        error: {
            code,
            message
        }
    };
}

function cloneState(
    state: DeviceState
): DeviceState {
    // 读写都返回副本，防止调用方绕开 execute 直接修改 Map 中的设备状态。
    return DeviceStateSchema.parse(structuredClone(state));
}

export class InMemoryDeviceGateway implements DeviceGateway {

    private readonly states = new Map<string, DeviceState>();
    constructor(initialStates: DeviceState[]) {
        for (const state of initialStates) {
            // 测试夹具也必须满足真实设备状态 schema，避免无效状态进入模拟器。
            const validated = DeviceStateSchema.parse(state);
            this.states.set(
                validated.deviceId,
                validated
            );
        }
    }
    async getState(deviceId: string): Promise<DeviceState | null> {
        const state = this.states.get(deviceId);
        return state ? cloneState(state) : null;
    }
    async execute(command: DeviceCommand, options: ExecuteCommandOptions): Promise<DeviceExecutionResult> {
        const current = this.states.get(command.deviceId);

        // 按固定顺序执行通用前置检查，任一失败都不会生成或持久化 next 状态。
        if (!current) {
            return failure("DEVICE_NOT_FOUND"
                , "The target device was not found.");
        }
        if (current.deviceType != command.deviceType) {
            return failure("DEVICE_TYPE_MISMATCH", "The command device type does not match the target device.");
        }

        if (current.connection != "online") {
            return failure("DEVICE_OFFLINE", "The device is offline");
        }

        if (command.requiresConfirmation && !options.confirmed) {
            return failure("CONFIRMATION_REQUIRED", "The command requires user confirmation.");
        }

        const next: DeviceState = {
            ...current
        }

        // 每种 intent 只允许从合法运行阶段迁移，并只修改该命令负责的字段。
        switch (command.intent) {
            case "start_cooking": {
                if (current.phase !== "idle") {
                    return failure("INVALID_STATE", `Cannot start cooking while the device is ${current.phase}.`);
                }
                next.phase = "preheating";
                next.targetTemperatureFahrenheit = command.parameters.temperatureFahrenheit;
                next.timerRemainingMinutes = command.parameters.durationMinutes ?? null;
                break;
            }
            case "set_temperature": {
                if (current.phase !== "preheating" &&
                    current.phase !== "cooking"
                ) {
                    return failure("INVALID_STATE",
                        "Temperature can only be changed while the grill is ignited.");
                }
                next.targetTemperatureFahrenheit = command.parameters.temperatureFahrenheit;
                break;
            }

            case "set_timer": {
                if (
                    current.phase !== "preheating" &&
                    current.phase !== "cooking"
                ) {
                    return failure(
                        "INVALID_STATE",
                        "A cooking timer can only be set while the grill is running."
                    );
                }

                next.timerRemainingMinutes =
                    command.parameters.durationMinutes;

                break;
            }

            case "shutdown": {
                if (
                    current.phase !== "preheating" &&
                    current.phase !== "cooking"
                ) {
                    return failure(
                        "INVALID_STATE",
                        `Cannot shut down while the device is ${current.phase}.`
                    );
                }
                next.phase = "shutting_down"
                next.targetTemperatureFahrenheit = null;
                next.timerRemainingMinutes = null;
                break;
            }
        }
        next.updatedAt = (
            options.now ?? new Date()
        ).toISOString();

        // 提交状态前再次校验，避免领域处理产生无法表示的设备状态。
        const validated = DeviceStateSchema.parse(next);
        this.states.set(
            validated.deviceId,
            validated
        );

        return {
            success: true,
            state: cloneState(validated)
        };

    }

}
