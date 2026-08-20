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
        }

    }