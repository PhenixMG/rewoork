import {
    SlashCommandBuilder, PermissionFlagsBits, ChannelType,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder
} from "discord.js";
import { prisma } from "../../lib/db.js";
import { formatInTimeZone, zonedTimeToUtc } from "./time.js";
import { canManageRaids } from "../../lib/authz.js";
import { enqueueRaidJobs } from "../../jobs/enqueue.js";

const ZONES = [
    { name: "Heures Sombres", value: "HEURES_SOMBRE" },
    { name: "Cheval de Fer", value: "CHEVAL_DE_FER" },
];

export const data = new SlashCommandBuilder()
    .setName("raid")
    .setDescription("Raids TD2")
    // create
    .addSubcommand(sc => sc
        .setName("create")
        .setDescription("Créer un raid et poster le message interactif")
        .addStringOption(o => o.setName("zone").setDescription("Raid").setRequired(true).addChoices(...ZONES))
        .addStringOption(o => o.setName("date").setDescription("dd/mm/yyyy hh:mm (heure serveur)").setRequired(true))
        .addStringOption(o => o.setName("notes").setDescription("Notes (optionnel)"))
    )
    // cancel
    .addSubcommand(sc => sc
        .setName("cancel")
        .setDescription("Annuler un raid existant")
        .addIntegerOption(o => o.setName("id").setDescription("ID raid").setRequired(true))
    )
    // reschedule
    .addSubcommand(sc => sc
        .setName("reschedule")
        .setDescription("Replanifier un raid")
        .addIntegerOption(o => o.setName("id").setDescription("ID raid").setRequired(true))
        .addStringOption(o => o.setName("date").setDescription("dd/mm/yyyy hh:mm (heure serveur)").setRequired(true))
    )
    // done
    .addSubcommand(sc => sc
        .setName("done")
        .setDescription("Clôturer un raid (DONE)")
        .addIntegerOption(o => o.setName("id").setDescription("ID raid").setRequired(true))
    )
    // 🔒 lock
    .addSubcommand(sc => sc
        .setName("lock")
        .setDescription("Verrouiller le roster d’un raid (plus d’inscriptions/modifs)")
        .addIntegerOption(o => o.setName("id").setDescription("ID raid").setRequired(true))
    )
    // 🔓 unlock
    .addSubcommand(sc => sc
        .setName("unlock")
        .setDescription("Déverrouiller le roster d’un raid")
        .addIntegerOption(o => o.setName("id").setDescription("ID raid").setRequired(true))
    )
    // 🔁 swap
    .addSubcommand(sc => sc
        .setName("swap")
        .setDescription("Échanger les positions entre deux joueurs titulaires")
        .addIntegerOption(o => o.setName("id").setDescription("ID raid").setRequired(true))
        .addUserOption(o => o.setName("user_a").setDescription("Joueur A").setRequired(true))
        .addUserOption(o => o.setName("user_b").setDescription("Joueur B").setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents);

export const cooldown = 2000;
const MAX_RAID_PLAYERS = 8;
// Répartition indicative (UX) pour afficher les compteurs par rôle
const ROLE_CAPS = { DPS: 5, HEAL: 2, TANK: 1 };

// ===== EXECUTE =====
export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "create") return createRaid(interaction);
    if (sub === "cancel") return cancelRaid(interaction);
    if (sub === "reschedule") return rescheduleRaid(interaction);
    if (sub === "done") return doneRaid(interaction);
    if (sub === "lock") return lockRaid(interaction);
    if (sub === "unlock") return unlockRaid(interaction);
    if (sub === "swap") return swapRaid(interaction);
    return interaction.reply({ content: "Sous-commande inconnue.", ephemeral: true });
}

// ===== CREATE =====
async function createRaid(interaction) {
    if (!(await canManageRaids(interaction, prisma))) {
        return interaction.reply({ content: "⛔ Tu n’as pas la permission de créer un raid.", ephemeral: true });
    }

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const zone = interaction.options.getString("zone", true);
    const dateStr = interaction.options.getString("date", true);
    const notes = interaction.options.getString("notes") ?? null;

    const g = await prisma.guild.findUnique({ where: { id: guildId }, select: { tz: true } });
    const tz = g?.tz || "Europe/Paris";
    const startAt = parseDateInTz(dateStr, tz);
    if (!startAt) return interaction.reply({ content: `❌ Date invalide. Ex: \`10/08/2025 21:00\` (${tz})`, ephemeral: true });

    const chans = await prisma.guildChannels.findUnique({ where: { guildId }, select: { raidsTd2ChannelId: true } });
    const targetId = chans?.raidsTd2ChannelId;
    if (!targetId) return interaction.reply({ content: "⚙️ Salon raids TD2 non configuré.", ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    // 1) DB: créer le raid + inscrire le créateur en DPS (position 1)
    const raid = await prisma.$transaction(async (tx) => {
        const r = await tx.raid.create({
            data: { guildId, createdBy: userId, zone, notes, startAt }
        });
        await tx.raidParticipant.create({
            data: { raidId: r.id, userId, role: "DPS", status: "CONFIRMED", position: 1, confirmedAt: new Date() }
        });
        return r;
    });

    // 2) Rendu + post
    const channel = await interaction.guild.channels.fetch(targetId).catch(() => null);
    if (!channel) return interaction.editReply("❌ Salon introuvable / permissions manquantes.");

    const { embed, rows } = await renderRaidMessage(raid, tz);

    // Thread title: Raid <zone> - dd/mm/yyyy:hh:mm
    const datePart = formatInTimeZone(raid.startAt, tz, "dd/MM/yyyy");
    const timePart = formatInTimeZone(raid.startAt, tz, "HH:mm");
    const threadTitle = `Raid ${labelZone(zone)} - ${datePart}:${timePart}`;

    let postMessageId;
    if (channel.type === ChannelType.GuildForum) {
        const thread = await channel.threads.create({
            name: threadTitle,
            message: { embeds: [embed], components: rows },
        });
        postMessageId = thread.id;
    } else {
        const msg = await channel.send({ embeds: [embed], components: rows });
        postMessageId = msg.id;
        await msg.startThread({
            name: threadTitle,
            autoArchiveDuration: 1440,
            reason: `Thread auto pour raid #${raid.id}`,
        }).catch(() => null);
    }

    await prisma.raid.update({
        where: { id: raid.id },
        data: { postChannelId: channel.id, postMessageId }
    });

    await enqueueRaidJobs(raid);

    return interaction.editReply(`✅ Raid créé (#${raid.id}) dans <#${channel.id}>.`);
}

// ===== CANCEL =====
async function cancelRaid(interaction) {
    if (!(await canManageRaids(interaction, prisma))) {
        return interaction.reply({ content: "⛔ Tu n’as pas la permission d’annuler un raid.", ephemeral: true });
    }

    const id = interaction.options.getInteger("id", true);
    const raid = await prisma.raid.findUnique({ where: { id } });
    if (!raid) return interaction.reply({ content: "Raid introuvable.", ephemeral: true });

    await prisma.raid.update({ where: { id }, data: { status: "CANCELLED" } });

    // Re-render du post (avec boutons désactivés si annulé)
    await editRaidPost(interaction.guild, BigInt(id)).catch(() => {});
    return interaction.reply({ content: `⛔ Raid #${id} annulé.`, ephemeral: true });
}

// ===== RESCHEDULE =====
async function rescheduleRaid(interaction) {
    if (!(await canManageRaids(interaction, prisma))) {
        return interaction.reply({ content: "⛔ Tu n’as pas la permission de replanifier un raid.", ephemeral: true });
    }

    const id = interaction.options.getInteger("id", true);
    const dateStr = interaction.options.getString("date", true);

    const raid = await prisma.raid.findUnique({ where: { id } });
    if (!raid) return interaction.reply({ content: "Raid introuvable.", ephemeral: true });
    if (raid.status === "CANCELLED" || raid.status === "DONE") {
        return interaction.reply({ content: "Ce raid est déjà clôturé/annulé.", ephemeral: true });
    }

    const g = await prisma.guild.findUnique({ where: { id: interaction.guildId }, select: { tz: true } });
    const tz = g?.tz || "Europe/Paris";
    const startAt = parseDateInTz(dateStr, tz);
    if (!startAt) {
        return interaction.reply({ content: `❌ Date invalide. Ex: \`10/08/2025 21:00\` (${tz})`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const updated = await prisma.raid.update({
        where: { id },
        data: {
            startAt,
            reminder15Sent: false,
        }
    });

    // Ré-enqueue les jobs -15 & start
    await enqueueRaidJobs(updated);

    // MAJ du post + renommage thread si besoin
    await editRaidMessageAndThread(interaction, updated);

    const datePart = formatInTimeZone(updated.startAt, tz, "dd/MM/yyyy");
    const timePart = formatInTimeZone(updated.startAt, tz, "HH:mm");
    return interaction.editReply(`✅ Raid #${id} replanifié au **${datePart} ${timePart}** (${tz}).`);
}

// ===== DONE =====
async function doneRaid(interaction) {
    if (!(await canManageRaids(interaction, prisma))) {
        return interaction.reply({ content: "⛔ Tu n’as pas la permission de clôturer un raid.", ephemeral: true });
    }

    const id = interaction.options.getInteger("id", true);
    const raid = await prisma.raid.findUnique({ where: { id } });
    if (!raid) return interaction.reply({ content: "Raid introuvable.", ephemeral: true });
    if (raid.status === "DONE") return interaction.reply({ content: "Ce raid est déjà marqué **DONE**.", ephemeral: true });
    if (raid.status === "CANCELLED") return interaction.reply({ content: "Ce raid est **annulé**.", ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const updated = await prisma.raid.update({
        where: { id },
        data: { status: "DONE" }
    });

    // Désactiver les boutons + re-render
    await editRaidPost(interaction.guild, BigInt(id)).catch(() => {});
    return interaction.editReply(`✅ Raid #${id} marqué **DONE**.`);
}

// ===== Boutons (customId ROUTING) =====
export function buildRaidRows(raidId, disabled = false) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`TD2:RAID:${raidId}:JOIN`).setLabel("Rejoindre").setStyle(ButtonStyle.Success).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`TD2:RAID:${raidId}:SUB`).setLabel("🧩 Suppléant").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`TD2:RAID:${raidId}:LEAVE`).setLabel("Quitter").setStyle(ButtonStyle.Danger).setDisabled(false),
            new ButtonBuilder().setCustomId(`TD2:RAID:${raidId}:REFRESH`).setLabel("Rafraîchir").setStyle(ButtonStyle.Primary).setDisabled(false),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`TD2:RAID:${raidId}:ROLE:DPS`).setLabel("DPS").setStyle(ButtonStyle.Primary).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`TD2:RAID:${raidId}:ROLE:HEAL`).setLabel("Heal").setStyle(ButtonStyle.Primary).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`TD2:RAID:${raidId}:ROLE:TANK`).setLabel("Tank").setStyle(ButtonStyle.Primary).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`TD2:RAID:${raidId}:LATE`).setLabel("⌛ En retard").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
            new ButtonBuilder().setCustomId(`TD2:RAID:${raidId}:ABSENT`).setLabel("🚫 Absent").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        ),
    ];
}

// ===== Rendu du message (embed ++ propre) =====
export async function renderRaidMessage(raid, tz) {
    const full = await prisma.raid.findUnique({
        where: { id: raid.id },
        include: { participants: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } }
    });

    const titulars = full.participants.filter(p => p.status !== "SUBSTITUTE" && p.status !== "ABSENT");
    const subs     = full.participants.filter(p => p.status === "SUBSTITUTE");
    const lates    = full.participants.filter(p => p.status === "LATE");
    const abs      = full.participants.filter(p => p.status === "ABSENT");

    const dps  = titulars.filter(p => p.role === "DPS");
    const heal = titulars.filter(p => p.role === "HEAL");
    const tank = titulars.filter(p => p.role === "TANK");

    const unix = Math.floor(new Date(full.startAt).getTime() / 1000);
    const timeLine = `🕑 Départ: <t:${unix}:F> • <t:${unix}:R> (${tz})`;
    const zoneLine = `📍 Zone: **${labelZone(full.zone)}**`;
    const lockLine = full.rosterLocked ? "🔒 **Roster verrouillé**" : null;
    const notesLine = full.notes ? `💬 ${full.notes}` : null;

    const embed = new EmbedBuilder()
        .setTitle(`🎯 Raid — ${labelZone(full.zone)}`)
        .setDescription([timeLine, zoneLine, lockLine, notesLine].filter(Boolean).join("\n"))
        .addFields(
            { name: `💥 DPS (${dps.length}/${ROLE_CAPS.DPS})`,  value: listUsers(dps)  || "_(vide)_", inline: true },
            { name: `💚 HEAL (${heal.length}/${ROLE_CAPS.HEAL})`, value: listUsers(heal) || "_(vide)_", inline: true },
            { name: `🛡️ TANK (${tank.length}/${ROLE_CAPS.TANK})`, value: listUsers(tank) || "_(vide)_", inline: true },
            { name: "📋 Suppléants", value: listUsers(subs) || "_Aucun_", inline: false },
            ...(lates.length || abs.length ? [
                { name: "⌛ En retard", value: listUsers(lates) || "_Aucun_", inline: true },
                { name: "🚫 Absents",  value: listUsers(abs)   || "_Aucun_", inline: true },
            ] : [])
        )
        .addFields({ name: "Progression", value: progressBar(titulars.length, MAX_RAID_PLAYERS), inline: false })
        .setColor(full.status === "CANCELLED" ? 0x6b7280 : full.status === "DONE" ? 0x0ea5e9 : 0x22c55e)
        .setFooter({ text: `ID #${full.id} • Créé par <@${full.createdBy}>` });

    // ⚠️ Désactivation des boutons si non PLANNED **ou** rosterLocked
    const rows = buildRaidRows(full.id, full.status !== "PLANNED" || full.rosterLocked);
    return { embed, rows };
}

// ===== Helper d’édition (texte vs forum) =====
async function editRaidPost(guild, raidId) {
    const raid = await prisma.raid.findUnique({
        where: { id: raidId },
        select: { id: true, postChannelId: true, postMessageId: true, status: true }
    });
    if (!raid?.postChannelId || !raid?.postMessageId) return false;

    const ch = await guild.channels.fetch(raid.postChannelId).catch(() => null);
    if (!ch) return false;

    const tz = (await prisma.guild.findUnique({ where: { id: guild.id }, select: { tz: true } }))?.tz || "Europe/Paris";
    const { embed, rows } = await renderRaidMessage({ id: raid.id }, tz);

    // Désactiver les boutons si annulé ou DONE
    if (raid.status === "CANCELLED" || raid.status === "DONE") {
        rows.forEach(r => r.components.forEach(b => b.setDisabled(true)));
    }

    if (ch.type === ChannelType.GuildForum) {
        const thread = await ch.threads.fetch(raid.postMessageId).catch(() => null);
        if (!thread) return false;
        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (!starter) return false;
        await starter.edit({ embeds: [embed], components: rows }).catch(() => {});
        return true;
    } else {
        const msg = await ch.messages.fetch(raid.postMessageId).catch(() => null);
        if (!msg) return false;
        await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
        return true;
    }
}

// ===== Helper: éditer + renommer thread lors d'une replanif =====
async function editRaidMessageAndThread(interaction, raidLike) {
    if (!raidLike.postChannelId || !raidLike.postMessageId) return;

    const ch = await interaction.guild.channels.fetch(raidLike.postChannelId).catch(() => null);
    if (!ch) return;

    const tz = (await prisma.guild.findUnique({ where: { id: interaction.guildId }, select: { tz: true } }))?.tz || "Europe/Paris";
    const { embed, rows } = await renderRaidMessage(raidLike, tz);

    const datePart = formatInTimeZone(raidLike.startAt, tz, "dd/MM/yyyy");
    const timePart = formatInTimeZone(raidLike.startAt, tz, "HH:mm");
    const newTitle = `Raid ${labelZone(raidLike.zone)} - ${datePart}:${timePart}`;

    if (ch.type === ChannelType.GuildForum) {
        const thread = await ch.threads.fetch(raidLike.postMessageId).catch(() => null);
        if (!thread) return;
        if (thread.name !== newTitle) await thread.setName(newTitle).catch(() => {});
        await thread.edit({ message: { embeds: [embed], components: rows } }).catch(async () => {
            await thread.send({ embeds: [embed], components: rows }).catch(() => {});
        });
    } else {
        const msg = await ch.messages.fetch(raidLike.postMessageId).catch(() => null);
        if (!msg) return;
        await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
        if (msg.hasThread && msg.thread?.name && msg.thread.name !== newTitle) {
            await msg.thread.setName(newTitle).catch(() => {});
        }
    }
}

async function lockRaid(interaction) {
    if (!(await canManageRaids(interaction, prisma))) {
        return interaction.reply({ content: "⛔ Permission refusée.", ephemeral: true });
    }
    const id = interaction.options.getInteger("id", true);
    const raid = await prisma.raid.findUnique({ where: { id } });
    if (!raid) return interaction.reply({ content: "Raid introuvable.", ephemeral: true });

    await prisma.raid.update({ where: { id }, data: { rosterLocked: true } });
    await editRaidPost(interaction.guild, BigInt(id)).catch(() => {});
    return interaction.reply({ content: `🔒 Roster du raid #${id} verrouillé.`, ephemeral: true });
}

async function unlockRaid(interaction) {
    if (!(await canManageRaids(interaction, prisma))) {
        return interaction.reply({ content: "⛔ Permission refusée.", ephemeral: true });
    }
    const id = interaction.options.getInteger("id", true);
    const raid = await prisma.raid.findUnique({ where: { id } });
    if (!raid) return interaction.reply({ content: "Raid introuvable.", ephemeral: true });

    await prisma.raid.update({ where: { id }, data: { rosterLocked: false } });
    await editRaidPost(interaction.guild, BigInt(id)).catch(() => {});
    return interaction.reply({ content: `🔓 Roster du raid #${id} déverrouillé.`, ephemeral: true });
}

// ===== SWAP =====
async function swapRaid(interaction) {
    if (!(await canManageRaids(interaction, prisma))) {
        return interaction.reply({ content: "⛔ Permission refusée.", ephemeral: true });
    }
    const id = interaction.options.getInteger("id", true);
    const userA = interaction.options.getUser("user_a", true).id;
    const userB = interaction.options.getUser("user_b", true).id;

    const raid = await prisma.raid.findUnique({
        where: { id },
        include: { participants: true }
    });
    if (!raid) return interaction.reply({ content: "Raid introuvable.", ephemeral: true });

    // On ne swap que des titulaires (pas SUB/ABSENT) et avec une position définie
    const a = raid.participants.find(p => p.userId === userA && p.status !== "SUBSTITUTE" && p.status !== "ABSENT" && p.position != null);
    const b = raid.participants.find(p => p.userId === userB && p.status !== "SUBSTITUTE" && p.status !== "ABSENT" && p.position != null);

    if (!a || !b) {
        return interaction.reply({ content: "❌ Les deux joueurs doivent être titulaires avec une position.", ephemeral: true });
    }

    await prisma.$transaction(async (tx) => {
        // swap des positions
        await tx.raidParticipant.update({
            where: { raidId_userId: { raidId: raid.id, userId: a.userId } },
            data: { position: b.position }
        });
        await tx.raidParticipant.update({
            where: { raidId_userId: { raidId: raid.id, userId: b.userId } },
            data: { position: a.position }
        });
    });

    await editRaidPost(interaction.guild, BigInt(id)).catch(() => {});
    return interaction.reply({ content: `🔁 Swap effectué entre <@${userA}> et <@${userB}> pour le raid #${id}.`, ephemeral: true });
}

// ===== Utils =====
function listUsers(rows) {
    if (!rows.length) return "";
    return rows.map((p, i) => {
        const pos = p.position ?? (i + 1);
        const role = p.role === "DPS" ? "⚔️" : p.role === "HEAL" ? "💉" : "🛡️";
        const st = p.status === "LATE" ? " ⌛" : p.status === "ABSENT" ? " 🚫" : "";
        return `#${pos} <@${p.userId}> ${role}${st}`;
    }).join("\n");
}

function progressBar(current, max, size = 12) {
    const filled = Math.round((current / max) * size);
    return `${"▰".repeat(filled)}${"▱".repeat(Math.max(size - filled, 0))}  **${current}/${max}**`;
}

function labelZone(z) { return z === "HEURES_SOMBRE" ? "Heures Sombres" : "Cheval de Fer"; }

function parseDateInTz(s, tz) {
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const [, d, mo, y, h, mi] = m.map(Number);
    const isoLocal = `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")} ${String(h).padStart(2,"0")}:${String(mi).padStart(2,"0")}:00`;
    return zonedTimeToUtc(isoLocal, tz);
}
