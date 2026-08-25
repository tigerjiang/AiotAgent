import type {
    FastifyInstance,
    FastifyRequest
} from "fastify"
import { error } from "node:console";
import { z } from "zod";
import type { DeviceType } from "../domain/device-command.js";

const CreateActionBodySchema = z.object({
    message: z.string().trim().min(1).max(1000),
}).strict();
const DecisionParamsSchema = z.object({
    approvalId: z.string().uuid(),
}).strict();
const DecisionBodySchema = z.object({
    decision: z.enum(["approve", "reject"])
}).strict();

export interface VerifiedDeviceContext {
    actorId: string;
    deviceId: string;
    deviceType: DeviceType;
}

export interface DeviceActionApiResult {
    status: string;
    code?: string;
    [key: string]: unknown;
}

export interface DeviceActionApiService {
    propose(
        message: string,
        context: VerifiedDeviceContext,
    ): Promise<DeviceActionApiResult>;

    decide(
        approvalId: string,
        decision: "approve" | "reject",
        context: VerifiedDeviceContext,
    ): Promise<DeviceActionApiResult>;
}

interface RouteDependencies {
    authenticate(
        request: FastifyRequest,
    ): Promise<VerifiedDeviceContext>;

    service: DeviceActionApiService;
}

function statusCodeForResult(
    result: DeviceActionApiResult,
): number {
    switch (result.code) {
        case "APPROVAL_NOT_FOUND":
            return 404;

        case "APPROVAL_EXPIRED":
            return 410;

        case "APPROVAL_ALREADY_RESOLVED":
        case "APPROVAL_NOT_PENDING":
            return 409;

        default:
            return 200;
    }
}
export async function registerDeviceActionRoutes(
    app: FastifyInstance,
    deps: RouteDependencies
): Promise<void> {
    app.post(
        "/v1/device-actions",
        async (request, reply) => {
            const parsed =
                CreateActionBodySchema.safeParse(
                    request.body,
                );
            if (!parsed.success) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_REQUEST",
                        message: parsed.error.issues
                            .map(issue => issue.message)
                            .join("; "),
                    },
                });
            }

            let context: VerifiedDeviceContext;

            try {
                context = await deps.authenticate(request);
            } catch {
                return reply.code(401).send({
                    error: {
                        code: "UNAUTHORIZED",
                        message: "Authentication required.",
                    },
                });
            }
            const result = await deps.service.propose(
                parsed.data.message,
                context,
            );
            return reply.code(200).send(result);
        },
    );

    app.post(
        "/v1/device-actions/:approvalId/decision",
        async (request, reply) => {
            const params = DecisionParamsSchema.safeParse(
                request.params,
            );
            const body = DecisionBodySchema.safeParse(
                request.body,
            );
            if (!params.success || !body.success) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_REQUEST",
                        message:
                            "A valid approvalId and decision are required.",
                    },
                });
            }
            let context: VerifiedDeviceContext;
            try {
                context = await deps.authenticate(request);
            } catch {
                return reply.code(401).send({
                    error: {
                        code: "UNAUTHORIZED",
                        message: "Authentication required.",
                    },
                });
            }

            const result = await deps.service.decide(
                params.data.approvalId,
                body.data.decision,
                context,
            );
            return reply
                .code(statusCodeForResult(result))
                .send(result);
        }

    )



}
