//创建工具注册表

import { fa } from "zod/locales";
import type {
    DeviceTool,
    DeviceToolContext,
    DeviceToolResult
} from "./device-tool.js";

export class DeviceToolRegistry {
    private readonly tools =
        new Map<string, DeviceTool>();
    constructor(tools: DeviceTool[]) {
        for (const tool of tools) {
            if (this.tools.has(tool.name)) {
                throw new Error(
                    `Duplicate tool name: ${tool.name}`
                );
            }
            this.tools.set(tool.name, tool);

        }
    }

    list(): DeviceTool[] {
        return [...this.tools.values()];
    }

    async execute(
        name: string,
        input: unknown,
        context: DeviceToolContext
    ): Promise<DeviceToolResult> {

        const tool = this.tools.get(name);
        if (!tool) {
            return {
                success: false,
                error: {
                    code: "UNKNOWN_TOOL",
                    message: `Unknown tool: ${name}`
                }
            };
        }
        return tool.execute(input, context);
    }

}