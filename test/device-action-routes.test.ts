import type OpenAI from "openai";
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { buildApp } from "../src/api/build-app.js";
import { createDeviceActionService } from
    "../src/api/create-device-action-service.js";
import type {
    DeviceActionApiService,
    VerifiedDeviceContext,
} from "../src/api/device-action-routes.js";
import { InMemoryApprovalStore } from
    "../src/approval/in-memory-approval-store.js";
import { InMemoryDeviceGateway } from
    "../src/device/in-memory-device-gateway.js";
import { createDeviceTools } from
    "../src/tools/create-device-tools.js";
import { DeviceToolRegistry } from
    "../src/tools/device-tool-registry.js";

const verifiedContext: VerifiedDeviceContext = {
    actorId: "user-a",
    deviceId: "grill-demo-001",
    deviceType: "pellet_grill",
}

// 用两个 Token 模拟两个已认证用户；两者指向同一设备，用来验证 actorId 也
// 是审批所有权的一部分，而不只是检查 deviceId。
function contextForToken(
    authorization: string | undefined,
): VerifiedDeviceContext {
    if (authorization === "Bearer local-user-a") {
        return verifiedContext;
    }

    if (authorization === "Bearer local-user-b") {
        return {
            actorId: "user-b",
            deviceId: "grill-demo-001",
            deviceType: "pellet_grill",
        };
    }

    throw new Error("UNAUTHORIZED");
}

/**
 * 前四个用例隔离验证 HTTP 边界，最后一个用例串联真实 Agent、审批 Store、
 * 工具注册表和内存网关，覆盖跨用户盗用 approvalId 的场景。
 */
describe("device action routes", () => {
    let service: {
        propose: ReturnType<typeof vi.fn>;
        decide: ReturnType<typeof vi.fn>;
    };
    beforeEach(() => {
        // 路由单元测试使用业务服务替身，只关注校验、认证和参数转交。
        service = {
            propose: vi.fn().mockResolvedValue({
                status: "approval_required",
                approvalId:
                    "f2f7ac17-7a25-4be7-9300-79ec72bd37da",
            }),
            decide: vi.fn().mockResolvedValue({
                status: "executed",
            }),
        };
    });

    async function makeRouteApp() {
        return buildApp({
            service: service as DeviceActionApiService,
            authenticate: async authorization =>
                contextForToken(authorization),
        });
    }

    it("does not allow the body to select a device", async () => {
    const app = await makeRouteApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/device-actions",
      headers: {
        authorization: "Bearer local-user-a",
      },
      payload: {
        message: "225°F 烹饪 2 小时",
        deviceId: "someone-elses-grill",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(service.propose).not.toHaveBeenCalled();

    await app.close();
  });

  it("passes verified context to the service", async () => {
    const app = await makeRouteApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/device-actions",
      headers: {
        authorization: "Bearer local-user-a",
      },
      payload: {
        message: "225°F 烹饪 2 小时",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(service.propose).toHaveBeenCalledWith(
      "225°F 烹饪 2 小时",
      verifiedContext,
    );

    await app.close();
  });

  it("requires authentication", async () => {
    const app = await makeRouteApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/device-actions",
      payload: {
        message: "225°F 烹饪 2 小时",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      },
    });
    expect(service.propose).not.toHaveBeenCalled();

    await app.close();
  });

  it("confirmation accepts only the approval decision", async () => {
    const app = await makeRouteApp();

    const response = await app.inject({
      method: "POST",
      url:
        "/v1/device-actions/" +
        "f2f7ac17-7a25-4be7-9300-79ec72bd37da/" +
        "decision",
      headers: {
        authorization: "Bearer local-user-a",
      },
      payload: {
        decision: "approve",
        temperatureFahrenheit: 500,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(service.decide).not.toHaveBeenCalled();

    await app.close();
  });

  it("does not let another user consume an approval", async () => {
    // 该用例改用真实 service；模型只模拟提议阶段的函数调用输出。
    const proposalResponse = {
      id: "response-proposal",
      output_text: "",
      output: [
        {
          id: "function-start-cooking",
          type: "function_call",
          call_id: "call-start-cooking",
          name: "start_cooking",
          arguments: JSON.stringify({
            temperatureFahrenheit: 225,
            durationMinutes: 120,
            probeTargetFahrenheit: null,
          }),
        },
      ],
    } as OpenAI.Responses.Response;

    const createResponse = vi
      .fn<
        (
          input:
            OpenAI.Responses.ResponseCreateParamsNonStreaming,
        ) => Promise<OpenAI.Responses.Response>
      >()
      .mockResolvedValueOnce(proposalResponse);

    const gateway = new InMemoryDeviceGateway([
      {
        deviceId: "grill-demo-001",
        deviceType: "pellet_grill",
        connection: "online",
        phase: "idle",
        currentTemperatureFahrenheit: 72,
        targetTemperatureFahrenheit: null,
        timerRemainingMinutes: null,
        updatedAt: "2026-08-19T00:00:00.000Z",
      },
    ]);

    const integratedService = createDeviceActionService({
      createResponse,
      model: "test-model",
      registry: new DeviceToolRegistry(createDeviceTools()),
      approvals: new InMemoryApprovalStore(),
      gateway,
      now: () => new Date("2026-08-19T00:00:00.000Z"),
    });

    const app = await buildApp({
      service: integratedService,
      authenticate: async authorization =>
        contextForToken(authorization),
    });

    // user-a 创建审批。
    const proposal = await app.inject({
      method: "POST",
      url: "/v1/device-actions",
      headers: {
        authorization: "Bearer local-user-a",
      },
      payload: {
        message: "把烤炉设置为 225°F，烹饪 120 分钟",
      },
    });

    expect(proposal.statusCode).toBe(200);
    const { approvalId } = proposal.json<{
      approvalId: string;
    }>();

    const before = await gateway.getState("grill-demo-001");

    // user-b 即使知道 approvalId，也不能确认 user-a 的审批。
    const decision = await app.inject({
      method: "POST",
      url:
        `/v1/device-actions/${approvalId}/decision`,
      headers: {
        authorization: "Bearer local-user-b",
      },
      payload: {
        decision: "approve",
      },
    });

    expect(decision.statusCode).toBe(404);
    expect(decision.json()).toMatchObject({
      status: "error",
      code: "APPROVAL_NOT_FOUND",
    });
    expect(await gateway.getState("grill-demo-001"))
      .toEqual(before);

    // 只有提议阶段调用过模型，未执行工具，也未生成最终答复。
    expect(createResponse).toHaveBeenCalledTimes(1);

    await app.close();
  });
})
