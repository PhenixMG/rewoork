import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Pong + latence");

export const cooldown = 2000;

export async function execute(interaction) {
    const sent = await interaction.reply({ content: "Ping...", fetchReply: true });
    const diff = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`Pong! ${diff}ms`);
}
