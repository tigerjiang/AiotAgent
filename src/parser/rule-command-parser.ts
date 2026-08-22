import { randomUUID } from "crypto";
import {
    DeviceCommandSchema,
    DeviceCommand,
    DeviceType,
} from "../domain/device-command"; // 导入设备指令联合类型和验证模式，用于解析和校验输入的设备指令。

export interface RuleParseContext { // 定义解析设备指令时的上下文接口，包含必要的环境信息。
    deviceId: string;
    deviceType: DeviceType;
    now: Date;
}

export type ParseResult = // 使用类型别名定义解析成功与失败结果的判别联合。
    | { // 定义解析结果的接口，包含成功标志、错误信息和解析后的指令。
        success: true; // 标记解析成功。
        command: DeviceCommand; // 可选的解析后的设备指令对象，若解析成功则包含有效数据。
    }
    | {
        success: false; // 标记解析失败。
        error: {
            code: "UNSUPPORTED_INTENT" | "INVALID_PARAMETERS" | "MISSING_PARAMETER" | "INVALID_COMMAND"; // 指定错误类型，可能是未支持的意图、参数无效或缺少必填字段。
            message: string; // 提供解析失败的错误信息。
        };
    };

function extractTemperature(input: string): number | undefined { // 定义从文本中提取温度的辅助函数。
    const regex = /(\d{2,3})\s*°?\s*(?:f|fahrenheit|华氏度)/i; // 使用正则表达式匹配温度格式，支持可选的空格和度符号。
    const match = input.match(regex); // 在输入文本中查找匹配的温度模式。
    if (match) { // 如果找到匹配项，则尝试解析温度值。
        const temperature = parseInt(match[1], 10); // 将匹配的字符串转换为整数。
        if (!isNaN(temperature)) { // 检查解析结果是否为有效数字。
            return temperature; // 返回有效的温度值。
        }
    }
    return undefined; // 如果未找到匹配或解析失败，则返回 undefined
}

function extractDurationMinutes(input: string): number | undefined { // 定义从文本中提取时长的辅助函数。
    const hourMatch = input.match(
        /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|小时)/i
    );
    if (hourMatch) {
        const hours = parseFloat(hourMatch[1]);
        if (!isNaN(hours)) {
            return Math.round(hours * 60); // 将小时转换为分钟并返回。
        }
    }
    const minuteMatch = input.match(
        /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|分钟)/i
    );
    return minuteMatch ? Number(minuteMatch[1]) : undefined;
}

export function parseRuleCommand(
    rawinput: string,
    context: RuleParseContext
): ParseResult {
    const input = rawinput.trim().toLowerCase(); // 将输入文本转换为小写，以便进行不区分大小写的匹配。
    const basecommand = {
        requestId: randomUUID(), // 生成唯一的请求标识符。
        deviceId: context.deviceId, // 使用上下文中的设备标识。
        deviceType: context.deviceType, // 使用上下文中的设备类型。
        issueAt: (context.now ?? new Date()).toISOString(), // 使用当前时间作为指令签发时间。
        requiresConfirmation: true, // 默认需要用户确认。
    };
    let candidate: unknown;
    if (/(关闭|关机|shutdown|turn\s+off)/i.test(input)) {
        candidate = {
            ...basecommand,
            intent: "shutdown",
            parameters: {},
        };
    } else if (/(计时|定时|timer)/i.test(input)) {
        const duration = extractDurationMinutes(input);
        if (duration === undefined) {
            return {
                success: false,
                error: {
                    code: "INVALID_PARAMETERS",
                    message: "Timer duration is required.",
                },
            };
        }
        candidate = {
            ...basecommand,
            intent: "set_timer",
            parameters: { durationMinutes: duration },
        };
    } else if (/(启动|开始|start|begin)/i.test(input)) {
        const temperature = extractTemperature(input);
        const durationMinutes = extractDurationMinutes(input);
        if (temperature === undefined) {
            return {
                success: false,
                error: {
                    code: "MISSING_PARAMETER",
                    message: "Cooking temperature is required.",
                },
            };
        }
        candidate = {
            ...basecommand,
            intent: "start_cooking",
            parameters: {
                temperatureFahrenheit: temperature,
                ...(durationMinutes == undefined ? {} : { durationMinutes })
            },
        };
    } else {
        const temperatureFahrenheit = extractTemperature(input);
        if (temperatureFahrenheit != undefined && /(设置|调到|温度|set|temperature)/i.test(input)) {
            candidate = {
                ...basecommand,
                intent: "set_temperature",
                parameters: { temperatureFahrenheit },
            };
        } else {
            return {
                success: false,
                error: {
                    code: "UNSUPPORTED_INTENT",
                    message: "The command cannot be parsed by deterministic rules.",
                },
            };
        }
    }
    const validation = DeviceCommandSchema.safeParse(candidate); // 使用 Zod 验证候选指令的结构和参数。
    if (!validation.success) {
        return {
            success: false,
            error: {
                code: "INVALID_COMMAND",
                message: validation.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
            },
        };
    }
    return {
        success: true,
        command: validation.data,
    };
}