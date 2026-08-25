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

export class InMemoryApprovalStore {
    private readonly items = new Map<string, PendingDeviceAction>();
    create(
        input: Omit<PendingDeviceAction, "approvalId" | "status">): PendingDeviceAction {
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
        // 不向其他设备泄露审批是否存在
        if (!action || action.deviceId != deviceId) {
            return {
                success: false,
                code: "APPROVAL_NOT_FOUND"
            };
        }

        if (action.status !== "pending") {
            return { success: false, code: "APPROVAL_ALREADY_RESOLVED" };
        }

        if (Date.parse(action.expiresAt) <= now.getTime()) {
            action.status = "expired";
            return { success: false, code: "APPROVAL_EXPIRED" };
        }
        // 在 await 设备调用之前同步占用，避免并发重复执行
        action.status = "executing";
        return { success: true, action };

    }
    reject(approvalId: string,
        deviceId: string,
    ): boolean {
        const action = this.items.get(approvalId);
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
        const action = this.items.get(approvalId);
        if (action?.status === "executing") {
            action.status = success ? "executed" : "failed";
        }
    }


}