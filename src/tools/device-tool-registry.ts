/**
 * 设备工具注册表：隔离 agent 编排层与具体工具实现。
 *
 * agent 只通过工具名调用 execute；注册表负责拒绝未知工具，再由具体
 * DeviceTool 负责校验输入。这使审批记录即使被错误写入也仍有一道校验边界。
 */

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
            // 启动时尽早暴露重名配置，避免后注册的工具静默覆盖前一个工具。
            if (this.tools.has(tool.name)) {
                throw new Error(
                    `Duplicate tool name: ${tool.name}`
                );
            }
            this.tools.set(tool.name, tool);

        }
    }

    list(): DeviceTool[] {
        // 返回快照数组，调用方无法直接修改内部 Map。
        return [...this.tools.values()];
    }

    async execute(
        name: string,
        input: unknown,
        context: DeviceToolContext
    ): Promise<DeviceToolResult> {

        // 工具名可能间接来自模型，因此必须显式执行白名单查找。
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
        // DeviceTool.execute 会先按该工具的 Zod schema 校验 input，再调用 handler。
        return tool.execute(input, context);
    }

}
