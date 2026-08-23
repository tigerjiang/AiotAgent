//创建工具定义辅助函数
import { z } from "zod";
import type {
    DeviceTool,
    DeviceToolResult,
    DeviceToolContext
} from "./device-tool";
import { fa } from "zod/locales";

interface DeviceToolDefinition<
    TSchema extends z.ZodType
> {
    name: string;
    description: string;
    inputSchema: TSchema;
    handler(
        input: z.infer<TSchema>,
        context: DeviceToolContext
    ): Promise<DeviceToolResult>;
}

export function defineDeviceTool<TSchema extends z.ZodType>(
    definition: DeviceToolDefinition<TSchema>
): DeviceTool {
    return {
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,

        async execute(input, context) {
            const validation = definition.inputSchema.safeParse(input);
            if (!validation.success) {
                return {
                    success: false,
                    error: {
                        code: "INVALID_TOOL_ARGUMENTS",
                        message: validation.error.issues
                            .map((issue) => {
                                const path =
                                    issue.path.join(".") ||
                                    "input";

                                return `${path}: ${issue.message}`;
                            })
                            .join("; ")
                    }
                };
            }
            return definition.handler(
                validation.data,
                context
            );
        }
    }
}
