import { describe, expect, it } from "vitest"; // 导入测试套件、断言和测试用例函数。
import { DeviceCommandSchema } from "../src/domain/device-command"; // 导入待验证的设备指令结构。

const baseCommand = { // 定义各测试用例复用的合法基础指令字段。
    requestId: "123e4567-e89b-12d3-a456-426614174000", // 提供符合 UUID 格式的固定请求标识。
    deviceId: "device123", // 指定测试使用的目标设备标识。
    deviceType: "pellet_grill", // 指定测试设备为颗粒燃料烤炉。
    issueAt: new Date().toISOString(), // 使用当前时间生成合法的指令签发时间。
    requiresConfirmation: true, // 标记测试指令在执行前需要确认。
}; // 结束基础测试指令定义。

describe("DeviceCommandSchema", () => { // 定义设备指令结构的验证测试套件。
    it("accepts a valid start-cooking command", () => { // 验证合法的开始烹饪指令能够通过校验。
        const command = { // 构造包含全部常用参数的开始烹饪指令。
            ...baseCommand, // 复用合法的基础指令字段。
            intent: "start_cooking", // 指定当前指令意图为开始烹饪。
            parameters: { // 提供开始烹饪所需的参数。
                temperatureFahrenheit: 225, // 设置合法的烹饪温度。
                durationMinutes: 120, // 设置合法的烹饪时长。
                probeTargetFahrenheit: 165, // 设置合法的探针目标温度。
            }, // 结束开始烹饪参数定义。
        }; // 结束合法指令构造。
        const result = DeviceCommandSchema.safeParse(command); // 安全解析指令并保留成功或失败结果。
        expect(result.success).toBe(true); // 断言合法指令通过结构校验。
    }); // 结束合法开始烹饪指令测试。

    it("rejects a grill temperature above the device limit", () => { // 验证超过设备上限的温度会被拒绝。
        const command = { // 构造温度超限的开始烹饪指令。
            ...baseCommand, // 复用合法的基础指令字段。
            intent: "start_cooking", // 指定当前指令意图为开始烹饪。
            parameters: { // 提供包含非法温度的参数。
                temperatureFahrenheit: 550, // 使用超过 500 华氏度上限的温度。
            }, // 结束超限温度参数定义。
        }; // 结束非法温度指令构造。
        const result = DeviceCommandSchema.safeParse(command); // 安全解析温度超限的指令。
        expect(result.success).toBe(false); // 断言温度超限的指令未通过校验。
    }); // 结束温度上限测试。

    it("rejects a timer without duration", () => { // 验证缺少时长的计时器指令会被拒绝。
        const command = { // 构造缺少必要参数的计时器指令。
            ...baseCommand, // 复用合法的基础指令字段。
            intent: "set_timer", // 指定当前指令意图为设置计时器。
            parameters: { // 创建空参数对象以模拟缺少计时时长。
                // 此处故意省略 durationMinutes，用于验证必填字段校验。
            }, // 结束空计时器参数定义。
        }; // 结束缺少时长的指令构造。
        const result = DeviceCommandSchema.safeParse(command); // 安全解析缺少时长的计时器指令。
        expect(result.success).toBe(false); // 断言缺少必填字段的指令未通过校验。
    }); // 结束计时器必填字段测试。

    it("rejects an unsupported intent", () => { // 验证系统不支持的指令意图会被拒绝。
        const command = { // 构造包含未知意图的设备指令。
            ...baseCommand, // 复用合法的基础指令字段。
            intent: "open_lid", // 使用未在判别联合中声明的开盖意图。
            parameters: {}, // 未知意图不提供额外参数。
        }; // 结束未知意图指令构造。
        const result = DeviceCommandSchema.safeParse(command); // 安全解析包含未知意图的指令。
        expect(result.success).toBe(false); // 断言未知意图未通过校验。
    }); // 结束未知意图测试。

    it("provides readable validation issues", () => { // 验证非法指令能够产生可读取的校验问题列表。
        const command = { // 构造同时包含多个非法参数的烹饪指令。
            ...baseCommand, // 复用合法的基础指令字段。
            intent: "start_cooking", // 指定当前指令意图为开始烹饪。
            parameters: { // 提供故意设置为非法值的烹饪参数。
                temperatureFahrenheit: 1000, // 使用远超设备上限的非法温度。
                durationMinutes: -10, // 使用小于最短时长的非法负数。
            }, // 结束非法烹饪参数定义。
        }; // 结束包含多个错误的指令构造。
        const result = DeviceCommandSchema.safeParse(command); // 安全解析包含多个非法参数的指令。
        expect(result.success).toBe(false); // 断言包含非法参数的指令未通过校验。
        if (!result.success) { // 仅在解析失败时读取并转换校验问题。
            const issues = result.error.issues.map((issue) => ({ // 将 Zod 问题转换为更易读取的路径和消息对象。
                path: issue.path.join("."), // 将字段路径片段拼接成点分隔字符串。
                message: issue.message, // 保留 Zod 提供的校验错误消息。
            })); // 结束校验问题列表转换。
            console.log(issues); // 输出校验问题，方便开发时检查错误内容。
            expect(issues.length).toBeGreaterThan(0); // 断言至少生成了一条校验问题。
        } // 结束解析失败结果处理。
    }); // 结束可读校验问题测试。
}); // 结束设备指令结构测试套件。
