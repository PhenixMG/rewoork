import http from "node:http";
import { cfg } from "./config.js";

export function startHealthServer(statusFn) {
    const server = http.createServer(async (_req, res) => {
        try {
            const status = await statusFn();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(status));
        } catch (e) {
            console.error(e);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false }));
        }
    });
    server.listen(cfg.HEALTH_PORT);
    return server;
}
