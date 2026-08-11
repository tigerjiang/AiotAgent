import { app } from "./app"; // 导入已经配置好的 Express 应用实例。
const port = Number(process.env.PORT ?? 3000); // 优先读取环境变量中的端口，未配置时使用 3000。
app.listen(port, () => { // 启动 HTTP 服务器并监听指定端口。
    console.log(`Server is running on port ${port}`); // 在服务器启动成功后输出当前监听端口。
}); // 结束服务器启动调用。
