import { Events } from "discord.js";
import { prisma } from "../lib/db.js";

function guessTzFromLocale(locale) {
    // mini heuristique : ajuste si tu veux couvrir d’autres langues/pays
    if (!locale) return "Europe/Paris";
    const l = locale.toLowerCase();
    if (l.startsWith("fr")) return "Europe/Paris";
    if (l.startsWith("en-us")) return "America/New_York";
    if (l.startsWith("en-gb")) return "Europe/London";
    if (l.startsWith("de")) return "Europe/Berlin";
    if (l.startsWith("es")) return "Europe/Madrid";
    if (l.startsWith("pt-br")) return "America/Sao_Paulo";
    return "Europe/Paris";
}

export const name = Events.GuildCreate;
export const once = false;

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 */
export async function execute(client, guild) {
    try {
        const locale = guild.preferredLocale ?? null;
        const tz = guessTzFromLocale(locale);

        // 1) Upsert de la guilde
        await prisma.guild.upsert({
            where: { id: guild.id },
            update: {
                name: guild.name ?? null,
                locale: guild.preferredLocale ?? null,
                tz: null,
            },
            create: {
                id: guild.id,
                name: guild.name ?? null,
                locale: guild.preferredLocale ?? null,
                tz: null,
            },
        });

        await prisma.userProfile.upsert({
            where: { guildId: guild.id },
            update: {
                guildId: guild.id,
                userId: guild.ownerId,
                alias: (await guild.fetchOwner({force: true})).nickname,
                tz: guild.preferredLocale ?? null,
                note: 'Fondateur'
            },
            create: {
                guildId: guild.id,
                userId: guild.ownerId,
                alias: (await guild.fetchOwner({force: true})).nickname,
                tz: guild.preferredLocale ?? null,
                note: 'Fondateur'
            }
        })

        // Log sympa dans la console
        console.log(`[guildCreate] Joined: ${guild.name} (${guild.id}) — locale=${locale} tz=${tz}`);
    } catch (e) {
        console.error("[guildCreate] upsert failed:", e);
    }
}