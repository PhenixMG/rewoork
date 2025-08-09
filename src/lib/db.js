import { PrismaClient } from "@prisma/client";
import { log } from "./logger.js";

export const prisma = new PrismaClient({
    log: [{ emit: "event", level: "error" }, { emit: "event", level: "warn" }],
});

prisma.$on("error", (e) => log.error({ prisma: e }, "Prisma error"));
prisma.$on("warn", (e) => log.warn({ prisma: e }, "Prisma warn"));

export async function safeDbConnect() {
    try {
        await prisma.$connect();
        log.info("✅ DB connected");
    } catch (err) {
        log.error({ err }, "❌ Failed to connect DB");
        process.exit(1);
    }
}

export async function gracefulShutdown(signal = "SIGTERM") {
    log.info({ signal }, "Shutting down...");
    try {
        await prisma.$disconnect();
    } catch (e) {
        log.warn({ e }, "DB disconnect error");
    } finally {
        process.exit(0);
    }
}
