import "dotenv/config"
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import OpenAI from "openai";
import type { CommandModelProvider } from "../model/command-model-provider";
import { parseLlmCommand } from "../parser/llm-command-parser";
import { DeepSeekCommandModelProvider } from "../providers/deepseek-command-model-provider";
import { OpenAICommandModelProvider } from "../providers/openai-command-model-provider";
import { parseCommand } from "../parser/command-parser";
import { success } from "zod";
import { ro } from "zod/locales";

/**
 * 成功用例的期望结果。
 *
 * 评估只关心解析来源、意图和业务参数，不比较 requestId、deviceId、
 * issueAt 等每次运行都可能变化或与评估目标无关的字段。
 */
interface ExpectedSuccess {
    success: true;
    source: "rule" | "llm";
    intent: string;
    parameters: Record<string, number>;
}

/** 失败用例的期望结果，用错误码判断失败类型是否符合预期。 */
interface ExpectedFailure {
    success: false;
    source: "rule" | "llm";
    errCode: string;
}

/** command-cases.json 中单条评估用例的结构。 */
interface EvaluationCase {
    id: string;
    input: string;
    expected: ExpectedSuccess | ExpectedFailure;
}

/**
 * 读取必需的环境变量，并在配置缺失时尽早终止评估。
 * 这样可以避免把 Provider 配置错误误判为模型解析失败。
 */
function requireEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not configured in .env.`);
    }
    return value;
}

/**
 * 根据 MODEL_PROVIDER 创建评估所使用的模型 Provider。
 *
 * 支持的值为 `openai` 和 `deepseek`，未配置时默认使用 DeepSeek。
 * 各 Provider 的密钥、模型、超时和重试策略均通过环境变量提供。
 */
function createProvider(): CommandModelProvider {
    const providerName = process.env.MODEL_PROVIDER ?? "deepseek";

    switch (providerName) {
        case "openai":
            return new OpenAICommandModelProvider(
                new OpenAI({
                    apiKey: requireEnvironmentVariable("OPENAI_API_KEY"),
                    timeout: Number(
                        process.env.OPENAI_TIMEOUT_MS ?? "15000"
                    ),
                    maxRetries: Number(
                        process.env.OPENAI_MAX_RETRIES ?? "1"
                    )
                }),
                process.env.OPENAI_MODEL ?? "gpt-5.6",
            );
        case "deepseek":
            return new DeepSeekCommandModelProvider({
                apiKey: requireEnvironmentVariable("DEEPSEEK_API_KEY"),
                model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
            });
        default:
            throw new Error(`Unsupported MODEL_PROVIDER: ${providerName}`);
    }
}

const provider = createProvider();

// 使用 import.meta.url 定位数据文件，确保从任意工作目录启动脚本都能读取用例。
const caseUrl = new URL(
    "../evaluation/command-cases.json",
    import.meta.url
);

const cases = JSON.parse(
    await readFile(caseUrl, "utf8")
) as EvaluationCase[];

/** 每条用例的执行明细，用于生成汇总指标并输出失败详情。 */
const rows: Array<{
    id: string;
    passed: boolean;
    source: string;
    elapsedMs: number;
    expected: string;
    actual: string;
}> = [];

for (const testCase of cases) {
    const startedAt = performance.now();
    const result = await parseCommand(
        testCase.input,
        {
            // 固定设备和时间，保证依赖上下文的解析结果可重复比较。
            deviceId: "grill-evaluation-001",
            deviceType: "pellet_grill",
            now: new Date("2026-08-14T00:00:00.000Z")
        },
        provider

    );

    const elapsedMs = Math.round(performance.now() - startedAt);

    // 将完整解析结果投影为用例文件声明的最小可比较结构。
    const actual = result.success ?
        {
            success: true as const,
            source: result.source,
            intent: result.command.intent,
            parameters: result.command.parameters
        } : {
            success: false as const,
            source: result.source,
            errorCode: result.error.code

        };
    rows.push({
        id: testCase.id,
        passed: isDeepStrictEqual(
            actual, testCase.expected
        ),
        source: result.source,
        elapsedMs,
        expected: JSON.stringify(testCase.expected),
        actual: JSON.stringify(actual)
    })
    console.table(
        rows.map((row) => ({
            id: row.id,
            passed: row.passed,
            source: row.source,
            elapsedMs: row.elapsedMs
        }))
    );

    for (const row of rows.filter(
        (item) => !item.passed
    )) {
        console.log(`\nFAILED: ${row.id}`);
        console.log(`Expected: ${row.expected}`);
        console.log(`Actual:   ${row.actual}`);
    }

    const passedCount = rows.filter((item) => item.passed).length;

    const ruleCount = rows.filter(
        (row) => row.source === "rule"
    ).length;

    const llmCount = rows.length - ruleCount;

    const sortedLatencies = rows.map((row) => row.elapsedMs)
        .sort((left, right) => left - right);

    // 采用 nearest-rank 方法计算 P95；至少选择第一个延迟样本。
    const p95Index = Math.max(0,
        Math.ceil(sortedLatencies.length * 0.95) - 1);

    const accuracy = passedCount / rows.length;

    console.log("\nEvaluation summary");
    console.log(`Cases: ${rows.length}`);
    console.log(
        `Accuracy: ${(accuracy * 100).toFixed(1)}%`
    );
    console.log(
        `Rule hit rate: ${(
            (ruleCount / rows.length) *
            100
        ).toFixed(1)}%`
    );
    console.log(
        `LLM fallback rate: ${(
            (llmCount / rows.length) *
            100
        ).toFixed(1)}%`
    );
    console.log(
        `P95 latency: ${sortedLatencies[p95Index]}ms`
    );
    // 准确率低于质量门槛时设置非零退出码，方便 CI 判定评估失败。
    if (accuracy < 0.85) {
        process.exitCode = 1;
    }
}
