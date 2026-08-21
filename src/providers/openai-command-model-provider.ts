import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
    CommandModelContext,
    CommandModelProvider,
} from "../model/command-model-provider";
import { ModelCommandSchema, type ModelCommand } from "../model/model-command";
import { ModelProviderError,normalizeOpenAIError } from "../model/model-provider-error";

const SYSTEM_PROMPT = [
    "Extract exactly one smart-cooking device command.",
    "Only extract information explicitly provided by the user.",
    "Do not execute any device operation.",
    "Do not generate deviceId, requestId, timestamps, or confirmation decisions.",
    "Convert explicitly stated Celsius temperatures to Fahrenheit.",
    "Round converted Fahrenheit temperatures to the nearest integer.",
    "Convert hours to integer minutes.",
    "Use null when a parameter is not provided.",
    "Use intent=unknown for unrelated, ambiguous, or unsupported requests."
].join("\n");



export class OpenAICommandModelProvider implements CommandModelProvider {
    constructor(
        private readonly client: OpenAI,
        private readonly model: string
    ) { }
    async parse(input: string,
        context: CommandModelContext): Promise<ModelCommand> {
        try {
            const response = await this.client.responses.parse({
                model: this.model,
                input: [
                    {
                        role: "system",
                        content: [SYSTEM_PROMPT, `Current deivce type : ${context.deviceType}.`].join("\n")
                    },
                    {
                        role: "user",
                        content: input
                    }
                ],
                text: {
                    format: zodTextFormat(ModelCommandSchema, "device_command_intent")
                }
            });
            if (!response.output_parsed) {
                throw new ModelProviderError(
                    "INVALID_REQUEST",
                    "The model did not return a parsed command."
                );
            }
            return response.output_parsed;
        } catch (error) {
            if (error instanceof ModelProviderError) {
                throw error;
            }
            throw normalizeOpenAIError(error)

        }

    }
}