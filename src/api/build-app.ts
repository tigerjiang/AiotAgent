import Fastify from "fastify";
import {

    registerDeviceActionRoutes,
    type DeviceActionApiService,
    type VerifiedDeviceContext
} from "./device-action-routes";

interface BuildAppOptions {
    service: DeviceActionApiService;
    authenticate(
        authorization: string | undefined,
    ): Promise<VerifiedDeviceContext>;
}

export async function buildApp(options: BuildAppOptions) {
    const app = Fastify({
        logger: false,
    });
    await registerDeviceActionRoutes(app, {
        authenticate(request) {
            return options.authenticate(request.headers.authorization);
        },
        service: options.service,
    });

    return app;
}

