import { z } from "zod";

import {
    AgentStateSchema,
    type AgentError,
    type AgentState,
    type AgentToolName
} from "./agent-state";

const READ_ONLY_TOOLS = new Set<AgentToolName>([
    "get_device_state",
]);

// 这些字段由应用上下文和审批工作流持有；工具参数只能表达用户意图，不能夹带系统决策。
const FORBIDDEN_ARGUMENT_KEYS = new Set([
    "tenantId",
    "userId",
    "deviceId",
    "requestId",
    "confirmed",
    "approvalId",
]);

export type AgentExecutionDecision =
    | {
        status: "ready";
        writeTools: AgentToolName[];
    }
    | {
        status: "approval_required";
        writeTools: AgentToolName[];
    }
    | {
        status: "rejected";
        errors: AgentError[];
    }

function toStateErrors(
    error: z.ZodError
): AgentError[] {
    return error.issues.map((issue) => ({
        code: "INVALID_AGENT_STATE",
        message: `${issue.path.join(".") || "state"
            }:&{issue.message}`,
        source: "state" as const,
        retryable: false
    }));
}

function isWriteTool(
    toolName: AgentToolName
): boolean {
    return !READ_ONLY_TOOLS.has(toolName);
}

function findForbiddenArgumentErrors(
    state: AgentState
): AgentError[] {
    if (!state.plan) {
        return [];
    }

    const errors: AgentError[] = [];
    for (const step of state.plan.steps) {
        for (const key of Object.keys(step.arguments)) {
            if (FORBIDDEN_ARGUMENT_KEYS.has(key)) {
                errors.push({
                    code: "FORBIDDEN_TOOL_ARGUMENT",
                    message: `Step ${step.stepId} can not provide system field ${key}`,
                    source: "validator",
                    retryable: false
                });
            }
        }
    }
    return errors;
}

export function validateAgentStateForExecution(input: unknown)
    : AgentExecutionDecision {
    // 在执行边界重新解析完整状态，防止调用方绕过 transition helper 传入伪造的局部状态。
    const parsed = AgentStateSchema.safeParse(input);
    if (!parsed.success) {
        return {
            status: "rejected",
            errors: toStateErrors(parsed.error)
        };
    }
    const state = parsed.data;
    if (!state.plan) {
        return {
            status: "rejected",
            errors: [
                {
                    code: "PLAN_MISSING",
                    message:
                        "A validated candidate plan is required before execution.",
                    source: "validator",
                    retryable: false
                },
            ]
        }
    }
    const forbiddenArgumentErrors =
        findForbiddenArgumentErrors(state);

    if (forbiddenArgumentErrors.length > 0) {
        return {
            status: "rejected",
            errors: forbiddenArgumentErrors
        };
    }

    const writeTools = state.plan.steps
        .map((step) => step.toolName).filter(isWriteTool);

    // 写操作必须基于可信设备快照，避免在未知或过期状态上批准设备变更。
    if (writeTools.length > 0 &&
        state.deviceState === null
    ) {
        return {
            status: "rejected",
            errors: [
                {
                    code: "TRUSTED_DEVICE_STATE_REQUIRED",
                    message:
                        "A write plan requires the latest trusted reported device state.",
                    source: "validator",
                    retryable: false
                }
            ]
        };
    }

    // 所有写工具都必须经过用户/应用审批；只读 plan 可以跳过审批流程。
    if (writeTools.length > 0 && state.approval.status !== "approved") {
        return {
            status: "approval_required",
            writeTools
        };
    }
    return {
        status: "ready",
        writeTools
    };
}
