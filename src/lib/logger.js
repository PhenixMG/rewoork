import pino from "pino";
import { cfg } from "./config.js";

const isDev = cfg.NODE_ENV !== "production";

export const log = pino({
    level: cfg.LOG_LEVEL,
    base: undefined,
    transport: isDev ? { target: "pino-pretty", options: { singleLine: true } } : undefined,
});
