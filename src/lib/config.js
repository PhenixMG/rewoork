import { z } from "zod";

const clean = (v) => v?.replace?.(/^\s*['"]?|['"]?\s*$/g, "") ?? v; // trim + retire guillemets
const env = new Proxy(process.env, {
    get: (t, p) => clean(t[p]),
});

const schema = z.object({
    DISCORD_TOKEN: z.string().min(10),
    DISCORD_CLIENT_ID: z.string().min(5),
    DISCORD_GUILD_ID: z.string().optional(),
    DATABASE_URL: z.string().url().optional(), // si pas encore set
    NODE_ENV: z.enum(["development","production","test"]).default("development"),
    LOG_LEVEL: z.enum(["fatal","error","warn","info","debug","trace","silent"]).default("info"),
    HEALTH_PORT: z.coerce.number().int().positive().default(3000),
});

export const cfg = (() => {
    const parsed = schema.safeParse(env);
    if (!parsed.success) {
        console.error("❌ Invalid configuration:\n", parsed.error.flatten());
        process.exit(1);
    }
    return parsed.data;
})();