import { Hono } from "hono";
import { and, eq, lt, gt, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { businesses, services, staff as staffTable, clients, appointments, } from "../db/schema.js";
import { getAvailability } from "./availability.js";
import { resolveClientLocale } from "../i18n/detectLocale.js";
import { t } from "../i18n/strings.js";
import { dispatchNotification, scheduleAppointmentReminders, } from "./notifications.js";
import { redis, invalidateAvailability } from "../db/redis.js";
import { buildTelegramConnectLink } from "./telegram/telegram.service.js";
import { joinWaitlist, claimInvite, holdRedisKey } from "./waitlist/waitlist.service.js";
export const publicRoutes = new Hono();
function businessLocalDate(date, timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}
function isValidIanaTimezone(timezone) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
        return true;
    }
    catch {
        return false;
    }
}
publicRoutes.get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.slug, slug));
    if (!business)
        return c.json({ error: "not_found" }, 404);
    const locale = resolveClientLocale({
        acceptLanguageHeader: c.req.header("accept-language"),
    });
    const svcRows = await db
        .select()
        .from(services)
        .where(eq(services.businessId, business.id));
    const staffRows = await db
        .select()
        .from(staffTable)
        .where(eq(staffTable.businessId, business.id));
    return c.json({
        locale,
        business: {
            id: business.id,
            name: business.name,
            slug: business.slug,
            timezone: business.timezone,
        },
        services: svcRows.map((s) => ({
            id: s.id,
            name: s.name[locale] ?? s.name.en,
            durationMin: s.durationMin,
            priceCents: s.priceCents,
            currency: s.currency,
            photoUrl: s.photoUrl,
        })),
        staff: staffRows.map((s) => ({
            id: s.id,
            name: s.name,
            serviceIds: s.serviceIds,
            colorHex: s.colorHex,
            photoUrl: s.photoUrl,
        })),
        ui: {
            chooseService: t(locale, "chooseService"),
            chooseStaff: t(locale, "chooseStaff"),
            chooseDate: t(locale, "chooseDate"),
            chooseTime: t(locale, "chooseTime"),
            yourName: t(locale, "yourName"),
            yourPhone: t(locale, "yourPhone"),
            confirmBooking: t(locale, "confirmBooking"),
            bookingConfirmedTitle: t(locale, "bookingConfirmedTitle"),
            bookingConfirmedBody: t(locale, "bookingConfirmedBody"),
            noSlotsToday: t(locale, "noSlotsToday"),
            anyStaff: t(locale, "anyStaff"),
            minutes: t(locale, "minutes"),
        },
    });
});
publicRoutes.get("/:slug/availability", async (c) => {
    const slug = c.req.param("slug");
    const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.slug, slug));
    if (!business)
        return c.json({ error: "not_found" }, 404);
    const serviceId = c.req.query("serviceId");
    const date = c.req.query("date");
    const staffId = c.req.query("staffId") || undefined;
    if (!serviceId || !date)
        return c.json({ error: "serviceId and date are required" }, 400);
    const slots = await getAvailability({
        businessId: business.id,
        serviceId,
        date,
        staffId,
    });
    // Фильтруем слоты, которые сейчас в HOLD под waitlist-приглашение.
    // Пока клиент не подтвердил или не истёк холд — слот скрыт из публичной выдачи,
    // чтобы его не мог занять кто-то другой через обычное бронирование.
    const availableSlots = await Promise.all(slots.map(async (slot) => {
        const key = holdRedisKey(business.id, slot.staffId ?? staffId ?? null, new Date(slot.startAt), new Date(slot.endAt));
        const isOnHold = await redis.exists(key);
        return isOnHold ? null : slot;
    }));
    return c.json({
        slots: availableSlots.filter(Boolean),
    });
});
publicRoutes.post("/:slug/book", async (c) => {
    const slug = c.req.param("slug");
    const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.slug, slug));
    if (!business)
        return c.json({ error: "not_found" }, 404);
    const body = await c.req.json();
    const [service] = await db
        .select()
        .from(services)
        .where(eq(services.id, body.serviceId));
    if (!service || service.businessId !== business.id)
        return c.json({ error: "invalid_service" }, 400);
    const [staffMemberForBooking] = await db
        .select()
        .from(staffTable)
        .where(and(eq(staffTable.id, body.staffId), eq(staffTable.businessId, business.id)));
    if (!staffMemberForBooking || !staffMemberForBooking.serviceIds.includes(service.id)) {
        return c.json({ error: "invalid_staff" }, 400);
    }
    const startAt = new Date(body.startAt);
    if (Number.isNaN(startAt.getTime()))
        return c.json({ error: "invalid_start_at" }, 400);
    const endAt = new Date(startAt.getTime() + service.durationMin * 60_000);
    // Public booking must use a slot that Timio actually exposed for this
    // business/service/staff. The overlap check below still remains necessary
    // because availability is only a snapshot and two clients can race.
    if (!isValidIanaTimezone(business.timezone)) {
        return c.json({ error: "business_timezone_invalid" }, 500);
    }
    const localDate = businessLocalDate(startAt, business.timezone);
    const availableSlots = await getAvailability({
        businessId: business.id,
        serviceId: service.id,
        staffId: body.staffId,
        date: localDate,
    });
    const requestedSlot = availableSlots.some((slot) => new Date(slot.startAt).getTime() === startAt.getTime() &&
        new Date(slot.endAt).getTime() === endAt.getTime() &&
        slot.staffId === body.staffId);
    if (!requestedSlot) {
        return c.json({ error: "invalid_slot", message: "Selected time is no longer available" }, 409);
    }
    let [client] = await db
        .select()
        .from(clients)
        .where(and(eq(clients.businessId, business.id), eq(clients.phone, body.clientPhone)));
    const locale = resolveClientLocale({
        savedLocale: client?.detectedLocale,
        telegramLanguageCode: body.telegramLanguageCode,
        acceptLanguageHeader: c.req.header("accept-language"),
    });
    if (!client) {
        const [created] = await db
            .insert(clients)
            .values({
            businessId: business.id,
            name: body.clientName,
            phone: body.clientPhone,
            detectedLocale: locale,
        })
            .returning();
        client = created;
    }
    const overlap = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.businessId, business.id), eq(appointments.staffId, body.staffId), ne(appointments.status, "cancelled"), lt(appointments.startAt, endAt), gt(appointments.endAt, startAt))).limit(1);
    if (overlap.length)
        return c.json({ error: "slot_taken", message: "This time was just booked by another client" }, 409);
    const [appointment] = await db
        .insert(appointments)
        .values({
        businessId: business.id,
        clientId: client.id,
        staffId: body.staffId,
        serviceId: body.serviceId,
        startAt,
        endAt,
        status: "booked",
        source: "public_widget",
    })
        .returning();
    await invalidateAvailability(business.id, businessLocalDate(startAt, business.timezone));
    const [staffMember] = await db
        .select()
        .from(staffTable)
        .where(eq(staffTable.id, body.staffId));
    const notification = await dispatchNotification({
        businessId: business.id,
        clientId: client.id,
        templateType: "booking_confirmed",
        channelPriority: business.channelPriority,
        telegramBotToken: business.telegramBotToken,
        vars: {
            clientName: client.name,
            time: startAt.toLocaleString(locale, {
                dateStyle: "medium",
                timeStyle: "short",
            }),
            staffName: staffMember?.name ?? "",
        },
    });
    await scheduleAppointmentReminders(appointment.id, startAt.toISOString());
    const telegramConnectUrl = business.telegramBotUsername && !client.telegramChatId
        ? buildTelegramConnectLink(business.telegramBotUsername, client.id)
        : null;
    return c.json({ appointment, clientLocale: locale, notification, telegramConnectUrl });
});
// ----------------------------------------------------------------
// Waitlist: публичные эндпоинты
// ----------------------------------------------------------------
// POST /public/waitlist — записаться в очередь ожидания
publicRoutes.post("/waitlist", async (c) => {
    const body = await c.req.json();
    if (!body.businessId ||
        !body.serviceId ||
        !body.startAt ||
        !body.endAt ||
        !body.client?.name) {
        return c.json({ error: "invalid_input" }, 400);
    }
    const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, body.businessId));
    if (!business)
        return c.json({ error: "not_found" }, 404);
    const [service] = await db
        .select()
        .from(services)
        .where(and(eq(services.id, body.serviceId), eq(services.businessId, business.id)));
    if (!service)
        return c.json({ error: "invalid_service" }, 400);
    const startAt = new Date(body.startAt);
    const endAt = new Date(body.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
        return c.json({ error: "invalid_time_range" }, 400);
    }
    if (endAt.getTime() - startAt.getTime() !== service.durationMin * 60_000) {
        return c.json({ error: "invalid_duration" }, 400);
    }
    if (body.staffId) {
        const [row] = await db
            .select()
            .from(staffTable)
            .where(and(eq(staffTable.id, body.staffId), eq(staffTable.businessId, business.id)));
        if (!row || !row.serviceIds.includes(service.id)) {
            return c.json({ error: "invalid_staff" }, 400);
        }
    }
    // A client id supplied by the public widget is trusted only after checking
    // that it belongs to the same tenant. Otherwise a crafted request could
    // attach another business's client to this business's waitlist.
    if (body.client.id) {
        const [ownedClient] = await db
            .select({ id: clients.id })
            .from(clients)
            .where(and(eq(clients.id, body.client.id), eq(clients.businessId, business.id)));
        if (!ownedClient)
            return c.json({ error: "invalid_client" }, 400);
    }
    // Ищем существующего клиента по любому из контактов, иначе создаём нового
    let clientId = body.client.id ?? null;
    if (!clientId) {
        let existing = null;
        if (body.client.telegramChatId) {
            const [row] = await db
                .select()
                .from(clients)
                .where(and(eq(clients.businessId, body.businessId), eq(clients.telegramChatId, body.client.telegramChatId)));
            existing = row ?? null;
        }
        if (!existing && body.client.email) {
            const [row] = await db
                .select()
                .from(clients)
                .where(and(eq(clients.businessId, body.businessId), eq(clients.email, body.client.email)));
            existing = row ?? null;
        }
        if (!existing && body.client.phone) {
            const [row] = await db
                .select()
                .from(clients)
                .where(and(eq(clients.businessId, body.businessId), eq(clients.phone, body.client.phone)));
            existing = row ?? null;
        }
        if (existing) {
            clientId = existing.id;
        }
        else {
            const [created] = await db
                .insert(clients)
                .values({
                businessId: body.businessId,
                name: body.client.name,
                phone: body.client.phone ?? null,
                email: body.client.email ?? null,
                telegramChatId: body.client.telegramChatId ?? null,
                detectedLocale: body.client.locale ?? "ru",
                preferredChannel: null,
            })
                .returning();
            clientId = created.id;
        }
    }
    const entry = await joinWaitlist({
        businessId: body.businessId,
        clientId: clientId,
        serviceId: body.serviceId,
        staffId: body.staffId ?? null,
        startAt,
        endAt,
        priority: body.priority,
    });
    return c.json({ entryId: entry.id });
});
// GET /public/waitlist/claim/:token — переход по ссылке из уведомления
// Всегда редиректит на фронт — статус в query params
publicRoutes.get("/waitlist/claim/:token", async (c) => {
    const token = c.req.param("token");
    const result = await claimInvite(token);
    if (result.ok) {
        const url = `${process.env.PUBLIC_BASE_URL}/waitlist/claim-result?status=ok&appointmentId=${encodeURIComponent(result.appointmentId)}`;
        return c.redirect(url, 302);
    }
    else {
        const url = `${process.env.PUBLIC_BASE_URL}/waitlist/claim-result?status=error&reason=${encodeURIComponent(result.reason)}`;
        return c.redirect(url, 302);
    }
});
