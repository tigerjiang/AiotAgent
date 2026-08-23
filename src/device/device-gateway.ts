//定义设备网关接口
import type {
    DeviceCommand
} from "../domain/device-command";

import type {
    DeviceState
} from "./device-state";

export type DeviceExecutionErrorCode =
    | "DEVICE_NOT_FOUND"
    | "DEVICE_OFFLINE"
    | "DEVICE_TYPE_MISMATCH"
    | "CONFIRMATION_REQUIRED"
    | "INVALID_STATE";

export type DeviceExecutionResult =
    | {
        success: true,
        state: DeviceState,
    }
    | {
        success: false,
        error: {
            code: DeviceExecutionErrorCode,
            message: string,
        }


    };

export interface ExecuteCommandOptions {
    confirmed: boolean;
    now?: Date;

}

export interface DeviceGateway {
    getState(
        deviceId: string,
    ): Promise<DeviceState | null>;

    execute(
        command: DeviceCommand,
        options: ExecuteCommandOptions,
    ): Promise<DeviceExecutionResult>;
}