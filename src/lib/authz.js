export async function canManageRaids(interaction, prisma) {
    // Admin natif ?
    if (interaction.member?.permissions?.has?.("Administrator")) return true;

    // Rôle configuré ?
    const cfg = await prisma.guildRoles.findUnique({
        where: { guildId: interaction.guildId },
        select: { raidManagerRoleId: true }
    });
    const roleId = cfg?.raidManagerRoleId;
    if (!roleId) return false;

    // Le membre possède-t-il ce rôle ?
    return interaction.member?.roles?.cache?.has(roleId) === true;
}