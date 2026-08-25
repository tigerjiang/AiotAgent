/**
 * 启动烹饪审批编排器。
 *
 * 这里刻意把一次高风险设备操作拆成两步：
 * 1. proposeStartCooking 只让模型提取参数并创建待审批记录；
 * 2. resolveStartCooking 只在服务端确认审批有效后才执行设备工具。
 *
 * 模型负责理解自然语言和组织最终回复，但没有直接操作设备的权限。
 */
import { z } from "zod";
import type OpenAI from "openai";
import type { DeviceToolRegistry } from "../tools/device-tool-registry";
import type { DeviceToolContext } from "../tools/device-tool";
import { InMemoryApprovalStore } from "../approval/in-memory-approval-store";
import { de } from "zod/locales";

export const StartCookingInputSchema = z.object({
    temperatureFahrenheit: z.number().int().min(165).max(500),
    durationMinutes: z.number().int().min(1).max(1440).nullable(),
    probeTargetFahrenheit: z.number().int().min(100).max(220).nullable(),
}).strict();

// 暴露给模型的函数定义。strict 和 additionalProperties: false 用来限制模型
// 只能提交预期字段；模型输出仍会在服务端由 StartCookingInputSchema 再校验一次。
const startCookintTool = {
    type: "function" as const,
    name: "start_cooking",
    description: "Propose starting a cooking program. Requires user approval.",
    strict: true,
    parameters: {
        type: "object",
        properties: {
            temperatureFahrenheit: {
                type: "integer",
                minimum: 165,
                maximum: 500,
            },
            durationMinutes: {
                type: ["integer", "null"],
                minimum: 1,
                maximum: 1440,
            },
            probeTargetFahrenheit: {
                type: ["integer", "null"],
                minimum: 100,
                maximum: 220,
            },
        },
        required: [
            "temperatureFahrenheit",
            "durationMinutes",
            "probeTargetFahrenheit",
        ],
        additionalProperties: false,

    },
};
type CreateResponse = (
    input: OpenAI.Responses.ResponseCreateParamsNonStreaming,
) => Promise<OpenAI.Responses.Response>

interface Dependencies {
    // Responses API 被注入，便于替换模型供应商并在测试中精确模拟两次响应。
    createResponse: CreateResponse;
    // 工具注册表负责查找工具，并统一执行工具自己的输入校验。
    registry: DeviceToolRegistry;
    // 审批内容只保存在可信服务端，客户端仅持有不可推导的 approvalId。
    approvals: InMemoryApprovalStore;
    // 当前设备身份来自服务端上下文，而不是模型生成的参数。
    toolContext: DeviceToolContext;
    model: string;
    now?: () => Date;
}

export async function proposeStartCooking(
    userInput: string,
    deps: Dependencies
) {
    // 保留原始用户输入，批准后会连同函数调用一起续接给模型。
    const input: OpenAI.Responses.ResponseInput = [
        { role: "user", content: userInput },
    ];

    // 强制模型调用 start_cooking，但此处只是生成“提议”，绝不执行工具。
    const response = await deps.createResponse({
        model: deps.model,
        instructions:
            "Extract a start_cooking proposal. Never claim the device has started.",
        input,
        tools: [startCookintTool],
        tool_choice: {
            type: "function",
            name: "start_cooking",
        },
        parallel_tool_calls: false,
        store: false
    });


    // 不信任模型一定遵守 tool_choice，显式查找预期的函数调用。
    const call = response.output.find(
        item =>
            item.type === "function_call" &&
            item.name === "start_cooking",
    );

    if (!call || call.type !== "function_call") {
        throw new Error("START_COOKING_CALL_MISSING");
    }
    // JSON 能解析不等于参数安全；温度、时长、探针目标仍需服务端校验。
    const args = StartCookingInputSchema.parse(
        JSON.parse(call.arguments),
    );
    const now = deps.now?.() ?? new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000);

    // 审批五分钟后失效，并保存续接模型会话所需的可信上下文。
    const approval = deps.approvals.create(
        {
            deviceId: deps.toolContext.deviceId,
            deviceType: deps.toolContext.deviceType,
            toolName: "start_cooking",
            arguments: args,
            callId: call.call_id,
            continuationInput: [...input, ...response.output],
            createdAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
        }
    );
    // 不返回 continuationInput，避免客户端篡改模型上下文
    return {
        status: "approval_required" as const,
        approvalId: approval.approvalId,
        expiresAt: approval.expiresAt,
        action: {
            toolName: approval.toolName,
            arguments: approval.arguments,
        }
    }
}

export async function resolveStartCooking(
    approvalId: string,
    decision: "approve" | "reject",
    deps: Dependencies
) {
    const deviceId = deps.toolContext.deviceId;

    // 拒绝是终态：只更新审批记录，不执行工具，也无需再次请求模型。
    if (decision === "reject") {
        const rejected = deps.approvals.reject(approvalId, deviceId);
        return rejected
            ? { status: "rejected" as const, answer: "已取消启动烹饪。" }
            : { status: "error" as const, code: "APPROVAL_NOT_PENDING" };
    }

    // claim 在第一个 await 之前同步把 pending 改成 executing，阻止并发确认
    // 或网络重试对同一 approvalId 造成重复设备操作。
    const claimed = deps.approvals.claim(approvalId, deviceId, deps.now?.() ?? new Date());
    if (!claimed.success) {
        return {
            status: "error" as const, code: claimed.code
        };
    }
    const action = claimed.action;

    // 工具名和参数取自服务端审批记录，不接受客户端在确认阶段重新提交。
    const toolResult = await deps.registry.execute(
        action.toolName,
        action.arguments,
        {
            ...deps.toolContext,

            // 只能由可信服务端代码写入
            confirmed: true,
        },
    );
    // 无论设备执行成功还是失败，都把审批推进到不可再次 claim 的终态。
    deps.approvals.finish(approvalId, toolResult.success);

    // 将真实工具结果作为 function_call_output 续接给模型，最终答复只能基于
    // 实际设备响应生成，不能凭提议阶段的内容宣称“已经启动”。
    const finalResponse = await deps.createResponse(
        {
            model: deps.model,
            instructions: "Report the actual tool result. Do not invent device state.",
            input: [
                ...(action.continuationInput as OpenAI.Responses.ResponseInput),
                {
                    type: "function_call_output",
                    call_id: action.callId,
                    output: JSON.stringify(toolResult),
                }
            ],
            tools: [startCookintTool],
            tool_choice: "none",
            parallel_tool_calls: false,
            store: false
        }
    );
    return {
        status: toolResult.success ? "executed" as const : "failed" as const,
        answer: finalResponse.output_text,
        toolResult
    }

}
