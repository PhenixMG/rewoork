import { ChannelType, PermissionFlagsBits } from "discord.js";
import { prisma } from "../lib/db.js";
import { formatInTimeZone } from "../commands/td2/time.js";

function labelZone(z) { return z === "HEURES_SOMBRE" ? "Heures Sombres" : "Cheval de Fer"; }
const POINTS_ON_TIME = 10;

async function getRaidCtx(raidId) {
    const raid = await prisma.raid.findUnique({
        where: { id: raidId },
        include: { participants: true }
    });
    if (!raid) return null;
    const guild = await globalThis.client.guilds.fetch(raid.guildId).catch(() => null);
    if (!guild) return null;
    const tz = (await prisma.guild.findUnique({ where: { id: raid.guildId }, select: { tz: true } }))?.tz || "Europe/Paris";
    return { raid, guild, tz };
}

async function getLogsChannel(guild, guildId) {
    const logsId = (await prisma.guildChannels.findUnique({
        where: { guildId }, select: { logChannelId: true }
    }))?.logChannelId;
    if (!logsId) return null;
    return await guild.channels.fetch(logsId).catch(() => null);
}

async function sendInRaidThread(guild, raid, content) {
    if (!raid.postChannelId || !raid.postMessageId) return false;

    const ch = await guild.channels.fetch(raid.postChannelId).catch(() => null);
    if (!ch) return false;

    if (ch.type === ChannelType.GuildForum) {
        const thread = await ch.threads.fetch(raid.postMessageId).catch(() => null);
        if (!thread) return false;
        if (thread.archived) {
            await thread.setArchived(false).catch(() => {});
        }
        await thread.send(content).catch(() => {});
        return true;
    } else {
        const msg = await ch.messages.fetch(raid.postMessageId).catch(() => null);
        if (!msg) return false;
        if (msg.hasThread) {
            if (msg.thread.archived) await msg.thread.setArchived(false).catch(() => {});
            await msg.thread.send(content).catch(() => {});
        } else {
            await msg.reply(content).catch(() => {});
        }
        return true;
    }
}

function mentions(raid, includeSubs = true) {
    const confirmed = raid.participants.filter(p => p.status === "CONFIRMED" || p.status === "LATE");
    const subs = includeSubs ? raid.participants.filter(p => p.status === "SUBSTITUTE") : [];
    const ids = [...new Set([...confirmed, ...subs].map(p => p.userId))];
    return ids.length ? ids.map(id => `<@${id}>`).join(" ") : "@here";
}

export async function sendRaidReminder15(client, raidId) {
    const ctx = await getRaidCtx(raidId);
    if (!ctx) return;
    const { raid, guild, tz } = ctx;

    if (raid.status !== "PLANNED" || raid.reminder15Sent) return;
    // fenêtre de rattrapage : ne spam pas si on est trop en retard
    if (Date.now() - (raid.startAt.getTime() - 15 * 60 * 1000) > 30 * 60 * 1000) {
        return; // >30min après l’heure théorique du rappel
    }

    // ===== Création du vocal si possible (sinon on log un warning et on continue) =====
    let voice;
    try {
        const base = raid.postChannelId
            ? await guild.channels.fetch(raid.postChannelId).catch(() => null)
            : null;

        let canCreate = false;
        let parentId = null;

        if (base) {
            parentId = base.parentId ?? null;

            // Permissions au niveau guilde + catégorie (si présente)
            const me = guild.members.me;
            const hasGuildManage = me?.permissions?.has(PermissionFlagsBits.ManageChannels);
            const hasParentManage = parentId
                ? base.parent?.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)
                : true;

            canCreate = Boolean(hasGuildManage && hasParentManage);
        }

        if (canCreate) {
            // éviter les doublons si le job est relancé
            const existing = guild.channels.cache.find(c =>
                c.type === ChannelType.GuildVoice &&
                c.name === `Raid #${raid.id}` &&
                (parentId ? c.parentId === parentId : true)
            );

            voice = existing || await guild.channels.create({
                name: `Raid #${raid.id}`,
                type: ChannelType.GuildVoice,
                parent: parentId ?? undefined,
                userLimit: 8,
                reason: `Salon vocal auto pour raid #${raid.id}`,
            }).catch(() => null);

            if (voice) {
                await prisma.raid.update({
                    where: { id: raid.id },
                    data: { voiceChannelId: String(voice.id) }
                }).catch(() => {});
            }
        } else {
            // Permissions insuffisantes → warning dans le salon de logs, mais on continue sans vocal
            const logCh = await getLogsChannel(guild, raid.guildId);
            if (logCh) {
                const catName = base?.parent ? `sur la catégorie **${base.parent.name}**` : "(au niveau serveur)";
                await logCh.send(
                    `⚠️ Impossible de créer le salon vocal pour le raid #${raid.id} : permission **Gérer les salons** manquante ${catName}.`
                ).catch(() => {});
            }
        }
    } catch (e) {
        // on ne bloque pas le lancement si la création échoue
        console.error("[raid_start] voice create failed", e);
    }

    const when = formatInTimeZone(raid.startAt, tz, "dd/MM HH:mm");
    const content = `${mentions(raid, true)}
⏰ **Rappel** : raid **${labelZone(raid.zone)}** dans **15 minutes** (${when} ${tz}). Préparez vos builds !`
        + (voice
                ? ` Le salon vocal est disponible ici : <#${voice.id}>`
                : ` 🎙️ Le bot n’a pas pu créer de salon vocal — utilisez un vocal existant.`
        );

    await sendInRaidThread(guild, raid, { content });
    await prisma.raid.update({ where: { id: raid.id }, data: { reminder15Sent: true } });
}

export async function sendRaidStart(client, raidId) {
    const ctx = await getRaidCtx(raidId);
    if (!ctx) return;
    const { raid, guild, tz } = ctx;

    if (raid.status === "CANCELLED") return;

    // Passe LIVE si encore PLANNED
    if (raid.status === "PLANNED") {
        await prisma.raid.update({ where: { id: raid.id }, data: { status: "LIVE" } });
    }

    let voice = guild.channels.cache.find(c => c.id === raid.voiceChannelId)

    // ===== Message de lancement (toujours envoyé) =====
    const when = formatInTimeZone(raid.startAt, tz, "dd/MM HH:mm");
    const pings = mentions(raid, true);
    const lines = [
        `${pings}`,
        `🚀 **C'est parti !** Raid **${labelZone(raid.zone)}** lancé (${when} ${tz}).`,
        voice ? `🎙️ Salon vocal : <#${voice.id}>` : `🎙️ Le bot n’a pas pu créer de salon vocal — utilisez un vocal existant.`,
    ];
    await sendInRaidThread(guild, raid, { content: lines.join("\n") });

    // ===== Attribution de points (indempotente) =====
    // Règle : On crédite si le joueur est en vocal **Dans le vocal du raid si créer**
    // Sinon s'il est dans **n'importe quel vocal** du serveur au moment du lancement
    try {
        //Empêche le double-crédit si le job relance
        const fresh = await prisma.raid.findUnique({ where: { id: raid.id }, select: { startPointsGranted: true} });
        if(!fresh?.startPointsGranted){

            // Règle : uniquement si le vocal du raid existe
            if (!voice) {
                const logCh = await getLogsChannel(guild, raid.guildId);
                if (logCh) {
                    await logCh.send(
                        `⚠️ Points de présence non attribués pour le raid #${raid.id} : ` +
                        `aucun salon vocal du raid n’a été créé / trouvé. Vérifiez les permissions du bot ou de la catégorie.`
                    ).catch(() => {});
                }
                return; // on ne crédite pas sans vocal du raid
            }

            // 1) Déterminer les membres présents dans CE vocal
            const presentUserIds = new Set();
            const vch = await guild.channels.fetch(voice.id).catch(() => null);
            if (vch && vch.type === ChannelType.GuildVoice) {
                vch.members.forEach(m => presentUserIds.add(m.id));
            }

            // 2) Participants éligibles (CONFIRMED / LATE)
            const eligible = ctx.raid.participants.filter(p => p.status === "CONFIRMED" || p.status === "LATE");

            // 3) Transaction : Incrément des points pour ceux en vocal, puis flag
            await prisma.$transaction(async (tx) => {
                for (const p of eligible) {
                    if(!presentUserIds.has(p.userId)) continue;
                    await tx.playerPoints.upsert({
                        where: { guildId_userId: { guildId: raid.guildId, userId: p.userId } },
                        update: { points: { increment: POINTS_ON_TIME } },
                        create: { guildId: raid.guildId, userId: p.userId, points: POINTS_ON_TIME }
                    });
                }
                await tx.raid.update({
                    where: { id: raid.id },
                    data: { startPointsGranted: true }
                });
            });

            // Log recap
            const awarded = eligible.filter(p => presentUserIds.has(p.userId)).map(p => `<@${p.userId}>`);
            const logCh = await getLogsChannel(guild, raid.guildId);
            if (logCh) {
                await logCh.send(
                    `✅ Points de présence (start) attribués pour le raid #${raid.id} (${labelZone(raid.zone)}): ` +
                    (awarded.length ? awarded.join(", ") : "_personne_") + ` • **+${POINTS_ON_TIME}**`
                ).catch(() => {});
            }
        }
    } catch (e) {
        console.error("[raid_start] award points failed", e);
    }
}

export async function cleanupRaidVoice(client, guildId, voiceChannelId) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    const ch = await guild.channels.fetch(voiceChannelId).catch(() => null);
    if (!ch) return;
    // Ne supprime pas si des gens sont encore dedans
    if (ch.members?.size > 0) return;
    await ch.delete("Nettoyage automatique raid").catch(() => {});
}

// export async function cleanupRaidArtifacts(client, raidId) {
//     const raid = await prisma.raid.findUnique({
//         where: { id: raidId },
//         select: { id: true, guildId: true, postChannelId: true, postMessageId: true, voiceChannelId: true }
//     });
//     if (!raid) return;
//
//     const guild = await client.guilds.fetch(raid.guildId).catch(() => null);
//     if (!guild) return;
//
//     // 1) Supprimer le vocal (s’il existe)
//     if (raid.voiceChannelId) {
//         const v = await guild.channels.fetch(raid.voiceChannelId).catch(() => null);
//         if (v && v.type === ChannelType.GuildVoice) {
//             if (v.members?.size > 0) {
//                 // des gens dedans → on replanifie +1h
//                 await prisma.job.create({
//                     data: {
//                         kind: "raid_cleanup_7d",
//                         dueAt: new Date(Date.now() + 60 * 60 * 1000),
//                         payload: { raidId: raid.id }
//                     }
//                 }).catch(() => {});
//                 // on ne supprime pas tout de suite les autres artefacts pour garder cohérence
//                 return;
//             }
//             await v.delete("Nettoyage automatique raid (J+7)").catch(() => {});
//         }
//     }
//
//     // 2) Supprimer le post forum ou le message
//     if (raid.postChannelId && raid.postMessageId) {
//         const ch = await guild.channels.fetch(raid.postChannelId).catch(() => null);
//         if (ch) {
//             if (ch.type === ChannelType.GuildForum) {
//                 // postMessageId = thread.id
//                 const thread = await ch.threads.fetch(raid.postMessageId).catch(() => null);
//                 if (thread) {
//                     await thread.delete("Nettoyage automatique raid (J+7)").catch(() => {});
//                 }
//             } else {
//                 // salon texte → supprime le thread rattaché si présent puis le message
//                 const msg = await ch.messages.fetch(raid.postMessageId).catch(() => null);
//                 if (msg) {
//                     if (msg.hasThread) {
//                         await msg.thread.delete("Nettoyage automatique raid (J+7)").catch(() => {});
//                     }
//                     await msg.delete().catch(() => {});
//                 }
//             }
//         }
//     }
//
//     // 3) (Option) marquer en BDD que les artefacts sont nettoyés (si tu veux un flag)
//     // await prisma.raid.update({ where: { id: raid.id }, data: { archivedAt: new Date() } }).catch(() => {});
// }