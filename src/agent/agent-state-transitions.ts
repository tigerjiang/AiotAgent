import type {
    TrustedReportedStateSnapshot
} from "../messaging/in-memory-reported-state-projection";

import {
    AgentApprovalSchema,
    AgentInputSchema,
    AgentPlanSchema,
    AgentStateSchema,
    type AgentApproval,
    type AgentInput,
    type AgentPlan,
    type AgentState,
} from "./agent-state";

export function createInitialAgentState(
    input: unknown
): AgentState {

    // 只有已认证的应用输入可以创建状态；这里先解析，避免身份字段进入 planner 可控数据。
    const parsedInput = AgentInputSchema.parse(input);

    return AgentStateSchema.parse({
        version: "1.0",
        input: parsedInput,
        deviceState: null,
        plan: null,
        approval: {
            status: "not_required",
            approvalId: null,
            expiresAt: null,
        },
        errors: [],
        output: null
    });
}

export function attachTrustedDeviceState(
    state: AgentState,
    snapShot: TrustedReportedStateSnapshot
): AgentState {

    // 设备状态只能来自可信 reported-state 投影，不能来自模型输出或用户提供的工具参数。
    return AgentStateSchema.parse({
        ...state,
        deviceState: snapShot
    });

}

export function setCandidatePlan(
    state: AgentState,
    candidate: unknown
): AgentState {

    // 新 plan 会让旧的执行产物失效，确保验证总是基于当前候选 plan 的干净状态。
    const plan: AgentPlan = AgentPlanSchema.parse(candidate);
    return AgentStateSchema.parse({
        ...state,
        plan,
        approval: {
            status: "not_required",
            approvalId: null,
            expiresAt: null,
        },
        errors: [],
        output: null,
    });
}

export function setApprovalState(
    state: AgentState,
    value: unknown
): AgentState {

    // approval 属于应用工作流状态；planner 只能触发审批需求，不能直接写入审批结果。
    const approval: AgentApproval = AgentApprovalSchema.parse(value);

    return AgentStateSchema.parse({
        ...state,
        approval
    });

}
