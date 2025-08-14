import {
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, AttachmentBuilder, EmbedBuilder
} from "discord.js";
import { prisma } from "../../lib/db.js";

const ROLE_CHOICES = [
    { name: "DPS",  value: "DPS" },
    { name: "Heal", value: "HEAL" },
    { name: "Tank", value: "TANK" },
];

// On propose jusqu’à 5 images (attachments)
export const data = new SlashCommandBuilder()
    .setName("build")
    .setDescription("Gestion des builds TD2")
    .addSubcommand(sc => sc
        .setName("create")
        .setDescription("Créer un build (images + description via modal)")
        .addStringOption(o => o.setName("role").setDescription("Rôle du build").setRequired(true).addChoices(...ROLE_CHOICES))
        .addAttachmentOption(o => o.setName("image1").setDescription("Image 1"))
        .addAttachmentOption(o => o.setName("image2").setDescription("Image 2"))
        .addAttachmentOption(o => o.setName("image3").setDescription("Image 3"))
        .addAttachmentOption(o => o.setName("image4").setDescription("Image 4"))
        .addAttachmentOption(o => o.setName("image5").setDescription("Image 5"))
        .addAttachmentOption(o => o.setName("image6").setDescription("Image 6"))
        .addAttachmentOption(o => o.setName("image7").setDescription("Image 7"))
        .addAttachmentOption(o => o.setName("image8").setDescription("Image 8"))
        .addAttachmentOption(o => o.setName("image9").setDescription("Image 9"))
    );

export const cooldown = 2000;

export async function execute(interaction) {
    if (!interaction.isChatInputCommand()) return;
    const sub = interaction.options.getSubcommand();
    if (sub !== "create") {
        return interaction.reply({ content: "Sous-commande inconnue.", ephemeral: true });
    }

    const guildId = interaction.guildId;
    const userId  = interaction.user.id;
    const role    = interaction.options.getString("role", true);

    // 1) Collecter les attachments (images only)
    const attachments = [];
    for (let i = 1; i <= 9; i++) {
        const a = interaction.options.getAttachment(`image${i}`);
        if (!a) continue;
        if (!/^image\//i.test(a.contentType || "")) continue; // on ignore les non-images
        attachments.push({
            url: a.url,
            filename: a.name ?? `image${i}`,
            mimeType: a.contentType ?? "image/unknown",
            size: a.size ?? 0,
            sortOrder: attachments.length
        });
    }

    // 2) Créer/écraser un draft (images + rôle)
    await prisma.buildDraft.deleteMany({ where: { guildId, userId } }).catch(() => {});
    await prisma.buildDraft.create({
        data: { guildId, userId, role, images: attachments }
    });

    // 3) Ouvrir la modal pour saisir le nom + description (markdown autorisé)
    const modal = new ModalBuilder()
        .setCustomId(`BUILD:CREATE:${guildId}:${userId}`) // clé de récupération
        .setTitle("Nouveau build TD2");

    const nameInput = new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Nom du build")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setPlaceholder("Ex: DPS Crit Raid");

    const detailsInput = new TextInputBuilder()
        .setCustomId("details")
        .setLabel("Description (Markdown autorisé)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false) // on autorise vide
        .setMaxLength(4000)
        .setPlaceholder("Notes, talents, lien vidéo, etc. **gras**, _italique_, [lien](https://...)");

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(detailsInput),
    );

    await interaction.showModal(modal);
}