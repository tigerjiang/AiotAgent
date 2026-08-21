import { describe, expect, it, vi } from "vitest";
import type { CommandModelProvider } from "../src/model/command-model-provider.js";
import type { ModelCommand } from "../src/model/model-command.js";
import { parseLlmCommand } from "../src/parser/llm-command-parser.js";

const context = {
  deviceId: "grill-demo-001",
  deviceType: "pellet_grill" as const,
  now: new Date("2026-08-11T00:00:00.000Z")
};

function createProvider(
  output: ModelCommand
): CommandModelProvider {
  return {
    parse: vi.fn().mockResolvedValue(output)
  };
}

describe("parseLlmCommand", () => {
  it("converts model output into a device command", async () => {
    const provider = createProvider({
      intent: "start_cooking",
      temperatureFahrenheit: 225,
      durationMinutes: 120,
      probeTargetFahrenheit: null
    });

    const result = await parseLlmCommand(
      "Cook at 225°F for two hours",
      context,
      provider
    );

    expect(result.success).toBe(true);

    if (result.success && result.command.intent === "start_cooking") {
      expect(result.command.deviceId).toBe("grill-demo-001");
      expect(result.command.parameters.temperatureFahrenheit).toBe(225);
      expect(result.command.parameters.durationMinutes).toBe(120);
      expect(result.command.issueAt).toBe(
        "2026-08-11T00:00:00.000Z"
      );
    }
  });

  it("rejects an unknown intent", async () => {
    const provider = createProvider({
      intent: "unknown",
      temperatureFahrenheit: null,
      durationMinutes: null,
      probeTargetFahrenheit: null
    });

    const result = await parseLlmCommand(
      "What is the weather today?",
      context,
      provider
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.code).toBe("UNSUPPORTED_INTENT");
    }
  });

  it("rejects start cooking without temperature", async () => {
    const provider = createProvider({
      intent: "start_cooking",
      temperatureFahrenheit: null,
      durationMinutes: 60,
      probeTargetFahrenheit: null
    });

    const result = await parseLlmCommand(
      "Start cooking for one hour",
      context,
      provider
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.code).toBe("MISSING_PARAMETER");
    }
  });

  it("rejects an unsafe model-generated temperature", async () => {
    const provider = createProvider({
      intent: "set_temperature",
      temperatureFahrenheit: 700,
      durationMinutes: null,
      probeTargetFahrenheit: null
    });

    const result = await parseLlmCommand(
      "Set the temperature to 700°F",
      context,
      provider
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.code).toBe("INVALID_COMMAND");
    }
  });

  it("converts provider failures into MODEL_ERROR", async () => {
    const provider: CommandModelProvider = {
      parse: vi.fn().mockRejectedValue(
        new Error("Model service unavailable")
      )
    };

    const result = await parseLlmCommand(
      "Start cooking at 225°F",
      context,
      provider
    );

    expect(result).toEqual({
      success: false,
      error: {
        code: "MODEL_ERROR",
        message: "Model service unavailable"
      }
    });
  });
});