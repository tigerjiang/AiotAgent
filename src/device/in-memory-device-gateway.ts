//实现内存设备模拟器

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
    return DeviceStateSchema.parse(structuredClone(state));
}

export class InMemoryDeviceGateway implements DeviceGateway {

    private readonly states = new Map<string, DeviceState>();
    constructor(initialStates: DeviceState[]) {
        for (const state of initialStates) {
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
            options.new ?? new Date()
        ).toISOString();

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