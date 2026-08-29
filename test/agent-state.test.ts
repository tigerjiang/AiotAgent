import {
    describe,
    expect,
    it,
} from "vitest";

import type {
    TrustedReportedStateSnapshot,
} from "../src/messaging/in-memory-reported-state-projection.js";

import {
    attachTrustedDeviceState,
    createInitialAgentState,
    setApprovalState,
    setCandidatePlan,
} from "../src/agent/agent-state-transitions.js";

import {
    validateAgentStateForExecution,
} from "../src/agent/agent-state-validator.js";
const input = {
    requestId:
        "65a6bddd-686f-4bd9-9f2f-182cecb232a8",
    tenantId: "brisk-it",
    userId: "user-001",
    deviceId: "grill-demo-001",
    message: "Set my grill to 225 degrees.",
    locale: "en-US",
};

const trustedSnapshot: TrustedReportedStateSnapshot = {
    acceptedAt: "2026-08-22T00:00:05.000Z",
    event: {
        schemaVersion: "1.0",
        eventId:
            "4495f9fe-f1c8-43b7-973e-85629542567d",
        tenantId: "brisk-it",
        deviceId: "grill-demo-001",
        deviceType: "pellet_grill",
        sequence: 43,
        reportedAt:
            "2026-08-22T00:00:00.000Z",
        firmwareVersion: "2.4.1",
        state: {
            phase: "cooking",
            currentTemperatureFahrenheit: 221,
            targetTemperatureFahrenheit: 225,
            timerRemainingSeconds: 5340,
            probeTemperatureFahrenheit: 165,
            probeTargetFahrenheit: 203,
            faultCodes: [],
        },
    },
};

const readPlan = {
    rationale:
        "Read current state before answering the user.",
    steps: [
        {
            stepId: "step-1",
            toolName: "get_device_state",
            arguments: {},
        },
    ],
};

const writePlan = {
    rationale:
        "Change the target temperature after validation and approval.",
    steps: [
        {
            stepId: "step-1",
            toolName: "set_temperature",
            arguments: {
                temperatureFahrenheit: 225,
            },
        },
        {
            stepId: "step-2",
            toolName: "set_timer",
            arguments: {
                durationMinutes: 120,
            },
        },
    ],
};

describe("AgentState", () => {

    it("creates a minimal initial state", () => {
        const state = createInitialAgentState(input);
        expect(state).toEqual({
            version: "1.0",
            input,
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
    });

    it("rejects extra identity input fields", () => {
        // 未知身份字段必须立即失败，不能被静默丢弃；认证上下文只能由应用持有。
        expect(() =>
            createInitialAgentState({
                ...input,
                isAdmin: true,
            }),
        ).toThrow();
    });

    it("attaches a Day 14 trusted state snapshot", () => {
        const state = attachTrustedDeviceState(
            createInitialAgentState(input),
            trustedSnapshot,
        );

        expect(state.deviceState).toMatchObject({
            acceptedAt: "2026-08-22T00:00:05.000Z",
            event: {
                deviceId: "grill-demo-001",
                sequence: 43,
                state: {
                    phase: "cooking",
                },
            },
        });
    });

    it("allows a validated read-only plan without approval", () => {
        const state = setCandidatePlan(
            createInitialAgentState(input),
            readPlan
        );

        expect(
            validateAgentStateForExecution(state),
        ).toEqual({
            status: "ready",
            writeTools: [],
        });

    });

    it("rejects a write plan without trusted state", () => {
        const state = setCandidatePlan(
            createInitialAgentState(input),
            writePlan
        );

        expect(validateAgentStateForExecution(state)).toMatchObject({
            status: "rejected",
            errors: [
                { code: "TRUSTED_DEVICE_STATE_REQUIRED" },
            ],
        });

    });

    it("requires approval for a write plan with trusted state", () => {

        const initial = createInitialAgentState(input);
        const withState = attachTrustedDeviceState(
            initial,
            trustedSnapshot,
        );

        const withPlan = setCandidatePlan(
            withState,
            writePlan,
        );

        expect(
            validateAgentStateForExecution(withPlan),
        ).toEqual({
            status: "approval_required",
            writeTools: ["set_temperature","set_timer"],
        });
    });

    it("allows a write plan only after application approval", () => {

        const initial = createInitialAgentState(input);
        const withState = attachTrustedDeviceState(
            initial,
            trustedSnapshot,
        );
        const withPlan = setCandidatePlan(
            withState,
            writePlan,
        );
        const approved = setApprovalState(withPlan,
            {
                status: "approved",
                approvalId:
                    "68adb3a6-7984-4610-ae3a-730579f42248",
                expiresAt:
                    "2026-08-22T00:10:00.000Z",
            });

        expect(
            validateAgentStateForExecution(approved)
        ).toEqual({
            status: 'ready',
            writeTools: ["set_temperature", "set_timer"]
        })

    });

    it("rejects system fields injected into tool arguments", () => {
        const initial = createInitialAgentState(input);
        const withState = attachTrustedDeviceState(
            initial,
            trustedSnapshot,
        );
        const withPlan = setCandidatePlan(
            withState,
            {
                ...writePlan,
                steps: [
                    {
                        ...writePlan.steps[0],
                        arguments: {
                            temperatureFahrenheit: 225,
                            confirmed: true,
                        },
                    },
                ],
            })

        expect(
            validateAgentStateForExecution(withPlan)
        ).toMatchObject({
            status: "rejected",
            errors: [{
                code: "FORBIDDEN_TOOL_ARGUMENT",
                source: "validator",
            }]
        });

    });

});
