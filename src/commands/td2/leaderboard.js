import {
    SlashCommandBuilder, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle
} from "discord.js";
import { prisma } from "../../lib/db.js";

const DEFAULT_SIZE = 10;

export const data = new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Classement des points (mois en cours)")
    .addIntegerOption(o => o.setName("page").setDescription("Page (1, 2, 3, ...)").setMinValue(1))
    .addIntegerOption(o => o
        .setName("size")
        .setDescription("Taille de page (5, 10, 15, 20)")
        .addChoices({name:"5",value:5},{name:"10",value:10},{name:"15",value:15},{name:"20",value:20})
    );

export const cooldown = 2000;

export async function execute(interaction) {
    const guildId = interaction.guildId;
    const size = interaction.options.getInteger("size") ?? DEFAULT_SIZE;
    const page = interaction.options.getInteger("page") ?? 1;

    const { embed, components } = await renderLeaderboard(guildId, page, size, interaction.user.id);
    return interaction.reply({ embeds: [embed], components, allowedMentions: { parse: [] } });
}

// ===== helpers =====
export async function renderLeaderboard(guildId, page, size, viewerId) {
    const total = await prisma.playerPoints.count({ where: { guildId } });
    const maxPage = Math.max(1, Math.ceil(total / size));
    const p = Math.min(Math.max(1, page), maxPage);
    const skip = (p - 1) * size;

    const rows = await prisma.playerPoints.findMany({
        where: { guildId },
        orderBy: [{ points: "desc" }, { userId: "asc" }],
        skip, take: size,
    });

    // rang du viewer
    let myRankText = "_Aucun point pour l’instant._";
    const me = await prisma.playerPoints.findFirst({ where: { guildId, userId: viewerId } });
    if (me) {
        const better = await prisma.playerPoints.count({ where: { guildId, points: { gt: me.points } } });
        myRankText = `#${better + 1} — **${me.points}** pts`;
    }

    const startRank = skip + 1;
    const lines = rows.map((r, i) => {
        const rank = startRank + i;
        const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "•";
        return `${medal} **#${rank}** — <@${r.userId}> — **${r.points}** pts`;
    }).join("\n") || "_Aucun joueur listé sur cette page._";

    const embed = new EmbedBuilder()
        .setTitle("🏆 Classement TD2 — Points (mois en cours)")
        .setDescription(lines)
        .addFields(
            { name: "Page", value: `${p}/${maxPage}`, inline: true },
            { name: "Joueurs scorés", value: `${total}`, inline: true },
            { name: `Ton rang — <@${viewerId}>`, value: myRankText, inline: false },
        )
        .setColor(0xf59e0b);

    const components = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`LB:BEGIN:${guildId}:${size}`).setLabel("« Début").setStyle(ButtonStyle.Secondary).setDisabled(p === 1),
            new ButtonBuilder().setCustomId(`LB:PREV:${guildId}:${p - 1}:${size}`).setLabel("◀️ Préc").setStyle(ButtonStyle.Primary).setDisabled(p === 1),
            new ButtonBuilder().setCustomId("LB:SEP").setLabel(`Page ${p}/${maxPage}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`LB:NEXT:${guildId}:${p + 1}:${size}`).setLabel("Suiv ▶️").setStyle(ButtonStyle.Primary).setDisabled(p === maxPage),
            new ButtonBuilder().setCustomId(`LB:END:${guildId}:${size}`).setLabel("Fin »").setStyle(ButtonStyle.Secondary).setDisabled(p === maxPage),
        )
    ];

    return { embed, components };
}

function lbId(guildId, page, size) {
    // customId = LB:<guildId>:<page>:<size>
    return `LB:${guildId}:${page}:${size}`;
}
