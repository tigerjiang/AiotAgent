import {
    beforeEach,
    describe,
    it,
    expect
} from "vitest";
import {
    InMemoryDeviceGateway
} from "../src/device/in-memory-device-gateway";
import {
    createDeviceTools
} from "../src/tools/create-device-tools";
import {
    DeviceToolRegistry
} from "../src/tools/device-tool-registry";
import type {
    DeviceToolContext
} from "../src/tools/device-tool";

describe("DeviceToolRegistry", () => {
    let registry: DeviceToolRegistry;
    let context: DeviceToolContext;

    beforeEach(() => {
        const gateway = new InMemoryDeviceGateway(
            [{
                deviceId: "grill-demo-001",
                deviceType: "pellet_grill",
                connection: "online",
                phase: "idle",
                currentTemperatureFahrenheit: 75,
                targetTemperatureFahrenheit: null,
                timerRemainingMinutes: null,
                updatedAt:
                    "2026-08-16T00:00:00.000Z"
            }]
        );

        registry = new DeviceToolRegistry(
            createDeviceTools()
        );

        context = {
            gateway,
            deviceId: "grill-demo-001",
            deviceType: "pellet_grill",
            confirmed: false,
            now: new Date(
                "2026-08-16T01:00:00.000Z"
            )
        };
    });

    it("list five device tools", () => {
        expect(
            registry.list().map((tool) => tool.name)
        ).toEqual(
            [
                "get_device_state",
                "start_cooking",
                "set_temperature",
                "set_timer",
                "shutdown"
            ]
        );
    });

    it("allows read-only state queries without confirmation", async () => {
        const result = await registry.execute("get_device_state", {}, context);
        expect(result.success).toBe(true);
    });

    it("requires external confirmation for start", async () => {
        const result = await registry.execute("start_cooking",
            {
                temperatureFahrenheit: 225,
                durationMinutes: 120,
                probeTargetFahrenheit: null
            },
            context

        );

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.code).toBe(
                "CONFIRMATION_REQUIRED"
            );
        }
    });

    it("starts cooking after confirmation", async () => {
        const result = await registry.execute(
            "start_cooking",
            {
                temperatureFahrenheit: 225,
                durationMinutes: 120,
                probeTargetFahrenheit: null
            },
            {
                ...context,
                confirmed: true
            }
        );
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.output).toMatchObject(
                {
                    phase: "preheating",
                    targetTemperatureFahrenheit: 225,
                    timerRemainingMinutes: 120
                }
            );
        }
    });
    it("ejects unsafe tool arguments", async () => {
        const result = await registry.execute(
            "start_cooking",
            {
                temperatureFahrenheit: 700,
                durationMinutes: null,
                probeTargetFahrenheit: null
            },
            {
                ...context,
                confirmed: true,
            }
        );
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.code).toBe(
                "INVALID_TOOL_ARGUMENTS"
            );
        }
    });

    it("does not allow the caller to replace deviceId", async () => {
        const result = await registry.execute(
            "start_cooking",
            {
                deviceId: "someone-elses-grill",
                temperatureFahrenheit: 225,
                durationMinutes: null,
                probeTargetFahrenheit: null
            },
            {
                ...context,
                confirmed: true
            }
        );
        expect(result.success).toBe(false);
        if ((!result.success)) {
            expect(result.error.code).toBe(
                "INVALID_TOOL_ARGUMENTS");
        }
    });

    it("rejects unknown tools", async () => {
        const result = await registry.execute(
            "delete_device",
            {},
            context
        );
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.code).toBe("UNKNOWN_TOOL");
        }
    });
})