import express from "express"; // 导入 Express 框架的默认导出。
export const app = express(); // 创建并导出 Express 应用，供服务器和测试复用。
app.use(express.json()); // 注册 JSON 请求体解析中间件。
app.get("/health", (_request, response) => { // 注册用于检查服务健康状态的 GET 接口。
    response.json({ // 以 JSON 格式返回当前服务的健康信息。
        status: "ok", // 表示服务目前运行正常。
        service: "aiot-device-command-service", // 返回当前服务的唯一名称。
        timestamp: new Date().toISOString(), // 生成符合 ISO 8601 格式的当前时间戳。
    }); // 结束健康信息对象并发送响应。
}); // 结束健康检查路由的注册。
