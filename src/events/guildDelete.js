import { Events } from "discord.js";
import { prisma } from "../lib/db.js";

export const name = Events.GuildDelete;
export const once = false;

export async function execute(client, guild) {
    try {
        // On ne supprime pas tout (utile si le bot revient),
        // mais on peut mettre un petit tag dans Guild.name ou un KV si tu veux tracer.
        await prisma.guild.update({
            where: { id: guild.id },
            data: { name: `[LEFT] ${guild.name ?? guild.id}` },
        }).catch(() => {});
        console.log(`[guildDelete] Left: ${guild.name} (${guild.id})`);
    } catch (e) {
        console.error("[guildDelete] update-on-leave failed:", e);
    }
}