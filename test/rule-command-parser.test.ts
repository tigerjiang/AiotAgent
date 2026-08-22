import { describe, expect, it } from "vitest"; // 导入测试套件函数。
import { parseRuleCommand } from "../src/parser/rule-command-parser"; // 导入待测试的规则指令解析函数。

const context = {
    deviceId: "grill-demo-001",
    deviceType: "pellet_grill" as const,
    now: new Date("2026-08-10T00:00:00.000Z")
};

describe("parseRuleCommand", () => { // 定义规则指令解析函数的测试套件。
    it("parses an English start-cooking command", () => {
        const result = parseRuleCommand(
            "Start the grill at 225°F for 2 hours",
            context);
        expect(result.success).toBe(true); // 断言解析结果应为成功。
        if (result.success) {
            expect(result.command.intent).toBe("start_cooking");
            if (result.command.intent == "start_cooking") {
                expect(result.command.parameters.temperatureFahrenheit).toBe(225);
                expect(result.command.parameters.durationMinutes).toBe(120);
            }
        }
    });

    it("parses a Chinese start-cooking command", () => {
        const result = parseRuleCommand(
            "把烤炉温度设置到300°F",
            context);
        expect(result.success).toBe(true); // 断言解析结果应为成功。
        if (result.success) {
            expect(result.command.intent).toBe("set_temperature");
            if (result.command.intent == "set_temperature") {
                expect(result.command.parameters.temperatureFahrenheit).toBe(300);
            }
        }
    });

    it("parse a timer command", () => {
        const result = parseRuleCommand(
            "设置一个30分钟计时器",
            context);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.command.intent).toBe("set_timer");
            if (result.command.intent == "set_timer") {
                expect(result.command.parameters.durationMinutes).toBe(30);
            }
        }
    });

    it("parses a shutdown command", () => {
        const result = parseRuleCommand(
            "关机",
            context);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.command.intent).toBe("shutdown");
        }
    });

    it("rejects start cooking without temperature", () => {
        const result = parseRuleCommand(
            "启动烤炉",
            context);
        expect(result).toEqual({
            success: false,
            error: {
                code: "MISSING_PARAMETER",
                message: "Cooking temperature is required.",
            },
        });
    });

    it("rejects a structurally valid but unsafe temperature", () => {
        const result = parseRuleCommand(
            "Set temperature to 600°F",
            context);
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.code).toBe("INVALID_COMMAND");
        }
    });
});