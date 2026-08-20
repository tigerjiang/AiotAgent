import type { DeviceType } from "../domain/device-command"; // 导入设备类型和设备指令的类型定义。
import type { ModelCommand } from "./model-command"; // 导入模型指令的类型定义

export interface CommandModelContext {
    deviceType: DeviceType; // 设备类型，用于区分不同设备的指令解析规则。
}

export interface CommandModelProvider { // 定义命令模型提供者接口，包含获取模型指令的异步方法。
    parse(
        input: string, // 输入的原始文本指令。
        context: CommandModelContext // 提供解析所需的上下文信息。
    ): Promise<ModelCommand>; // 返回一个 Promise，解析成功时返回模型指令对象。
}