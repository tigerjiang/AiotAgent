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


export function createDeviceActionService(
    shared: SharedAgentDependencies,
): DeviceActionApiService {
    function makeDependencies(
        context: VerifiedDeviceContext,
    ): AgentDependencies {
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
        propose(message, context) {
            return proposeStartCooking(
                message,
                makeDependencies(context),
            );
        },

        decide(approvalId, decision, context) {
            return resolveStartCooking(
                approvalId,
                decision,
                makeDependencies(context),
            );
        },
    };
}
