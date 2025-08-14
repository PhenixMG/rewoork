import { shouldCooldown } from "../lib/cooldowns.js";
import {handleRaidButton} from "../commands/td2/raid_buttons.js";
import * as buildModal from "../modals/build_create.js";
import {renderLeaderboard} from "../commands/td2/leaderboard.js";
import {prisma} from "../lib/db.js";

export const name = "interactionCreate";

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Interaction} interaction
 */
export async function execute(client, interaction) {
    // === Boutons (raid) ===
    if (interaction.isButton()) {
        console.log(interaction.customId)
        // Nos boutons raid utilisent ce prefix: TD2:RAID:<id>:<ACTION>[:PAYLOAD]
        if (interaction.customId?.startsWith("TD2:RAID:")) {
            try {
                await handleRaidButton(interaction);
            } catch (err) {
                client.log?.error?.({ err }, "Raid button error");
                // pour un bouton, l'interaction est déjà "deferred" dans handleRaidButton
                await interaction.followUp({ content: "Erreur interne.", ephemeral: true }).catch(() => {});
            }
        }
        if (interaction.customId?.startsWith("LB:")) {
            const parts = interaction.customId.split(":"); // LB:ACTION:...
            const action = parts[1];

            const guildId = interaction.guildId;
            let page, size;

            // Récupère la taille/page selon l’action
            switch (action) {
                case "BEGIN": {
                    const targetGuild = parts[2];
                    size = parseInt(parts[3], 10) || 10;
                    if (targetGuild !== guildId) return interaction.deferUpdate().catch(() => {});
                    page = 1;
                    break;
                }
                case "END": {
                    const targetGuild = parts[2];
                    size = parseInt(parts[3], 10) || 10;
                    if (targetGuild !== guildId) return interaction.deferUpdate().catch(() => {});
                    // calcule la dernière page
                    const total = await prisma.playerPoints.count({ where: { guildId } });
                    page = Math.max(1, Math.ceil(total / size));
                    break;
                }
                case "PREV":
                case "NEXT": {
                    const targetGuild = parts[2];
                    page = Math.max(1, parseInt(parts[3], 10) || 1);
                    size = parseInt(parts[4], 10) || 10;
                    if (targetGuild !== guildId) return interaction.deferUpdate().catch(() => {});
                    break;
                }
                case "SEP":
                default:
                    return interaction.deferUpdate().catch(() => {});
            }

            await interaction.deferUpdate().catch(() => {});
            const { embed, components } = await renderLeaderboard(guildId, page, size, interaction.user.id);
            return interaction.message.edit({ embeds: [embed], components, allowedMentions: { parse: [] } }).catch(() => {});
        }
        return; // on stoppe ici pour les boutons
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId?.startsWith("BUILD:CREATE:")) {
            return buildModal.onSubmit(interaction);
        }
    }

    // === Slash commands ===
    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) {
        return interaction.reply({ content: "Commande inconnue.", ephemeral: true });
    }

    // cooldown uniquement pour les commandes (pas pour les boutons)
    const wait = shouldCooldown(interaction.user.id, cmd.data.name, cmd.cooldown ?? 2000);
    if (wait > 0) {
        return interaction.reply({ content: `Patiente ${Math.ceil(wait/1000)}s.`, ephemeral: true });
    }

    try {
        await cmd.execute(interaction, client);
    } catch (err) {
        client.log?.error?.({ err, cmd: cmd.data?.name }, "Command error");
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: "Erreur interne.", ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: "Erreur interne.", ephemeral: true }).catch(() => {});
        }
    }
}