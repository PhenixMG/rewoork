import { Client, GatewayIntentBits, Partials, Collection, REST, Routes } from "discord.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";
import { cfg } from "./lib/config.js";
import { log } from "./lib/logger.js";
import { safeDbConnect, gracefulShutdown } from "./lib/db.js";
import { startHealthServer } from "./lib/health.js";
import {startJobsWorker} from "./jobs/worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({
    intents: [GatewayIntentBits.Guilds], // 👈 minimal
    partials: [Partials.Channel]
});

client.commands = new Collection();
client.log = log;

// Load commands
async function loadCommands() {
    const cmdDir = path.join(__dirname, "commands");
    async function walk(dir) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) await walk(full);
            else if (e.isFile() && e.name.endsWith(".js")) {
                const mod = await import(`file://${full}`);
                if (mod.data?.name && typeof mod.execute === "function") {
                    client.commands.set(mod.data.name, mod);
                }
            }
        }
    }
    await walk(cmdDir);
    log.info({ count: client.commands.size }, "Commands loaded");
}

// Load events
async function loadEvents() {
    const evtDir = path.join(__dirname, "events");
    const files = (await readdir(evtDir)).filter(f => f.endsWith(".js"));
    for (const f of files) {
        const { name, once = false, execute } = await import(`file://${path.join(evtDir, f)}`);
        client[once ? "once" : "on"](name, (...args) => execute(client, ...args));
    }
    log.info({ count: files.length }, "Events bound");
}

// Register slash commands (guild in dev, global otherwise)
async function registerCommands() {
    console.log(cfg.DISCORD_TOKEN)
    const rest = new REST({ version: "10" }).setToken(cfg.DISCORD_TOKEN);

    const body = [...client.commands.values()].map(c => c.data.toJSON());
    if (cfg.DISCORD_GUILD_ID && cfg.NODE_ENV !== "production") {
        await rest.put(Routes.applicationGuildCommands(cfg.DISCORD_CLIENT_ID, cfg.DISCORD_GUILD_ID), { body });
        log.info("Guild commands registered (dev)");
    } else {
        await rest.put(Routes.applicationCommands(cfg.DISCORD_CLIENT_ID), { body });
        log.info("Global commands registered (prod)");
    }
}

(async function main() {
    startHealthServer(async () => ({
        ok: true,
        commands: client.commands?.size ?? 0,
        uptime: process.uptime(),
    }));

    await safeDbConnect();
    await loadCommands();
    await loadEvents();
    await registerCommands();

    client.login(cfg.DISCORD_TOKEN).catch((err) => {
        log.error({ err }, "Login failed");
        process.exit(1);
    });
    startJobsWorker(client)
})();

// Robustesse process
process.on("uncaughtException", (err) => log.error({ err }, "uncaughtException"));
process.on("unhandledRejection", (err) => log.error({ err }, "unhandledRejection"));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => gracefulShutdown(s));
