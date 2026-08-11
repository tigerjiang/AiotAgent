import { z } from "zod"; // 导入 Zod，用于声明并校验设备指令的数据结构。
export const DeviceTypeSchema = z.enum([ // 定义系统当前支持的设备类型枚举。
    "pellet_grill", // 表示颗粒燃料烤炉。
    "gas_grill", // 表示燃气烤炉。
    "charcoal_grill", // 表示木炭烤炉。
    "pizza_oven", // 表示披萨烤炉。
    "griddle", // 表示平板煎烤炉。
    "air_fryer", // 表示空气炸锅。
    "convection_oven", // 表示热风循环烤箱。
]); // 结束设备类型枚举定义。

const BaseCommandSchema = z.object({ // 定义所有设备指令共享的基础字段。
    requestId: z.string().uuid(), // 要求请求标识是有效的 UUID 字符串。
    deviceId: z.string().min(1), // 要求设备标识至少包含一个字符。
    deviceType: DeviceTypeSchema, // 要求设备类型属于受支持的枚举值。
    issueAt: z.string().datetime(), // 要求指令签发时间是有效的日期时间字符串。
    requiresConfirmation: z.boolean(), // 标记执行指令前是否需要用户确认。
}); // 结束基础指令结构定义。

const startCookingCommandSchema = BaseCommandSchema.extend({ // 在基础字段上定义开始烹饪指令。
    intent: z.literal("start_cooking"), // 使用固定意图值区分开始烹饪指令。
    parameters: z.object({ // 定义开始烹饪指令所需的参数对象。
        temperatureFahrenheit: z.number().int().min(165).max(500), // 将烹饪温度限制为 165 至 500 华氏度的整数。
        durationMinutes: z.number().int().min(1).max(1440).optional(), // 可选烹饪时长限制为 1 至 1440 分钟的整数。
        probeTargetFahrenheit: z.number().int().min(32).max(212).optional(), // 可选探针目标温度限制为 32 至 212 华氏度的整数。
    }), // 结束开始烹饪参数定义。
}); // 结束开始烹饪指令结构定义。

const SetTemperatureCommandSchema = BaseCommandSchema.extend({ // 在基础字段上定义设置温度指令。
    intent: z.literal("set_temperature"), // 使用固定意图值区分设置温度指令。
    parameters: z.object({ // 定义设置温度指令所需的参数对象。
        temperatureFahrenheit: z.number().int().min(165).max(500), // 将目标温度限制为 165 至 500 华氏度的整数。
    }), // 结束设置温度参数定义。
}); // 结束设置温度指令结构定义。

const setTimeCommandSchema = BaseCommandSchema.extend({ // 在基础字段上定义设置计时器指令。
    intent: z.literal("set_timer"), // 使用固定意图值区分设置计时器指令。
    parameters: z.object({ // 定义设置计时器指令所需的参数对象。
        durationMinutes: z.number().int().min(1).max(1440), // 将计时时长限制为 1 至 1440 分钟的整数。
    }), // 结束计时器参数定义。
}); // 结束设置计时器指令结构定义。

const shutdownCommandSchema = BaseCommandSchema.extend({ // 在基础字段上定义关机指令。
    intent: z.literal("shutdown"), // 使用固定意图值区分关机指令。
    parameters: z.object({}), // 关机指令不接收额外参数。
}); // 结束关机指令结构定义。

export const DeviceCommandSchema = z.discriminatedUnion("intent", [ // 根据 intent 字段组合所有受支持的设备指令。
    startCookingCommandSchema, // 将开始烹饪指令加入联合类型。
    SetTemperatureCommandSchema, // 将设置温度指令加入联合类型。
    setTimeCommandSchema, // 将设置计时器指令加入联合类型。
    shutdownCommandSchema, // 将关机指令加入联合类型。
]); // 结束设备指令判别联合定义。

export type DeviceType = z.infer<typeof DeviceTypeSchema>; // 从设备类型结构推导对应的 TypeScript 类型。
export type DeviceCommand = z.infer<typeof DeviceCommandSchema>; // 从设备指令结构推导对应的 TypeScript 联合类型。
