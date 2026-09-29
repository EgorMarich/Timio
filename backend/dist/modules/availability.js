import { and, eq, ne, gte, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import { appointments, businesses, services, staff as staffTable } from "../db/schema.js";
import { availabilityCacheKey, getCachedAvailability, setCachedAvailability } from "../db/redis.js";
const STEP_MIN = 15;
function localDateToUtcMidnight(date, timezone) {
    // Convert a business-local calendar date to the corresponding UTC instant
    // without relying on the Node process timezone. This keeps slot generation
    // correct when the API server and business are in different timezones.
    const [year, month, day] = date.split("-").map(Number);
    const guess = new Date(Date.UTC(year, month - 1, day));
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(guess);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
    const offsetMs = asUtc - guess.getTime();
    return new Date(guess.getTime() - offsetMs);
}
function nextLocalDate(date) {
    const [year, month, day] = date.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return next.toISOString().slice(0, 10);
}
function minutesToDate(day, minutes) {
    return new Date(day.getTime() + minutes * 60_000);
}
export async function getAvailability(params) {
    const cacheKey = availabilityCacheKey(params);
    const cached = await getCachedAvailability(cacheKey);
    if (cached)
        return cached;
    const [business] = await db.select().from(businesses).where(eq(businesses.id, params.businessId));
    const [service] = await db.select().from(services).where(eq(services.id, params.serviceId));
    if (!business || !service)
        return [];
    let day;
    try {
        day = localDateToUtcMidnight(params.date, business.timezone);
    }
    catch {
        return [];
    }
    // Weekday must be calculated in the business timezone, not the API server timezone.
    const [year, month, date] = params.date.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
    const dayEnd = localDateToUtcMidnight(nextLocalDate(params.date), business.timezone);
    const candidateStaff = await db
        .select()
        .from(staffTable)
        .where(eq(staffTable.businessId, params.businessId));
    const eligibleStaff = candidateStaff.filter((s) => s.serviceIds.includes(params.serviceId) && (!params.staffId || s.id === params.staffId));
    const existingAppointments = await db
        .select()
        .from(appointments)
        .where(and(eq(appointments.businessId, params.businessId), ne(appointments.status, "cancelled"), gte(appointments.startAt, day), lt(appointments.startAt, dayEnd)));
    const slots = [];
    for (const member of eligibleStaff) {
        const hours = member.workingHours ?? business.workingHours;
        const window = hours?.[weekday];
        if (!window)
            continue;
        for (let m = window.start; m + service.durationMin <= window.end; m += STEP_MIN) {
            const startAt = minutesToDate(day, m);
            const endAt = minutesToDate(day, m + service.durationMin);
            if (startAt.getTime() < Date.now())
                continue;
            const overlaps = existingAppointments.some((a) => a.staffId === member.id &&
                new Date(a.startAt) < endAt &&
                new Date(a.endAt) > startAt);
            if (overlaps)
                continue;
            slots.push({ startAt: startAt.toISOString(), endAt: endAt.toISOString(), staffId: member.id });
        }
    }
    slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
    await setCachedAvailability(cacheKey, slots);
    return slots;
}
