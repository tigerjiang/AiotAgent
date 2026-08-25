//模型只生成待审批操作
import { z } from "zod";
import type OpenAI from "openai";
import type { DeviceToolRegistry } from "../tools/device-tool-registry";
import type { DeviceToolContext } from "../tools/device-tool";
import { InMemoryApprovalStore } from "../approval/in-memory-approval-store";
import strict from "node:assert/strict";
import { required } from "zod/mini";
import { access } from "node:fs";

export const StartCookingInputSchema = z.object({
    temperatureFahrenheit: z.number().int().min(165).max(500),
    durationMinutes: z.number().int().min(1).max(1440).nullable(),
    probeTargetFahrenheit: z.number().int().min(100).max(220).nullable(),
}).strict();

const startCookintTool = {
    type: "function" as const,
    name: "start_cooking",
    description: "Propose starting a cooking program. Requires user approval.",
    strict: true,
    parameters: {
        type: "object",
        properties: {
            temperatureFahrenheit: {
                type: "integer",
                minimum: 165,
                maximum: 500,
            },
            durationMinutes: {
                type: ["integer", "null"],
                minimum: 1,
                maximum: 1440,
            },
            probeTargetFahrenheit: {
                type: ["integer", "null"],
                minimum: 100,
                maximum: 220,
            },
        },
        required: [
            "temperatureFahrenheit",
            "durationMinutes",
            "probeTargetFahrenheit",
        ],
        additionalProperties: false,

    },
};
type CreateResponse = (
    input: OpenAI.Responses.ResponseCreateParamsNonStreaming,
): Promise<OpenAI.Responses.Response>

interface Dependencies {
    createResponse: CreateResponse;
    registry: DeviceToolRegistry;
    approvals: InMemoryApprovalStore;
    toolContext: DeviceToolContext;
    model: string;
    now?: () => Date;
}

export async function proposeStartCooking(
    userInput: string,
    deps: Dependencies
) {
    const input: OpenAI.Responses.ResponseInput = [
        { role: "user", content: userInput },
    ];

    const response = await deps.createResponse({
        model: deps.model,
        instructions:
            "Extract a start_cooking proposal. Never claim the device has started.",
        input,
        tools: [startCookintTool],
        tool_choice: {
            type: "function",
            name: "start_cooking",
        },
        parallel_tool_calls: false,
        store: false
    });


    const call = response.output.find(
        item =>
            item.type === "function_call" &&
            item.name === "start_cooking",
    );

    if (!call || call.type !== "function_call") {
        throw new Error("START_COOKING_CALL_MISSING");
    }
    const args = StartCookingInputSchema.parse(
        JSON.parse(call.arguments),
    );
    const now = deps.now?.() ?? new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000);

    const approval = deps.approvals.create(
        {
            deviceId: deps.toolContext.deviceId,
            deviceType: deps.toolContext.deviceType,
            toolName: "start_cooking",
            arguments: args,
            callId: call.call_id,
            continuationInput: [...input, ...response.output],
            createdAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
        }
    );
    // 不返回 continuationInput，避免客户端篡改模型上下文
    return {
        status: "approval_required" as const,
        approvalId: approval.approvalId,
        expiresAt: approval.expiresAt,
        action: {
            toolName: approval.toolName,
            arguments: approval.arguments,
        }
    }
}