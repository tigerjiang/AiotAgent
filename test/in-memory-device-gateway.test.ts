import { beforeEach, describe, it, expect, vi, Experimental } from "vitest";
import { DeviceCommandSchema } from "../src/domain/device-command";
import { InMemoryDeviceGateway } from "../src/device/in-memory-device-gateway";
import type {
    DeviceState
} from "../src/device/device-state.js";

const initialState: DeviceState = {
    deviceId: "grill-demo-001",
    deviceType: "pellet_grill",
    connection: "online",
    phase: "idle",
    currentTemperatureFahrenheit: 75,
    targetTemperatureFahrenheit: null,
    timerRemainingMinutes: null,
    updatedAt: "2026-08-15T00:00:00.000Z"
};

function createCommand(intent: string, parameters: unknown) {
    return DeviceCommandSchema.parse({
        requestId: crypto.randomUUID(),
        deviceId: "grill-demo-001",
        deviceType: "pellet_grill",
        intent,
        parameters,
        issuedAt: "2026-08-15T00:00:00.000Z",
        requiresConfirmation: true
    });
}

describe("InMemoryDeviceGateway", () => {
    let gateway: InMemoryDeviceGateway;
    beforeEach(() => {
        gateway = new InMemoryDeviceGateway([initialState]);
    });

    it("requires confirmation before execution", async () => {
        const command = createCommand(
            "start_cooking",
            {
                temperatureFahrenheit: 225
            },
           
        );

        const result = await gateway.execute(command, { confirmed: false });

        expect(result).toEqual({
            success: false,
            error: {
                code: "CONFIRMATION_REQUIRED",
                message:
                    "The command requires user confirmation."
            }
        });
    });

    it("moves from idle to preheating", async () => {
        const command = createCommand("start_cooking", {
            temperatureFahrenheit: 225,
            durationMinutes: 120
        });

        const result = await gateway.execute(command, {
            confirmed: true,
            now: new Date(
                "2026-08-15T01:00:00.000Z")
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.state.phase).toEqual("preheating");
            expect(result.state.targetTemperatureFahrenheit).toBe(225);
            expect(result.state.timerRemainingMinutes).toBe(120);

        }
    });
    it("rejects temperature changes while idle", async () => {
        const command = createCommand("set_temperature",
            {
                temperatureFahrenheit: 300
            }
        );
        const result = await gateway.execute(command, {
            confirmed: true,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.code).toBe("INVALID_STATE");
        }

    });


    it("allows temperature changes after ignition", async () => {
        await gateway.execute(
            createCommand(
                "start_cooking", {
                temperatureFahrenheit: 225
            }
            ),
            {
                confirmed: true
            }
        );
        const result = await gateway.execute(
            createCommand(
                "set_temperature",
                {
                    temperatureFahrenheit: 300
                }
            ),
            {
                confirmed: true
            }
        );

        expect(result.success).toBe(true);
        if (result.success) {
            expect(
                result.state
                    .targetTemperatureFahrenheit
            ).toBe(300);
        }
    });

    it("clears targets during shutdown", async () => {
        await gateway.execute(
            createCommand(
                "start_cooking",
                {
                    temperatureFahrenheit: 225,
                    durationMinutes: 120,
                }
            ),
            {
                confirmed: true
            }
        );
        const result = await gateway.execute(
            createCommand(
                "shutdown",
                {}
            ),
            {
                confirmed: true
            }
        );

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.state.phase).toBe("shutting_down");
            expect(result.state.targetTemperatureFahrenheit).toBeNull();
            expect(result.state.timerRemainingMinutes).toBeNull();
        }

    });

    it("rejects commands when the device is offline", async () => {
        const offlineGateway =
            new InMemoryDeviceGateway([
                {
                    ...initialState,
                    connection: 'offline'
                }
            ]
            );
        const result = await offlineGateway.execute(
            createCommand(
                "start_cooking",
                {
                    temperatureFahrenheit: 225
                }
            ),
            {
                confirmed: true
            }
        );
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.code).toBe("DEVICE_OFFLINE");
        }
    });
})