import { z } from "zod"; // 导入 Zod，用于声明并校验设备指令的数据结构。
export const ModelCommandSchema = z.object({ // 定义模型指令的结构。
    intent: z.enum([
        "start_cooking",
        "set_temperature",
        "set_timer",
        "shutdown",
        "unknown"]), // 指令意图必须是解析或摘要。
    temperatureFahrenheit: z.number().int().nullable(),
    durationMinutes: z.number().int().nullable(),
    probeTargetFahrenheit: z.number().int().nullable(),
})

export type ModelCommand = z.infer<typeof ModelCommandSchema>; // 从模型指令结构推导对应的 TypeScript 类型。