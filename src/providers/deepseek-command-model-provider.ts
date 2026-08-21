import OpenAI from "openai";
import type {
    CommandModelContext,
    CommandModelProvider,
} from "../model/command-model-provider";
import { ModelCommandSchema, type ModelCommand } from "../model/model-command";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";

const SYSTEM_PROMPT = [
    "Extract exactly one smart-cooking device command.",
    "Only extract information explicitly provided by the user.",
    "Do not execute any device operation.",
    "Do not generate deviceId, requestId, timestamps, or confirmation decisions.",
    "Convert explicitly stated Celsius temperatures to Fahrenheit.",
    "Round converted Fahrenheit temperatures to the nearest integer.",
    "Convert hours to integer minutes.",
    "Use null when a parameter is not provided.",
    "Use intent=unknown for unrelated, ambiguous, or unsupported requests.",
    "Return JSON only, without Markdown or explanatory text.",
    "The JSON object must use exactly this shape:",
    '{"intent":"start_cooking|set_temperature|set_timer|shutdown|unknown","temperatureFahrenheit":225,"durationMinutes":120,"probeTargetFahrenheit":null}',
].join("\n");

/** DeepSeek Provider 的连接和模型配置。 */
export interface DeepSeekCommandModelProviderOptions {
    apiKey: string;
    model?: string;
    baseURL?: string;
    maxTokens?: number;
}

/** 使用 DeepSeek Chat Completions API 将自然语言解析为设备命令。 */
export class DeepSeekCommandModelProvider implements CommandModelProvider {
    private readonly client: OpenAI;
    private readonly model: string;
    private readonly maxTokens: number;

    constructor(options: DeepSeekCommandModelProviderOptions) {
        if (!options.apiKey.trim()) {
            throw new Error("DeepSeek API key is required.");
        }

        this.client = new OpenAI({
            apiKey: options.apiKey,
            baseURL: options.baseURL ?? DEFAULT_BASE_URL,
        });
        this.model = options.model ?? DEFAULT_MODEL;
        this.maxTokens = options.maxTokens ?? 512;
    }

    /** 请求 DeepSeek，并校验返回的 JSON 是否符合 ModelCommandSchema。 */
    async parse(
        input: string,
        context: CommandModelContext,
    ): Promise<ModelCommand> {
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: [
                {
                    role: "system",
                    content: [
                        SYSTEM_PROMPT,
                        `Current device type: ${context.deviceType}.`,
                    ].join("\n"),
                },
                {
                    role: "user",
                    content: input,
                },
            ],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: this.maxTokens,
        });

        const content = response.choices[0]?.message.content;
        if (!content) {
            throw new Error("DeepSeek did not return a command.");
        }

        let decoded: unknown;
        try {
            decoded = JSON.parse(content);
        } catch {
            throw new Error("DeepSeek returned invalid JSON.");
        }

        const validation = ModelCommandSchema.safeParse(decoded);
        if (!validation.success) {
            const issues = validation.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ");
            throw new Error(`DeepSeek returned an invalid command: ${issues}`);
        }

        return validation.data;
    }
}
