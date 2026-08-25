import { randomUUID } from "node:crypto";
import { success } from "zod";
import { fa } from "zod/locales";
import { omit } from "zod/mini";
export type ApprovalStatus =
    | "pending"
    | "executing"
    | "executed"
    | "rejected"
    | "expired"
    | "failed";

export interface PendingDeviceAction {
    approvalId: string;
    deviceId: string;
    deviceType: string;
    toolName: "start_cooking";
    arguments: Record<string, unknown>;
    callId: string;
    continuationInput: unknown[];
    createdAt: string;
    expiresAt: string;
    status: ApprovalStatus;
}

/**
 * 进程内审批存储，同时承担审批状态机的职责。
 *
 * 正常路径：pending -> executing -> executed | failed
 * 取消路径：pending -> rejected
 * 过期路径：pending -> expired
 *
 * 生产环境可替换成带事务或条件更新的持久化存储，但必须保留 claim 的
 * 原子语义，否则两个并发确认请求可能重复执行同一个设备命令。
 */
export class InMemoryApprovalStore {
    private readonly items = new Map<string, PendingDeviceAction>();
    create(
        input: Omit<PendingDeviceAction, "approvalId" | "status">): PendingDeviceAction {
        // UUID 是交给客户端的审批句柄；真正的动作参数和模型上下文仍留在服务端。
        const action: PendingDeviceAction = {
            ...input,
            approvalId: randomUUID(),
            status: "pending",
        };

        this.items.set(action.approvalId, action);
        return action;
    }

    claim(approvalId: string,
        deviceId: string,
        now = new Date(),
    ):
        | { success: true; action: PendingDeviceAction }
        | { success: false; code: string } {
        const action = this.items.get(approvalId);
        // 审批必须绑定当前设备。不向其他设备泄露该 approvalId 是否真实存在。
        if (!action || action.deviceId != deviceId) {
            return {
                success: false,
                code: "APPROVAL_NOT_FOUND"
            };
        }

        // executing 以及所有终态都不能再次占用，实现确认操作的幂等保护。
        if (action.status !== "pending") {
            return { success: false, code: "APPROVAL_ALREADY_RESOLVED" };
        }

        // 到达 expiresAt 的瞬间即过期，避免边界时刻仍可执行。
        if (Date.parse(action.expiresAt) <= now.getTime()) {
            action.status = "expired";
            return { success: false, code: "APPROVAL_EXPIRED" };
        }
        // 在 await 设备调用之前同步占用，避免并发重复执行。
        action.status = "executing";
        return { success: true, action };

    }
    reject(approvalId: string,
        deviceId: string,
    ): boolean {
        const action = this.items.get(approvalId);
        // 只有属于当前设备的 pending 审批能够被拒绝；终态不会被覆盖。
        if (!action ||
            action.deviceId !== deviceId
            || action.status !== "pending"
        ) {
            return false;
        }
        action.status = "rejected";
        return true;
    }

    finish(approvalId: string, success: boolean): void {
        // 只有已被 claim 的审批可以结束，防止绕过正常状态转换。
        const action = this.items.get(approvalId);
        if (action?.status === "executing") {
            action.status = success ? "executed" : "failed";
        }
    }


}
