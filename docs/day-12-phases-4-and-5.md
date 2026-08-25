# 第 12 天补充：第四阶段和第五阶段完整代码

下面的代码承接前三步，文件扩展名导入统一使用 `.js`，以匹配当前项目的 ESM 配置。

## 第四步：连接昨天的 Agent

不要在路由中直接拼 Agent 依赖。新建一个适配器，把 HTTP 层的已验证上下文转换成 Agent 所需的可信依赖。

新建 `src/api/create-device-action-service.ts`：

```ts
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
```

应用入口中只创建一次共享的审批存储、设备网关和工具注册表。审批创建和确认必须使用同一个 `approvals` 实例，否则确认接口会找不到刚创建的审批。

下面给出一个可本地运行的 `src/server.ts`。OpenAI 客户端的 API Key 从环境变量读取；本地认证只用于演示。

```ts
import "dotenv/config";
import OpenAI from "openai";
import { buildApp } from "./api/build-app.js";
import { createDeviceActionService } from
  "./api/create-device-action-service.js";
import { InMemoryApprovalStore } from
  "./approval/in-memory-approval-store.js";
import { InMemoryDeviceGateway } from
  "./device/in-memory-device-gateway.js";
import { createDeviceTools } from
  "./tools/create-device-tools.js";
import { DeviceToolRegistry } from
  "./tools/device-tool-registry.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const gateway = new InMemoryDeviceGateway([
  {
    deviceId: "grill-demo-001",
    deviceType: "pellet_grill",
    connection: "online",
    phase: "idle",
    currentTemperatureFahrenheit: 72,
    targetTemperatureFahrenheit: null,
    timerRemainingMinutes: null,
    updatedAt: new Date().toISOString(),
  },
]);

const service = createDeviceActionService({
  createResponse: params => openai.responses.create(params),
  model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  registry: new DeviceToolRegistry(createDeviceTools()),
  approvals: new InMemoryApprovalStore(),
  gateway,
});

const app = await buildApp({
  service,

  async authenticate(authorization) {
    if (authorization !== "Bearer local-user-a") {
      throw new Error("UNAUTHORIZED");
    }

    return {
      actorId: "user-a",
      deviceId: "grill-demo-001",
      deviceType: "pellet_grill",
    };
  },
});

await app.listen({
  host: "127.0.0.1",
  port: 3000,
});
```

这里有三个必须保持的边界：

- `actorId`、`deviceId`、`deviceType` 只来自 `authenticate` 的返回值。
- `confirmed` 在适配器中固定为 `false`，不读取请求 Body。
- `approvals` 必须是跨两个 HTTP 请求共享的服务端实例。

## 第五步：使用 Fastify Inject 测试

新建 `test/device-action-routes.test.ts`。前四个用例验证 HTTP 边界，最后一个用例使用真实 Agent、审批存储、工具注册表和设备网关，验证其他用户无法消费审批。

```ts
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
};

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

describe("device action routes", () => {
  let service: {
    propose: ReturnType<typeof vi.fn>;
    decide: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
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
});
```

运行检查：

```bash
npm run typecheck
npm test
```

如果只想运行当天新增测试：

```bash
npx vitest run test/device-action-routes.test.ts
```

测试通过后，第四、第五阶段应达到以下结果：HTTP 请求不能选择用户或设备，确认请求不能修改审批参数，未认证请求被拒绝，同一审批只能由创建它的用户和设备处理。
