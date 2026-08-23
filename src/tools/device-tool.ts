//定义工具抽象
import { z } from "zod";
import type { DeviceType } from "../domain/device-command";
import type { DeviceGateway } from "../device/device-gateway";
export interface DeviceToolContext {
    gateway: DeviceGateway;
    deviceId: string;
    deviceType: DeviceType;
    // 由App或业务服务设置，不能来自模型参数
    confirmed: boolean;
    now?: Date;
}

export type DeviceToolResult =
    | {
        success: true,
        output: unknown;
    }
    | {
        success: false,
        error: {
            code: string,
            message: string
        };

    };

export interface DeviceTool {
    name: string;
    description: string;
    inputSchema: z.ZodType;
    execute(
        input: unknown,
        context: DeviceToolContext,
    ): Promise<DeviceToolResult>;

}

