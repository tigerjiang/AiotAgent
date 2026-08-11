import request from "supertest"; // 导入 SuperTest，用于向 Express 应用发送测试请求。
import { describe, expect, it } from "vitest"; // 导入测试套件、断言和测试用例函数。
import { app } from "../src/app"; // 导入待测试的 Express 应用实例。
describe("GET /health", () => { // 定义健康检查接口的测试套件。
    it("returns the service health status", async () => { // 验证接口能够返回预期的服务健康状态。
        const response = await request(app).get("/health"); // 向健康检查接口发起 GET 请求并等待响应。
        expect(response.status).toBe(200); // 断言接口返回 HTTP 200 成功状态码。
        expect(response.body).toEqual({ // 断言响应体的整体结构和内容符合预期。
            status: "ok", // 期望健康状态为正常。
            service: "aiot-device-command-service", // 期望响应包含正确的服务名称。
            timestamp: expect.any(String), // 期望时间戳是任意字符串值。
        }); // 结束响应体的完整匹配断言。
        expect(response.body.timestamp).toBeTypeOf("string"); // 再次确认时间戳字段的数据类型为字符串。
    }); // 结束当前健康检查测试用例。
}); // 结束健康检查接口测试套件。
