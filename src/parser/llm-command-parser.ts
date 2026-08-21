import { randomUUID } from "crypto";
import { DeviceCommandSchema, type DeviceCommand } from "../domain/device-command";
import type { CommandModelProvider } from "../model/command-model-provider";
import type { RuleParseContext } from "./rule-command-parser";
export type LlmParseResult =
    | {
        success: true,
        command: DeviceCommand,
    }
    | {
        success: false,
        error: {
            code:
            | "UNSUPPORTED_INTENT"
            | "MISSING_PARAMETER"
            | "INVALID_COMMAND"
            | "MODEL_ERROR";
            message: string;
        };

    };

export async function parseLlmCommand(
    rawInput: string,
    context: RuleParseContext,
    provider: CommandModelProvider
): Promise<LlmParseResult> {
    try {
        const parsed = await provider.parse(rawInput, {
            deviceType: context.deviceType
        });
        if (parsed.intent === "unknown") {
            return {
                success: false,
                error: {
                    code: "UNSUPPORTED_INTENT",
                    message: "The ruquest does not contain a supported device command."
                }
            };
        }
        const baseCommand = {
            requestId: randomUUID(),
            deviceId: context.deviceId,
            deviceType: context.deviceType,
            issueAt: (context.now ?? new Date()).toISOString(),
            requiresConfirmation: true
        };
        let candidate: unknown;
        switch (parsed.intent) {
            case "start_cooking": {
                if (parsed.temperatureFahrenheit === null) {
                    return {
                        success: false,
                        error: {
                            code: "MISSING_PARAMETER",
                            message: "Cooking temperature is required."
                        }

                    };
                }
                candidate = {
                    ...baseCommand,
                    intent: "start_cooking",
                    parameters: {
                        temperatureFahrenheit: parsed.temperatureFahrenheit,
                        ...(parsed.durationMinutes === null
                            ? {}
                            : { durationMinutes: parsed.durationMinutes }),
                        ...(parsed.probeTargetFahrenheit === null
                            ? {}
                            : {
                                probeTargetFahrenheit:
                                    parsed.probeTargetFahrenheit
                            }),


                    }
                };
                break;
            }
            case "set_temperature": {
                if (parsed.temperatureFahrenheit === null) {
                    return {
                        success: false,
                        error: {
                            code: "MISSING_PARAMETER",
                            message: "Target temperature is required."
                        }
                    };
                }

                candidate = {
                    ...baseCommand,
                    intent: "set_temperature",
                    parameters: {
                        temperatureFahrenheit: parsed.temperatureFahrenheit
                    }
                };
                break;
            }
            case "set_timer": {
                if (parsed.durationMinutes === null) {
                    return {
                        success: false,
                        error: {
                            code: "MISSING_PARAMETER",
                            message: "Timer duration is required."
                        }
                    };
                }

                candidate = {
                    ...baseCommand,
                    intent: "set_timer",
                    parameters: {
                        durationMinutes: parsed.durationMinutes
                    }
                };
                break;
            }

            case "shutdown": {
                candidate = {
                    ...baseCommand,
                    intent: "shutdown",
                    parameters: {}
                };
                break;
            }
        }

        const validation = DeviceCommandSchema.safeParse(candidate);
        if (!validation.success) {
            return {
                success: false,
                error: {
                    code: "INVALID_COMMAND",
                    message: validation.error.issues.map((issue) => {
                        return `${issue.path.join(".")}: ${issue.message}`;
                    })
                        .join("; ")
                }

            };
        }
        return {
            success: true,
            command: validation.data
        };

    } catch (error) {
        return {
            success: false,
            error: {
                code: "MODEL_ERROR",
                message:
                    error instanceof Error
                        ? error.message
                        : "Unknown model service error."
            }
        };

    }

}
