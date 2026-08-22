import { raw } from "express";
import { CommandModelProvider } from "../model/command-model-provider";
import { parseLlmCommand } from "./llm-command-parser";
import { parseRuleCommand, type RuleParseContext } from "./rule-command-parser";
import { ru } from "zod/locales";
type AddSource<
    TResult,
    TSource extends "rule" | "llm"
> = TResult extends object
    ? TResult & {
        source: TSource;
    }
    : never;

export type CommandParseResult =
    | AddSource<ReturnType<typeof parseRuleCommand>, "rule">
    | AddSource<Awaited<ReturnType<typeof parseLlmCommand>>, "llm">;

export async function parseCommand(
    rawInput: string,
    context: RuleParseContext,
    provider: CommandModelProvider
): Promise<CommandParseResult> {

    const ruleResult = parseRuleCommand(rawInput, context);
    if (ruleResult.success) {
        return {
            ...ruleResult,
            source: "rule",
        }
    }
    // 规则已经明确判断出缺少参数或命令不安全时，
    // 不允许LLM重新解释并绕过规则结果。
    if (ruleResult.error.code !== "UNSUPPORTED_INTENT") {
        return {
            ...ruleResult,
            source: "rule"
        };
    }

    const llmResult = await parseLlmCommand(rawInput, context, provider);
    return {
        ...llmResult,
        source: "llm"
    };


}
