import {ChannelType} from "discord.js";
import {prisma} from "../../lib/db.js";
import {renderRaidMessage} from "./raid.js";

const MAX_RAID_PLAYERS = 8;

export async function handleRaidButton(interaction) {
    // customId = TD2:RAID:<id>:<action>[:payload]
    const parts = interaction.customId.split(":");
    if (parts[0] !== "TD2" || parts[1] !== "RAID") return;

    const raidId = BigInt(parts[2]);
    const action = parts[3];
    const payload = parts[4];

    await interaction.deferUpdate();

    const raid = await prisma.raid.findUnique({
        where: { id: raidId },
        include: { participants: true }
    });
    if (!raid) return;

    const userId = interaction.user.id;

    // Roster lock: autoriser uniquement REFRESH
    if (raid.rosterLocked && !["REFRESH"].includes(action)) {
        // on réédite juste l’affichage
        await refreshMessage(interaction, raid);
        return;
    }

    // transaction
    await prisma.$transaction(async (tx) => {
        const me = await tx.raidParticipant.findUnique({ where: { raidId_userId: { raidId, userId } } });

        // helpers
        const titularCount = async () => tx.raidParticipant.count({
            where: { raidId, status: { notIn: ["SUBSTITUTE", "ABSENT"] } }
        });

        const promoteFirstSub = async () => {
            const sub = await tx.raidParticipant.findFirst({
                where: { raidId, status: "SUBSTITUTE" },
                orderBy: [{ createdAt: "asc" }]
            });
            if (!sub) return null;

            // calcule prochaine position
            const maxPos = (await tx.raidParticipant.aggregate({
                where: { raidId, position: { not: null } },
                _max: { position: true }
            }))._max.position ?? 0;

            return tx.raidParticipant.update({
                where: {raidId_userId: {raidId, userId: sub.userId}},
                data: {status: "CONFIRMED", position: maxPos + 1, confirmedAt: new Date()}
            });
        };

        if (action === "LEAVE") {
            if (me) {
                const wasTitular = me.status !== "SUBSTITUTE" && me.status !== "ABSENT";
                await tx.raidParticipant.delete({ where: { raidId_userId: { raidId, userId } } });

                if (wasTitular) {
                    // une place se libère → promouvoir
                    const promoted = await promoteFirstSub();
                    if (promoted) queueDm(interaction.client, promoted.userId, raid);
                }
            }
            return;
        }

        if (action === "SUB") {
            const wasTitular = me && (me.status !== "SUBSTITUTE" && me.status !== "ABSENT");
            await tx.raidParticipant.upsert({
                where: { raidId_userId: { raidId, userId } },
                update: { status: "SUBSTITUTE", position: null },
                create: { raidId, userId, role: "DPS", status: "SUBSTITUTE" },
            });
            if (wasTitular) {
                const promoted = await promoteFirstSub();
                if (promoted) queueDm(interaction.client, promoted.userId, raid);
            }
            return;
        }

        if (action === "JOIN") {
            const count = await titularCount();
            if (count >= MAX_RAID_PLAYERS) {
                // plein → suppléant
                await tx.raidParticipant.upsert({
                    where: { raidId_userId: { raidId, userId } },
                    update: { status: "SUBSTITUTE", position: null },
                    create: { raidId, userId, role: "DPS", status: "SUBSTITUTE" },
                });
            } else {
                const maxPos = (await tx.raidParticipant.aggregate({
                    where: { raidId, position: { not: null } },
                    _max: { position: true }
                }))._max.position ?? 0;

                await tx.raidParticipant.upsert({
                    where: { raidId_userId: { raidId, userId } },
                    update: { status: "CONFIRMED", position: maxPos + 1 },
                    create: { raidId, userId, role: "DPS", status: "CONFIRMED", position: maxPos + 1 },
                });
            }
            return;
        }

        if (action === "ROLE") {
            const role = payload; // "DPS" | "HEAL" | "TANK"
            if (!me) {
                // s’il tente de set un rôle sans être inscrit, on l’inscrit si place dispo, sinon SUB
                const count = await titularCount();
                if (count >= MAX_RAID_PLAYERS) {
                    await tx.raidParticipant.create({ data: { raidId, userId, role, status: "SUBSTITUTE" } });
                } else {
                    const maxPos = (await tx.raidParticipant.aggregate({
                        where: { raidId, position: { not: null } }, _max: { position: true }
                    }))._max.position ?? 0;
                    await tx.raidParticipant.create({ data: { raidId, userId, role, status: "CONFIRMED", position: maxPos + 1 } });
                }
            } else {
                await tx.raidParticipant.update({
                    where: { raidId_userId: { raidId, userId } }, data: { role }
                });
            }
            return;
        }

        if (action === "LATE" && me) {
            await tx.raidParticipant.update({ where: { raidId_userId: { raidId, userId } }, data: { status: "LATE" } });
            return;
        }

        if (action === "ABSENT" && me) {
            const wasTitular = me.status !== "SUBSTITUTE" && me.status !== "ABSENT";
            await tx.raidParticipant.update({ where: { raidId_userId: { raidId, userId } }, data: { status: "ABSENT", position: null } });
            if (wasTitular) {
                const promoted = await promoteFirstSub();
                if (promoted) queueDm(interaction.client, promoted.userId, raid);
            }
        }

        // REFRESH ne modifie rien (juste re-render)
    });

    await refreshMessage(interaction, raid)
}

async function refreshMessage(interaction, raid) {
    if (raid.postChannelId && raid.postMessageId) {
        const ch = await interaction.guild.channels.fetch(raid.postChannelId).catch(() => null);
        if (ch) {
            const tz = (await prisma.guild.findUnique({ where: { id: interaction.guildId }, select: { tz: true } }))?.tz || "Europe/Paris";
            const { embed, rows } = await renderRaidMessage({ id: raid.id }, tz);
            if (ch.type === ChannelType.GuildForum) {
                const thread = await ch.threads.fetch(raid.postMessageId).catch(() => null);
                if (thread) await thread.edit({ message: { embeds: [embed], components: rows } }).catch(() => {});
            } else {
                const msg = await ch.messages.fetch(raid.postMessageId).catch(() => null);
                if (msg) await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
            }
        }
    }
}

// DM informatif
function queueDm(client, userId, raid) {
    client.users.fetch(userId).then(u => {
        u.send(`✅ Tu as été **promu titulaire** pour le raid **${labelZone(raid.zone)}** (#${raid.id}).`)
            .catch(() => {});
    }).catch(() => {});
}