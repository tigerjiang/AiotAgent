day1: 建立一个可运行、可测试、可提交到 Git 的 Node.js + TypeScript 服务，为后续“自然语言 → 安全设备指令”打基础。
day2: 使用 TypeScript 和 Zod 定义统一的设备指令契约，并用自动化测试证明非法指令会被拒绝
day3: 将几种受控的中英文指令转换成标准 DeviceCommand，作为后续评估 LLM 的可靠基线。
day4: 使用 Provider 接口隔离大模型供应商，通过依赖注入接入 OpenAI Responses API，并用 Mock 完成无网络、无费用的自动化测试。mkdir -p src/model src/providers src/examples