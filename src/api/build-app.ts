import Fastify from "fastify";
import {
    registerDeviceActionRoutes,
    type DeviceActionApiService,
    type VerifiedDeviceContext,
} from "./device-action-routes.js";

/**
 * 应用装配参数。
 *
 * 路由只依赖抽象服务和认证函数，因此测试可以注入假实现，生产入口也可以
 * 替换成 JWT、Session 或 API Gateway 提供的认证上下文。
 */
interface BuildAppOptions {
    service: DeviceActionApiService;
    authenticate(
        authorization: string | undefined,
    ): Promise<VerifiedDeviceContext>;
}

/**
 * 创建一个尚未监听端口的 Fastify 实例。
 *
 * 将“构建应用”和“监听端口”分离后，测试可以直接使用 app.inject 发请求，
 * 不需要占用真实网络端口。
 */
export async function buildApp(options: BuildAppOptions) {
    const app = Fastify({
        logger: false,
    });

    // 这里只转交 Authorization。actorId、deviceId 和 deviceType 必须由
    // authenticate 验证并返回，路由不会从客户端 Body 读取这些身份字段。
    await registerDeviceActionRoutes(app, {
        authenticate(request) {
            return options.authenticate(request.headers.authorization);
        },
        service: options.service,
    });

    return app;
}
