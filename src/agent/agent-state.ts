import { z } from "zod";
import {
    DeviceReportedStateEventSchema
} from "../messaging/device-reported-state-event";
import { app } from "../app";


// /定义 AgentState Schema

const EntityIdSchema = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/);

const ToolArgumentsSchema = z
    .object({})
    .catchall(z.unknown());

export const AgentToolNameSchema = z.enum([
    "get_device_state",
    "start_cooking",
    "set_temperature",
    "set_timer",
    "shutdown",
])

// Agent 输入属于应用可信身份上下文，必须 strict 校验，避免调用方夹带授权标记或替代身份。
export const AgentInputSchema = z.object({
    requestId: z.string().uuid(),
    tenantId: EntityIdSchema,
    userId: EntityIdSchema,
    deviceId: EntityIdSchema,
    message: z.string().trim().min(1).max(4000),
    locale: z.string().trim().min(2).max(20)
        .default("en-US"),
}).strict()

export const AgentTrustedDeviceStateSchema = z.object({
    event: DeviceReportedStateEventSchema,
    acceptedAt: z.string().datetime({
        offset: true
    }),
}).strict()

export const AgentPlanStepSchema = z.object({
    stepId: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z0-9_-]+$/),
    toolName: AgentToolNameSchema,
    arguments: ToolArgumentsSchema,
}).strict()

export const AgentPlanSchema = z.object({
    rationale: z.string().trim().min(1).max(1000),
    steps: z.array(AgentPlanStepSchema)
        .min(1)
        .max(10)
}).strict()

export const AgentApprovalSchema = z
    .object({
        status: z.enum([
            "not_required",
            "pending",
            "approved",
            "rejected",
            "expired",
        ]),
        approvalId: z.string().uuid().nullable(),
        expiresAt: z.string()
            .datetime({ offset: true })
            .nullable(),

    })
    .strict()
    .superRefine((approval, context) => {
        if (approval.status === "not_required" &&
            approval.approvalId !== null &&
            approval.expiresAt !== null
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "not_required approval cannot have an approvalId or expiresAt",
            });
        }


        if (approval.status !== "not_required" &&
            approval.approvalId === null
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: " approvalId is required once approval enters the workflow"
            });
        }

    });

export const AgentErrorSchema = z.object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(1000),
    source: z.enum([
        "input",
        "state",
        "planner",
        "validator",
        "tool",
        "system",
    ]),
    retryable: z.boolean(),
}).strict();

export const AgentOutputSchema = z
    .object({
        status: z.enum([
            "ready",
            "needs_clarification",
            "approval_required",
            "completed",
            "rejected",
            "failed",
        ]),
        message: z.string().trim().min(1).max(4000),
        data: z.object({})
            .catchall(z.unknown())
            .nullable(),
    }).strict()

export const AgentStateSchema = z.object(
    {
        version: z.literal("1.0"),
        input: AgentInputSchema,
        deviceState: AgentTrustedDeviceStateSchema.nullable(),
        plan: AgentPlanSchema.nullable(),
        approval: AgentApprovalSchema,
        errors: z.array(AgentErrorSchema).max(20),
        output: AgentOutputSchema.nullable()
    }
).strict();


export type AgentToolName = z.infer<typeof AgentToolNameSchema>;

export type AgentInput = z.infer<typeof AgentInputSchema>;

export type AgentTrustDeviceState = z.infer<typeof AgentTrustedDeviceStateSchema>;

export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export type AgentApproval = z.infer<typeof AgentApprovalSchema>;

export type AgentError = z.infer<typeof AgentErrorSchema>;

export type AgentState = z.infer<typeof AgentStateSchema>;

export type AgentOutput = z.infer<typeof AgentOutputSchema>;


