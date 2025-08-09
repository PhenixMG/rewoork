const buckets = new Map(); // key = `${userId}:${command}`, value = timestamp ms

export function shouldCooldown(userId, command, ms = 3000) {
    const key = `${userId}:${command}`;
    const now = Date.now();
    const last = buckets.get(key) ?? 0;
    if (now - last < ms) return ms - (now - last);
    buckets.set(key, now);
    return 0;
}
