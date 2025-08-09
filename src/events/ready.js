import { log } from "../lib/logger.js";
export const name = "ready";
export const once = true;

export function execute(client) {
    log.info({ user: client.user.tag }, "Bot ready");
}
