import { DeviceCommand } from "./device-command"; // 导入设备指令联合类型，为摘要函数提供类型约束。
export function summarizeCommand(command: DeviceCommand): string { // 将结构化设备指令转换为便于阅读的文字摘要。
    switch (command.intent) { // 根据指令意图选择对应的摘要格式。
        case "start_cooking": // 处理开始烹饪指令。
            return `Start ${command.deviceId} at ${command.parameters.temperatureFahrenheit}°F for ${command.parameters.durationMinutes ?? "unspecified"} minutes.`; // 返回包含设备、温度和时长的烹饪摘要。
        case "set_temperature": // 处理设置温度指令。
            return `Set ${command.deviceId} to ${command.parameters.temperatureFahrenheit}°F.`; // 返回包含设备和目标温度的摘要。
        case "set_timer": // 处理设置计时器指令。
            return `Set timer to ${command.parameters.durationMinutes} minutes.`; // 返回包含计时时长的摘要。
        case "shutdown": // 处理设备关机指令。
            return `Shut down ${command.deviceId}`; // 返回包含目标设备的关机摘要。
    } // 结束指令意图分支判断。
} // 结束指令摘要函数定义。
