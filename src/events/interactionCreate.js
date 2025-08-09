import { shouldCooldown } from "../lib/cooldowns.js";

export const name = "interactionCreate";

export async function execute(client, interaction) {
    if (!interaction.isChatInputCommand()) return;
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return interaction.reply({ content: "Commande inconnue.", ephemeral: true });

    const wait = shouldCooldown(interaction.user.id, cmd.data.name, cmd.cooldown ?? 2000);
    if (wait > 0) return interaction.reply({ content: `Patiente ${Math.ceil(wait/1000)}s.`, ephemeral: true });

    try {
        await cmd.execute(interaction, client);
    } catch (err) {
        client.log.error({ err, cmd: cmd.data.name }, "Command error");
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: "Erreur interne.", ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: "Erreur interne.", ephemeral: true }).catch(() => {});
        }
    }
}
