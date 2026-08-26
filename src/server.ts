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

// 入口只负责装配长期共享依赖并启动 HTTP 服务；业务规则留在 Agent、工具和
// 审批仓库中，便于独立测试。
const port = Number(process.env.PORT ?? 3000);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 本地内存网关提供一台演示设备。生产环境应替换成真实 IoT 网关适配器。
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

// 这些实例必须在请求之间共享：创建审批和确认审批需要访问同一个 Store，
// 工具注册表和网关也代表同一组服务端能力与设备状态。
const service = createDeviceActionService({
  createResponse: params => openai.responses.create(params),
  model: process.env.OPENAI_MODEL ?? "gpt-5.6",
  registry: new DeviceToolRegistry(createDeviceTools()),
  approvals: new InMemoryApprovalStore(),
  gateway,
});

const app = await buildApp({
  service,

  // Day 12 使用固定 Bearer Token 演示认证边界。生产环境必须验证签名、过期
  // 时间和授权关系，再从可信声明中解析 actorId 与当前设备。
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
  port,
});
