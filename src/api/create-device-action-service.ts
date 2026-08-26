import {
    proposeStartCooking,
    resolveStartCooking,
} from "../agent/start-cooking-approval-agent.js";

import type { DeviceToolContext } from "../tools/device-tool.js";
import type {
    DeviceActionApiService,
    VerifiedDeviceContext,
} from "./device-action-routes.js";

type AgentDependencies =
    Parameters<typeof proposeStartCooking>[1];

// 模型、注册表、审批仓库和设备网关是应用级共享依赖；用户与设备身份则必须
// 在每次请求完成认证后单独构造，不能保存在全局 service 中。
type SharedAgentDependencies = Pick<
    AgentDependencies,
    | "createResponse"
    | "model"
    | "registry"
    | "approvals"
    | "now"
> & {
    gateway: DeviceToolContext["gateway"];
};

/**
 * 将 HTTP API 的 propose/decide 契约适配到第 11 天的审批 Agent。
 *
 * 该适配层是信任边界：它只接受认证模块产生的 VerifiedDeviceContext，并
 * 明确把 confirmed 设为 false。真正的确认权限只能由 Agent 成功 claim
 * 服务端审批记录后临时授予。
 */
export function createDeviceActionService(
    shared: SharedAgentDependencies,
): DeviceActionApiService {
    function makeDependencies(
        context: VerifiedDeviceContext,
    ): AgentDependencies {
        // 同一次依赖构造只读取一次时钟，避免边界测试或自定义时钟前后不一致。
        const now = shared.now?.();

        return {
            createResponse: shared.createResponse,
            model: shared.model,
            registry: shared.registry,
            approvals: shared.approvals,
            now: shared.now,

            // actorId、deviceId 和 deviceType 全部来自认证后的服务端上下文。
            actorId: context.actorId,
            toolContext: {
                gateway: shared.gateway,
                deviceId: context.deviceId,
                deviceType: context.deviceType,

                // HTTP 层永远不能把请求视为已经确认。
                // resolveStartCooking 成功 claim 审批后才会在内部改为 true。
                confirmed: false,
                ...(now === undefined ? {} : { now }),
            },
        };
    }

    return {
        // 提议阶段只提取并保存待审批参数，不执行设备命令。
        propose(message, context) {
            return proposeStartCooking(
                message,
                makeDependencies(context),
            );
        },

        // 决策阶段只传 approvalId 和 decision；执行参数仍取自服务端审批仓库。
        decide(approvalId, decision, context) {
            return resolveStartCooking(
                approvalId,
                decision,
                makeDependencies(context),
            );
        },
    };
}
