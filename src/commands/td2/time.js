import { DateTime } from "luxon";

export function zonedTimeToUtc(localStr, tz) {
    // localStr "YYYY-MM-DD HH:mm:ss"
    const dt = DateTime.fromFormat(localStr, "yyyy-LL-dd HH:mm:ss", { zone: tz });
    if (!dt.isValid) return null;
    return dt.toUTC().toJSDate();
}

export function formatInTimeZone(date, tz, fmt) {
    return DateTime.fromJSDate(date).setZone(tz).toFormat(fmt);
}