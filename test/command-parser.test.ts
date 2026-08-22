import { describe, it, expect, vi } from "vitest";
import type { CommandModelProvider } from "../src/model/command-model-provider";
import type { ModelCommand } from "../src/model/model-command";
import { ModelProviderError } from "../src/model/model-provider-error";
import { parseCommand } from "../src/parser/command-parser";
import { Mode } from "node:fs";
import { parse } from "node:path";

const context = {
    deviceId: "grill-demo-001",
    deviceType: "pellet_grill" as const,
    now: new Date("2026-08-13T00:00:00.000Z")
}

function createProvider(output: ModelCommand) {
    const parseMock = vi.fn<CommandModelProvider["parse"]>()
        .mockResolvedValue(output)

    const provider: CommandModelProvider = {
        parse: parseMock
    }

    return {
        provider,
        parseMock
    }
}

describe("parseCommand", () => {
    it("uses rules for an explicit command", async () => {
        const { provider, parseMock } =
            createProvider({
                intent: "unknown",
                temperatureFahrenheit: null,
                durationMinutes: null,
                probeTargetFahrenheit: null
            });

        const result = await parseCommand(
            "把烤炉温度设置到300°F",
            context,
            provider
        );
        expect(result.success).toBe(true);
        expect(result.source).toBe("rule");
        expect(parseMock).not.toHaveBeenCalled();
    });

    it("falls back to the LLM for unsupported wording", async () => {
        const { provider, parseMock } =
            createProvider(
                {
                    intent: "set_temperature",
                    temperatureFahrenheit: 300,
                    durationMinutes: null,
                    probeTargetFahrenheit: null,
                }
            );

        const result = await parseCommand(
            "Please make it three hundred degrees Fahrenheit",
            context,
            provider
        );

        expect(result.success).toBe(true);
        expect(result.source).toBe("llm");
        expect(parseMock).toHaveBeenCalledOnce();
        if (result.success &&
            result.command.intent === "set_temperature"
        ) {
            expect(result.command.parameters.temperatureFahrenheit).toBe(300);
        };
    });

    it("do not use the LLM when a parameter is missing", async () => {
        const { provider, parseMock } =
            createProvider({
                intent: "start_cooking",
                temperatureFahrenheit: 225,
                durationMinutes: null,
                probeTargetFahrenheit: null

            });

        const result = await parseCommand(
            "启动烤炉",
            context,
            provider
        );

        expect(result.success).toBe(false);
        expect(result.source).toBe("rule");
        expect(parseMock).not.toHaveBeenCalled();

        if (!result.success) {
            expect(result.error.code).toBe("MISSING_PARAMETER");
        }
    });

    it("does not let the LLM override an unsafe command", async () => {
        const { provider, parseMock } =
            createProvider({
                intent: "set_temperature",
                temperatureFahrenheit: 300,
                durationMinutes: null,
                probeTargetFahrenheit: null
            });
        const result = await parseCommand(
            "Set temperature to 600°F",
            context,
            provider
        )

        expect(result.success).toBe(false);
        expect(result.source).toBe("rule");
        expect(parseMock).not.toHaveBeenCalled();

        if (!result.success) {
            expect(result.error.code).toBe("INVALID_COMMAND");
        }
    });

    it("preserves an LLM provider failure", async () => {
        const parseMock = vi.fn<CommandModelProvider["parse"]>().mockRejectedValue(
            new ModelProviderError(
                "TIMEOUT",
                "Model provider request timed out."
            )
        );
        const provider: CommandModelProvider = {
            parse: parseMock
        };

        const result = await parseCommand(
            "Please make it three hundred degrees Fahrenheit",
            context,
            provider
        );

        expect(result.success).toBe(false);
        expect(result.source).toBe("llm");

        if (!result.success) {
            expect(result.error.code).toBe("MODEL_TIMEOUT");
        }
    });

})