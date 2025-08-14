import { prisma } from "../lib/db.js";


async function safeDeleteRaidJobs(raidIdStr) {
    const olds = await prisma.job.findMany({
        where: { kind: { in: ["raid_reminder_15", "raid_start"] } },
        select: { id: true, payload: true },
        take: 200 // sécurité
    });
    const toDelete = olds.filter(j => j.payload?.raidId === raidIdStr).map(j => j.id);
    if (toDelete.length) {
        await prisma.job.deleteMany({ where: { id: { in: toDelete } } });
    }
}

export async function enqueueRaidJobs(raid) {
    const raidIdStr = String(raid.id); // stocker en string (JSON ne supporte pas BigInt)

    // 1) supprimer les anciens jobs pour ce raid (safe, sans JSON path SQL)
    await safeDeleteRaidJobs(raidIdStr).catch(() => {});

    // 2) créer les jobs
    const start = raid.startAt;
    const remindAt = new Date(start.getTime() - 15 * 60 * 1000);

    await prisma.job.createMany({
        data: [
            { kind: "raid_reminder_15", dueAt: remindAt, payload: { raidId: raidIdStr } },
            { kind: "raid_start",       dueAt: start,    payload: { raidId: raidIdStr } },
        ]
    });
}