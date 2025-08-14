import {AttachmentBuilder, ChannelType, PermissionFlagsBits} from "discord.js";
import { prisma } from "../lib/db.js";

export async function onSubmit(interaction) {
    const [_, __, guildId, userId] = interaction.customId.split(":");
    if (guildId !== interaction.guildId || userId !== interaction.user.id) {
        return interaction.reply({ content: "❌ Cette modal n'est pas pour toi.", ephemeral: true });
    }

    const name = interaction.fields.getTextInputValue("name")?.trim();
    const details = (interaction.fields.getTextInputValue("details") ?? "").trim();
    if (!name) return interaction.reply({ content: "❌ Nom requis.", ephemeral: true });

    // Récup draft (rôle + images)
    const draft = await prisma.buildDraft.findFirst({ where: { guildId, userId } });
    if (!draft) return interaction.reply({ content: "❌ Draft introuvable. Relance la commande.", ephemeral: true });

    // Anti-dup
    const dup = await prisma.playerBuild.findFirst({ where: { guildId, userId, name } });
    if (dup) return interaction.reply({ content: `❌ Tu as déjà un build nommé **${name}**.`, ephemeral: true });

    // Création en BDD + images
    const build = await prisma.$transaction(async (tx) => {
        const created = await tx.playerBuild.create({
            data: { guildId, userId, role: draft.role, name, details: details || null }
        });

        const imgs = Array.isArray(draft.images) ? draft.images : [];
        if (imgs.length) {
            await tx.playerBuildImage.createMany({
                data: imgs.map((img, i) => ({
                    buildId: created.id,
                    url: String(img.url),
                    filename: (img.filename ?? `image-${i+1}`).slice(0, 128),
                    mimeType: (img.mimeType ?? "image/unknown").slice(0, 64),
                    size: Number(img.size ?? 0),
                    sortOrder: Number(img.sortOrder ?? i),
                }))
            });
        }
        await tx.buildDraft.delete({ where: { id: draft.id } });
        return created;
    });

// ======= Publication dans le salon de builds (config) =======
    const target = await prisma.guildChannels.findUnique({
        where: { guildId },
        select: { buildChannelId: true, logChannelId: true }
    });

    const publishChannelId = target?.buildChannelId ?? interaction.channelId;
    const guild = interaction.guild;

    const channel = await guild.channels.fetch(publishChannelId).catch(() => null);
    if (!channel) {
        await logWarn(guild, target?.logChannelId, `⚠️ Impossible de publier le build **${name}** : salon configuré introuvable (<#${publishChannelId}>).`);
        return interaction.reply({ content: `✅ Build **${build.name}** créé, mais le salon de publication est introuvable.`, ephemeral: true });
    }

// Permissions minimales
    const me = guild.members.me;
    const canSend = channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages);
    const canAttach = channel.permissionsFor(me)?.has(PermissionFlagsBits.AttachFiles);
    if (!canSend) {
        await logWarn(guild, target?.logChannelId, `⚠️ Impossible de publier le build **${name}** : permission **Envoyer des messages** manquante dans <#${channel.id}>.`);
        return interaction.reply({ content: `✅ Build **${build.name}** créé, mais je ne peux pas publier dans <#${channel.id}>.`, ephemeral: true });
    }

    // Récup images
    const images = await prisma.playerBuildImage.findMany({
        where: { buildId: build.id },
        orderBy: { sortOrder: "asc" },
        take: 10 // limite raisonnable
    });

    // Contenu (markdown autorisé)
    const author = interaction.member?.displayName ?? interaction.user.username;
    const header = `**${author} — Build ${build.role} — ${build.name}**`;
    const body = build.details && build.details.trim().length ? build.details : "_(pas de description)_";
    const content = `${header}\n\n${body}`;

    // Préparer les fichiers (si perms)
    const files = (canAttach && images.length)
        ? images.map((img, i) => new AttachmentBuilder(img.url).setName((img.filename || `image-${i+1}`).slice(0, 120)))
        : undefined;

    try {
        if (channel.type === ChannelType.GuildForum) {
            // Forum → créer un post avec titre + message initial (texte + fichiers)
            const canThread = channel.permissionsFor(me)?.has(PermissionFlagsBits.CreatePublicThreads);
            if (!canThread) {
                await logWarn(guild, target?.logChannelId, `⚠️ Pas la permission **Créer des discussions** dans <#${channel.id}>. Publication en message simple à la place.`);
                await channel.send({ content, files });
            } else {
                await channel.threads.create({
                    name: `${author} - Build ${build.role} - ${build.name}`,
                    message: { content, files }
                });
            }
        } else {
            // Salon texte → simple message (texte + fichiers)
            await channel.send({ content, files });
        }
    } catch (e) {
        console.error("[build_create] publish failed", e);
        await logWarn(guild, target?.logChannelId, `⚠️ Erreur lors de la publication du build **${build.name}** dans <#${channel.id}>.`);
    }

    return interaction.reply({ content: `✅ Build **${build.name}** créé et publié dans <#${channel.id}>.`, ephemeral: true });
}

// ===== Utils =====
function roleEmoji(role) {
    switch (role) {
        case "DPS":  return "⚔️";
        case "HEAL": return "💉";
        case "TANK": return "🛡️";
        default:     return "🧱";
    }
}

async function logWarn(guild, logChannelId, msg) {
    if (!logChannelId) return;
    const ch = await guild.channels.fetch(logChannelId).catch(() => null);
    if (!ch) return;
    await ch.send(msg).catch(() => {});
}