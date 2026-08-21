import { randomUUID } from "crypto";
import { DeviceCommandSchema, type DeviceCommand } from "../domain/device-command";
import type { CommandModelProvider } from "../model/command-model-provider";
import type { RuleParseContext } from "./rule-command-parser";
import {
    ModelProviderError,
    type ModelProviderErrorCode
} from "../model/model-provider-error.js";

export type LlmParseErrorCode =
    | "UNSUPPORTED_INTENT"
    | "MISSING_PARAMETER"
    | "INVALID_COMMAND"
    | "MODEL_AUTHENTICATION_ERROR"
    | "MODEL_RATE_LIMIT_ERROR"
    | "MODEL_TIMEOUT"
    | "MODEL_UNAVAILABLE"
    | "MODEL_INVALID_REQUEST"
    | "MODEL_ERROR";

export type LlmParseResult =
    | {
        success: true,
        command: DeviceCommand,
    }
    | {
        success: false,
        error: {
            code: LlmParseErrorCode;
            message: string;
        };

    };

const MODEL_ERROR_CODE_MAP: Record<
    ModelProviderErrorCode,
    LlmParseErrorCode
> = {
    AUTHENTICATION: "MODEL_AUTHENTICATION_ERROR",
    RATE_LIMIT: "MODEL_RATE_LIMIT_ERROR",
    TIMEOUT: "MODEL_TIMEOUT",
    CONNECTION: "MODEL_UNAVAILABLE",
    INVALID_REQUEST: "MODEL_INVALID_REQUEST",
    UPSTREAM: "MODEL_UNAVAILABLE",
    UNKNOWN: "MODEL_ERROR"
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
        if (error instanceof ModelProviderError) {
            return {
                success: false,
                error: {
                    code: MODEL_ERROR_CODE_MAP[error.code],
                    message: error.message
                }
            };
        }
        return {
            success: false,
            error: {
                code: "MODEL_ERROR",
                message: "Model service unavailable"
            }
        };

    }

}
