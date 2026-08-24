//创建只读状态Agent
import OpenAI from "openai";
import type { DeviceToolContext } from "../tools/device-tool";
import type { DeviceToolRegistry } from "../tools/device-tool-registry";

const INSTRUCTIONS = [
    "You are a smart cooking device status assistant.",
    "Always use get_device_state before answering a device status question.",
    "Describe only information returned by the tool.",
    "Do not claim that you started, stopped, or changed the device.",
    "Keep the final answer short and clear.",
    "Answer in the same language as the user."
].join("\n");

const tools: OpenAI.Responses.Tool[] = [
    {
        type: "function",
        name: "get_device_state",
        description:
            "Get the current connection, operating phase, temperature, target temperature, and timer of the user's active cooking device.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
        },
        strict: true
    }
];

export type CreateResponse = (
    params: OpenAI.Responses.ResponseCreateParamsNonStreaming
) => Promise<OpenAI.Responses.Response>

export type DeviceStatusModelProvider = "openai" | "deepseek";

export interface DeviceStatusAgentOptions {
    createResponse: CreateResponse;
    model: string;
    /** 控制不同供应商的 Responses API 兼容参数。默认使用 OpenAI。 */
    provider?: DeviceStatusModelProvider;
    registry: DeviceToolRegistry;
    toolContext: DeviceToolContext;
}

export interface DeviceStatusAgentResult {
    answer: string;
    calledTools: string[];
}

export async function runDeviceStatusAgent(
    userInput: string,
    options: DeviceStatusAgentOptions
): Promise<DeviceStatusAgentResult> {
    const provider = options.provider ?? "openai";
    const isDeepSeek = provider === "deepseek";
    const input: OpenAI.Responses.ResponseInput = [
        {
            role: "user",
            content: userInput
        }
    ];


    // 第一轮强制读取设备状态。
    // 这个Agent只负责设备状态问题。
    let response = await options.createResponse({
        model: options.model,
        instructions: INSTRUCTIONS,
        input,
        tools,
        ...(isDeepSeek
            ? {}
            : {
                tool_choice: {
                    type: "function" as const,
                    name: "get_device_state"
                }
            }),
        parallel_tool_calls: false,
        store: false
    });

    // 必须保留模型返回的function_call，
    // 下一轮需要通过call_id关联工具结果。

    const calledTools: string[] = [];

    for (const item of response.output) {
        if (item.type != "function_call") {
            continue;
        }
        // 保存模型的 function_call，下一轮通过 call_id 关联
        input.push(item);
        calledTools.push(item.name);
        let argumentsValue: unknown;

        try {
            argumentsValue = JSON.parse(
                item.arguments
            );
        } catch {
            argumentsValue = {};
        }

        const toolResult = await options.registry.execute(
            item.name,
            argumentsValue,
            options.toolContext
        );
        input.push({
            type: "function_call_output",
            call_id: item.call_id,
            output: JSON.stringify(toolResult)
        });


    }

    if (calledTools.length === 0) {
        throw new Error(
            "The model did not return the required device status tool call."
        );
    }

    // OpenAI 保留 tools 并明确禁止再次调用；DeepSeek thinking 不支持
    // tool_choice，因此第二轮不提供 tools，只生成最终文字。
    response = await options.createResponse(
        {
            model: options.model,
            instructions: INSTRUCTIONS,
            input,
            ...(isDeepSeek
                ? {}
                : {
                    tools,
                    tool_choice: "none" as const,
                    parallel_tool_calls: false
                }),
            store: false
        }
    );
    return {
        answer: response.output_text,
        calledTools
    };
}
