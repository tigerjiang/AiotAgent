import type OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryApprovalStore } from "../src/approval/in-memory-approval-store.js";
import { proposeStartCooking, resolveStartCooking } from "../src/agent/start-cooking-approval-agent.js";
import { InMemoryDeviceGateway } from "../src/device/in-memory-device-gateway.js";
import { createDeviceTools } from "../src/tools/create-device-tools.js";
import { DeviceToolRegistry } from "../src/tools/device-tool-registry.js";

type CreateResponse = (input: OpenAI.Responses.ResponseCreateParamsNonStreaming) =>
    Promise<OpenAI.Responses.Response>;

/**
 * 整个启动烹饪审批流程分为两个阶段：
 *
 * 1. proposeStartCooking（提议阶段）
 *    用户自然语言 -> 模型提取 start_cooking 参数 -> 服务端校验参数
 *    -> 将待执行动作写入审批存储 -> 返回 approvalId，设备保持不变。
 *
 * 2. resolveStartCooking（决策阶段）
 *    - approve：原子占用审批 -> 携带 confirmed: true 执行设备工具
 *      -> 写回审批结果 -> 把真实工具结果交给模型生成最终答复。
 *    - reject：把审批标记为 rejected，不执行设备工具，也不再调用模型。
 *
 * approvalId 只能成功处理一次，并且有五分钟有效期。这样可以避免模型直接
 * 操作设备、重复确认导致重复执行，以及旧审批被长期复用。
 */

// 模拟提议阶段的模型响应：模型只生成函数调用及参数，不代表设备已经启动。
const proposalResponse = {
    id: "response-proposal",
    output_text: "",
    output: [{
        id: "function-start-cooking",
        type: "function_call",
        call_id: "call-start-cooking",
        name: "start_cooking",
        arguments: JSON.stringify({
            temperatureFahrenheit: 375,
            durationMinutes: 30,
            probeTargetFahrenheit: null,
        }),
    }],
} as OpenAI.Responses.Response;

// 模拟执行成功后模型给用户的最终答复；只有 approve 成功后才会用到它。
const finalResponse = {
    id: "response-final",
    output_text: "烤箱已开始预热至 375°F。",
    output: [],
} as unknown as OpenAI.Responses.Response;

describe("approval start_cooking", () => {
    let gateway: InMemoryDeviceGateway;
    let createResponse: ReturnType<typeof vi.fn<CreateResponse>>;
    let deps: Parameters<typeof proposeStartCooking>[1];

    beforeEach(() => {
        // 每个用例都使用一台全新的空闲在线烤箱，避免测试间共享设备状态。
        gateway = new InMemoryDeviceGateway([{
            deviceId: "oven-001",
            deviceType: "convection_oven",
            connection: "online",
            phase: "idle",
            currentTemperatureFahrenheit: 75,
            targetTemperatureFahrenheit: null,
            timerRemainingMinutes: null,
            updatedAt: "2026-08-17T00:00:00.000Z",
        }]);

        // 第一次模型调用返回待审批参数；批准执行后，第二次调用返回最终说明。
        createResponse = vi.fn<CreateResponse>()
            .mockResolvedValueOnce(proposalResponse)
            .mockResolvedValueOnce(finalResponse);

        // deps 表示服务端可信依赖。客户端只提交 approvalId 和决策，不能篡改
        // deviceId、工具参数、confirmed 状态或审批存储中的模型上下文。
        deps = {
            createResponse,
            model: "test-model",
            registry: new DeviceToolRegistry(createDeviceTools()),
            approvals: new InMemoryApprovalStore(),
            toolContext: {
                gateway,
                deviceId: "oven-001",
                deviceType: "convection_oven",
                // 提议阶段默认没有用户确认；真正执行时 agent 内部才会改为 true。
                confirmed: false,
                now: new Date("2026-08-17T00:00:00.000Z"),
            },
            // 固定时钟，使审批创建时间及五分钟过期边界可重复测试。
            now: () => new Date("2026-08-17T00:00:00.000Z"),
        };
    });

    it("提议阶段不操作设备", async () => {
        const before = await gateway.getState("oven-001");

        // 此时只允许模型提取参数并创建审批记录，不能调用 start_cooking 工具。
        const result = await proposeStartCooking("把烤箱设为 375°F，烤 30 分钟", deps);
        const after = await gateway.getState("oven-001");

        // 返回 approval_required 告诉上层需要展示确认界面。
        expect(result.status).toBe("approval_required");
        // 提议前后状态完全一致，证明模型的函数调用尚未产生设备副作用。
        expect(after).toEqual(before);
    });

    it("确认后只执行一次", async () => {
        // 先创建一条 pending 审批。
        const proposal = await proposeStartCooking("375°F 烤 30 分钟", deps);

        // 第一次 approve 会先将审批同步标记为 executing，再执行设备操作。
        const first = await resolveStartCooking(proposal.approvalId, "approve", deps);
        // 同一个 approvalId 再次提交时，不能再次启动设备。
        const second = await resolveStartCooking(proposal.approvalId, "approve", deps);

        expect(first.status).toBe("executed");
        // 已执行审批不再是 pending，因此返回幂等保护错误。
        expect(second).toMatchObject({
            status: "error",
            code: "APPROVAL_ALREADY_RESOLVED",
        });

    });

    it("取消后不改变设备状态", async () => {
        const proposal = await proposeStartCooking("375°F 烤 30 分钟", deps);
        const before = await gateway.getState("oven-001");

        // reject 只改变审批状态，不进入设备工具执行阶段。
        const result = await resolveStartCooking(proposal.approvalId, "reject", deps);

        expect(result).toEqual({ status: "rejected", answer: "已取消启动烹饪。" });
        expect(await gateway.getState("oven-001")).toEqual(before);
        // 只有提议阶段调用了一次模型；取消无需模型生成第二次答复。
        expect(createResponse).toHaveBeenCalledTimes(1);
    });

    it("拒绝重复取消已处理的审批", async () => {
        const proposal = await proposeStartCooking("375°F 烤 30 分钟", deps);
        await resolveStartCooking(proposal.approvalId, "reject", deps);

        // rejected 是终态，第二次 reject 不应覆盖状态或被当作成功。
        expect(await resolveStartCooking(proposal.approvalId, "reject", deps)).toEqual({
            status: "error",
            code: "APPROVAL_NOT_PENDING",
        });
    });

    it("不执行已过期的审批", async () => {
        const proposal = await proposeStartCooking("375°F 烤 30 分钟", deps);
        const before = await gateway.getState("oven-001");

        // 审批有效期为五分钟；恰好到 expiresAt 时也视为过期。
        deps.now = () => new Date("2026-08-17T00:05:00.000Z");

        expect(await resolveStartCooking(proposal.approvalId, "approve", deps)).toEqual({
            status: "error",
            code: "APPROVAL_EXPIRED",
        });
        // 过期检查发生在设备执行前，所以状态和模型调用次数均不发生变化。
        expect(await gateway.getState("oven-001")).toEqual(before);
        expect(createResponse).toHaveBeenCalledTimes(1);
    });

    it("拒绝模型返回的越界参数", async () => {
        // 即使参数来自模型，也必须经过 StartCookingInputSchema 校验，不能信任。
        createResponse.mockReset().mockResolvedValueOnce({
            ...proposalResponse,
            output: [{
                ...proposalResponse.output[0],
                arguments: JSON.stringify({
                    temperatureFahrenheit: 700,
                    durationMinutes: 30,
                    probeTargetFahrenheit: null,
                }),
            }],
        } as OpenAI.Responses.Response);

        // 700°F 超过允许上限 500°F，提议创建失败，更不会写入设备状态。
        await expect(proposeStartCooking("把烤箱设为 700°F", deps)).rejects.toThrow();
        expect(await gateway.getState("oven-001")).toMatchObject({
            phase: "idle",
            targetTemperatureFahrenheit: null,
        });
    });
});
