import "dotenv/config";
import OpenAI from "openai";
import {
    InMemoryDeviceGateway
} from "../device/in-memory-device-gateway.js";
import {
    runDeviceStatusAgent,
    type DeviceStatusModelProvider
} from "../agent/device-status-agent.js";
import {
    createDeviceTools
} from "../tools/create-device-tools.js";
import {
    DeviceToolRegistry
} from "../tools/device-tool-registry.js";

function requireEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not configured in .env.`);
    }
    return value;
}

function getProviderName(): DeviceStatusModelProvider {
    const providerName = process.env.MODEL_PROVIDER ?? "deepseek";
    if (providerName === "openai" || providerName === "deepseek") {
        return providerName;
    }
    throw new Error(`Unsupported provider: ${providerName}`);
}

function getModel(): string {
    const providerName = process.env.MODEL_PROVIDER ?? "deepseek";
    switch (providerName) {
        case "openai":
            return process.env.OPENAI_MODEL ?? "gpt-5.6";
        case "deepseek":
            return process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
        default:
            throw new Error("Unknown model");
    };
}

/** 根据 MODEL_PROVIDER 环境变量创建 OpenAI 或 DeepSeek Provider。 */
function createClient(): OpenAI {
    const providerName = process.env.MODEL_PROVIDER ?? "deepseek";

    switch (providerName) {
        case "openai":
            return new OpenAI({
                apiKey: requireEnvironmentVariable("OPENAI_API_KEY"),
                timeout: Number(
                    process.env.OPENAI_TIMEOUT_MS ?? "15000"
                ),
                maxRetries: Number(
                    process.env.OPENAI_MAX_RETRIES ?? "1"
                )
            })

        case "deepseek":
            return new OpenAI({
                apiKey: requireEnvironmentVariable("DEEPSEEK_API_KEY"),
                baseURL: requireEnvironmentVariable("DEEPSEEK_BASE_URL"),
                timeout: Number(
                    process.env.DEEPSEEK_TIMEOUT_MS ?? "15000"
                ),
                maxRetries: Number(
                    process.env.DEEPSEEK_MAX_RETRIES ?? "1"
                )
            });
        default:
            throw new Error(`Unsupported Client: ${providerName}`);
    }
}

const providerName = getProviderName();
const client = createClient();

const gateway =
    new InMemoryDeviceGateway([
        {
            deviceId: "grill-demo-001",
            deviceType: "pellet_grill",
            connection: "online",
            phase: "cooking",
            currentTemperatureFahrenheit: 185,
            targetTemperatureFahrenheit: 225,
            timerRemainingMinutes: 120,
            updatedAt: new Date().toISOString()
        }
    ]);

const registry =
    new DeviceToolRegistry(
        createDeviceTools()
    );
const result = await runDeviceStatusAgent(
    "现在烤炉是什么状态",
    {
        createResponse: (params) =>
            client.responses.create(params),
        model: getModel() ?? "unknown",
        provider: providerName,
        registry,
        toolContext: {
            gateway,
            deviceId: "grill-demo-001",
            deviceType: "pellet_grill",
            confirmed: false
        }
    });
    
console.dir(result, {
    depth: null
});
