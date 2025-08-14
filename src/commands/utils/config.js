import { SlashCommandBuilder } from "discord.js";
import {prisma} from "../../lib/db.js";

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

export const data = new SlashCommandBuilder()
    .setName("config")
    .setDescription("Config du serveur");

export const cooldown = 2000;

export async function execute(interaction) {
    const locale = interaction.guild.preferredLocale ?? null;
    const tz = guessTzFromLocale(locale);

    // 1) Upsert de la guilde
    await prisma.guild.upsert({
        where: { id: interaction.guild.id },
        update: {
            name: interaction.guild.name ?? null,
            locale: locale ?? undefined,
            tz,
        },
        create: {
            id: interaction.guild.id,
            name: interaction.guild.name ?? null,
            locale: locale,
            tz,
        },
    });
}
