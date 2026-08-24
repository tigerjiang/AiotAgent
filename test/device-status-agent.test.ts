import type OpenAI from "openai";
import {
  describe,
  it,
  expect,
  vi
} from "vitest";
import {
  InMemoryDeviceGateway
} from "../src/device/in-memory-device-gateway.js";
import {

  runDeviceStatusAgent,
  type CreateResponse
} from "../src/agent/device-status-agent.js";

import {
  createDeviceTools
} from "../src/tools/create-device-tools.js";
import {
  DeviceToolRegistry
} from "../src/tools/device-tool-registry.js"

describe("runDeviceStatusAgent", async () => {
  it("execut get_devie_state and return the final answer", async () => {

    const firstResponse = {
      id: "response-001",
      output_text: "",
      output: [
        {
          id: "function-001",
          type: "function_call",
          call_id: "call-001",
          name: "get_device_state",
          arguments: "{}"
        }
      ]

    } as OpenAI.Responses.Response;

    const secondResponse = {
      id: "response-002",
      output_text:
        "The grill is online and currently cooking at 185°F.",
      output: []
    } as unknown as OpenAI.Responses.Response;

    const createResponse = vi.fn<CreateResponse>().
      mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse);

    const gateway =
      new InMemoryDeviceGateway([
        {
          deviceId: "grill-demo-001",
          deviceType: "pellet_grill",
          connection: "online",
          phase: "cooking",
          currentTemperatureFahrenheit: 185,
          targetTemperatureFahrenheit: 225,
          timerRemainingMinutes: 90,
          updatedAt:
            "2026-08-17T00:00:00.000Z"
        }
      ]);

    const registry = new DeviceToolRegistry(
      createDeviceTools()
    )

    const result = await runDeviceStatusAgent(
      "烤炉现在是什么状态？",
      {
        createResponse,
        model: "test-model",
        registry,
        toolContext: {
          gateway,
          deviceId: "grill-demo-001",
          deviceType: "pellet_grill",

          // 查询工具不会使用确认状态
          confirmed: false,

          now: new Date(
            "2026-08-17T00:00:00.000Z"
          )
        }
      }

    );

    expect(result.calledTools).toEqual(["get_device_state"]);
    expect(result.answer).toContain("online");
    expect(createResponse).toHaveBeenCalledTimes(2);

    const secondRequest = createResponse.mock.calls[1][0];

    expect(secondRequest.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call-001"
        })
      ])
    );
  });
});