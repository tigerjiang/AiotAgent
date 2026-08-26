import type {
    FastifyInstance,
    FastifyRequest,
} from "fastify";
import { z } from "zod";
import type { DeviceType } from "../domain/device-command.js";

// strict() 会拒绝 deviceId、actorId 等额外字段，防止客户端通过 Body 选择
// 其他用户的设备。自然语言长度也在进入模型前受到限制。
const CreateActionBodySchema = z.object({
    message: z.string().trim().min(1).max(1000),
}).strict();
const DecisionParamsSchema = z.object({
    approvalId: z.string().uuid(),
}).strict();
const DecisionBodySchema = z.object({
    decision: z.enum(["approve", "reject"])
}).strict();

/** 认证成功后由服务端产生的可信调用上下文。 */
export interface VerifiedDeviceContext {
    actorId: string;
    deviceId: string;
    deviceType: DeviceType;
}

/** Agent 结果的最小 HTTP 表示；code 用于映射非 200 状态码。 */
export interface DeviceActionApiResult {
    status: string;
    code?: string;
    [key: string]: unknown;
}

/** 路由层依赖的业务接口，使 HTTP 协议与具体 Agent 实现解耦。 */
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
    // 不存在或不属于当前用户/设备都统一返回 404，避免泄露审批是否存在。
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

/** 注册“创建审批”和“处理审批决定”两个设备操作接口。 */
export async function registerDeviceActionRoutes(
    app: FastifyInstance,
    deps: RouteDependencies
): Promise<void> {
    app.post(
        "/v1/device-actions",
        async (request, reply) => {
            // 在认证和调用模型前先拒绝结构非法的请求，减少无效业务调用。
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
                // 身份和当前设备来自认证层，而不是 parsed.data。
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
            // 确认接口只允许 UUID approvalId 与 approve/reject，不接受温度、
            // 时长、confirmed 等会改变原审批语义的字段。
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
                // 决策请求必须重新认证，不能认为持有 approvalId 就拥有执行权。
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
        },
    );
}
