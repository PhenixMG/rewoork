import { prisma } from "../lib/db.js";
import {cleanupRaidVoice, sendRaidReminder15, sendRaidStart} from "./workers_raid.js";

export function startJobsWorker(client) {
    const instanceId = process.env.INSTANCE_ID || String(process.pid);

    const tick = async () => {
        try {
            const now = new Date();

            // Libère les locks trop vieux (process crashé en plein milieu)
            await prisma.job.updateMany({
                where: { lockedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) }, doneAt: null },
                data: { lockedAt: null, lockedBy: null }
            });

            // Prendre un petit batch prêt à exécuter
            const jobs = await prisma.job.findMany({
                where: { doneAt: null, dueAt: { lte: now }, lockedAt: null },
                orderBy: { dueAt: "asc" },
                take: 10
            });

            await prisma.raid.updateMany({
                where: {
                    status: "PLANNED",
                    rosterLocked: false,
                    startAt: { lte: new Date(Date.now() + 5 * 60 * 1000) }
                },
                data: { rosterLocked: true }
            });

            for (const job of jobs) {
                // Lock optimiste
                const locked = await prisma.job.updateMany({
                    where: { id: job.id, lockedAt: null },
                    data: { lockedAt: new Date(), lockedBy: instanceId }
                });
                if (locked.count === 0) continue;

                try {
                    if (job.kind === "raid_reminder_15") {
                        await sendRaidReminder15(client, BigInt(job.payload.raidId)); // ✅ re-cast
                    } else if (job.kind === "raid_start") {
                        await sendRaidStart(client, BigInt(job.payload.raidId));      // ✅ re-cast
                    } else if (job.kind === "raid_voice_cleanup") {
                        await cleanupRaidVoice(client, job.payload.guildId, job.payload.voiceChannelId);
                    }
                    // } else if (job.kind === "raid_cleanup_7d") {
                    //     await cleanupRaidArtifacts(client, BigInt(job.payload.raidId));
                    // }

                    await prisma.job.update({ where: { id: job.id }, data: { doneAt: new Date() } });
                } catch (e) {
                    const attempts = job.attempts + 1;
                    const delaySec = Math.min(300, attempts * 60); // 60s, 120s, 180s… capped 5min
                    await prisma.job.update({
                        where: { id: job.id },
                        data: {
                            attempts,
                            lastError: String(e?.message || e),
                            dueAt: new Date(Date.now() + delaySec * 1000),
                            lockedAt: null,
                            lockedBy: null
                        }
                    });
                }
            }
        } catch (e) {
            // log silencieux
            console.error("[jobs] tick error", e);
        } finally {
            setTimeout(tick, 20_000); // toutes les 20s
        }
    };

    // garde le client accessible si besoin
    globalThis.client = client;
    tick();
}