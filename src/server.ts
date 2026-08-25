const port = Number(process.env.PORT ?? 3000); // 优先读取环境变量中的端口，未配置时使用 3000。
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
  model: process.env.OPENAI_MODEL ?? "gpt-5.6",
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
  port: port,
});