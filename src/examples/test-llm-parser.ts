import "dotenv/config";
import OpenAI from "openai";
import type { CommandModelProvider } from "../model/command-model-provider";
import { parseLlmCommand } from "../parser/llm-command-parser";
import { DeepSeekCommandModelProvider } from "../providers/deepseek-command-model-provider";
import { OpenAICommandModelProvider } from "../providers/openai-command-model-provider";

function requireEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not configured in .env.`);
    }
    return value;
}

/** 根据 MODEL_PROVIDER 环境变量创建 OpenAI 或 DeepSeek Provider。 */
function createProvider(): CommandModelProvider {
    const providerName = process.env.MODEL_PROVIDER ?? "deepseek";

    switch (providerName) {
        case "openai":
            return new OpenAICommandModelProvider(
                new OpenAI({
                    apiKey: requireEnvironmentVariable("OPENAI_API_KEY"),
                    timeout:Number(
                        process.env.OPENAI_TIMEOUT_MS??"15000"
                    ),
                    maxRetries:Number(
                        process.env.OPENAI_MAX_RETRIES??"1"
                    )   
                }),
                process.env.OPENAI_MODEL ?? "gpt-5.6",
            );
        case "deepseek":
            return new DeepSeekCommandModelProvider({
                apiKey: requireEnvironmentVariable("DEEPSEEK_API_KEY"),
                model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
            });
        default:
            throw new Error(`Unsupported MODEL_PROVIDER: ${providerName}`);
    }
}

const provider = createProvider();

const result = await parseLlmCommand(
    "Begin cooking at two hundred twenty-five degrees Fahrenheit for two hours",
    {
        deviceId: "grill-demo-001",
        deviceType: "pellet_grill",
        now: new Date(),
    },
    provider,
);

console.dir(result, {
    depth: null,
});

if (!result.success) {
    process.exitCode = 1;
}
