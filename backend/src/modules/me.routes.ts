import { Hono } from "hono";
import { and, eq, desc, lt, gt, ne, gte, isNotNull, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { businesses, businessMembers, services, staff, appointments, clients, messageTemplates, users, subscriptions, campaigns, waitlistEntries, businessNotificationSettings, campaignRecipients, onboardingEvents } from "../db/schema.js";
import { requireAuth } from "./authMiddleware.js";
import { generateUniqueSlug } from "./slug.js";
import { defaultTemplates } from "./defaultTemplates.js";
import { redis, invalidateAllAvailability } from "../db/redis.js";
import { sendTelegramMessage } from "../modules/telegram/telegram.service.js";
import { handleSlotFreed } from './waitlist/waitlist.service.js';
import { joinWaitlist } from './waitlist/waitlist.service.js';
import { generateAiMessage, getAiMessageStatus } from "./aiMessage.service.js";
import { getDailyBusinessIntelligence } from "./dailyBusinessIntelligence.service.js";
import { buildReactivationClients, type ReactivationSegment } from "./retentionEngine.js";
import { getEmptySlotIntelligence } from "./emptySlotIntelligence.service.js";

export const meRoutes = new Hono();
meRoutes.use("*", requireAuth);

// Проверяет, что текущий пользователь имеет доступ к бизнесу, и возвращает его роль.
async function assertMember(userId: string, businessId: string) {
  const [membership] = await db
    .select()
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.userId, userId)));
  return membership ?? null;
}

async function recordOnboardingEvent(
  businessId: string,
  userId: string,
  event: "business_created" | "service_created" | "staff_created" | "schedule_configured" | "client_created" | "appointment_created" | "activation_completed",
  metadata?: Record<string, unknown>,
) {
  await db.insert(onboardingEvents).values({ businessId, userId, event, metadata });
}

// GET /me/businesses - все компании, к которым у пользователя есть доступ
meRoutes.get("/businesses", async (c) => {
  const userId = c.get("userId") as string;
  const memberships = await db.select().from(businessMembers).where(eq(businessMembers.userId, userId));
  const businessIds = memberships.map((m) => m.businessId);
  if (businessIds.length === 0) return c.json({ businesses: [] });

  const rows = await Promise.all(
    businessIds.map(async (id) => {
      const [b] = await db.select().from(businesses).where(eq(businesses.id, id));
      const membership = memberships.find((m) => m.businessId === id);
      return { ...b, myRole: membership?.role };
    })
  );
  return c.json({ businesses: rows });
});

// ---------- Onboarding & Activation ----------

meRoutes.get("/businesses/:id/onboarding", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const [business] = await db.select({ id: businesses.id, name: businesses.name, timezone: businesses.timezone, workingHours: businesses.workingHours })
    .from(businesses).where(eq(businesses.id, businessId));
  if (!business) return c.json({ error: "not_found" }, 404);

  const [serviceRows, staffRows, clientRows, appointmentRows, events] = await Promise.all([
    db.select({ id: services.id }).from(services).where(eq(services.businessId, businessId)),
    db.select({ id: staff.id }).from(staff).where(eq(staff.businessId, businessId)),
    db.select({ id: clients.id }).from(clients).where(eq(clients.businessId, businessId)),
    db.select({ id: appointments.id }).from(appointments).where(eq(appointments.businessId, businessId)),
    db.select({ event: onboardingEvents.event, createdAt: onboardingEvents.createdAt }).from(onboardingEvents).where(eq(onboardingEvents.businessId, businessId)).orderBy(desc(onboardingEvents.createdAt)).limit(100),
  ]);

  const steps = {
    business: Boolean(business.name && business.timezone),
    services: serviceRows.length >= 3,
    staff: staffRows.length >= 1,
    schedule: Object.values(business.workingHours ?? {}).some(Boolean),
    client: clientRows.length >= 1,
    appointment: appointmentRows.length >= 1,
  };
  const activated = Object.values(steps).every(Boolean);
  if (activated && !events.some((e) => e.event === "activation_completed")) {
    await recordOnboardingEvent(businessId, userId, "activation_completed");
  }

  const completed = Object.entries(steps).filter(([, value]) => value).map(([key]) => key);
  const nextStep = (Object.entries(steps).find(([, value]) => !value)?.[0] ?? "done") as keyof typeof steps | "done";

  return c.json({
    activated,
    completed,
    nextStep,
    progressPercent: Math.round((completed.length / Object.keys(steps).length) * 100),
    counts: { services: serviceRows.length, staff: staffRows.length, clients: clientRows.length, appointments: appointmentRows.length },
    steps,
    recentEvents: events.slice(0, 20),
  });
});

meRoutes.post("/businesses/:id/onboarding/events", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{ event: string; metadata?: Record<string, unknown> }>();
  const allowed = ["business_created", "service_created", "staff_created", "schedule_configured", "client_created", "appointment_created", "activation_completed"] as const;
  if (!allowed.includes(body.event as typeof allowed[number])) return c.json({ error: "invalid_event" }, 400);
  await recordOnboardingEvent(businessId, userId, body.event as typeof allowed[number], body.metadata);
  return c.json({ ok: true });
});

// ---------- Управление записью из панели ----------
// Создание и перенос должны проверять пересечения на сервере. UI-проверка сама
// по себе не защищает от двух администраторов/клиентов, которые бронируют слот
// одновременно.
meRoutes.post("/businesses/:id/appointments", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ clientId: string; staffId: string; serviceId: string; startAt: string; status?: string }>();
  if (!body.clientId || !body.staffId || !body.serviceId || !body.startAt) {
    return c.json({ error: "invalid_input", message: "clientId, staffId, serviceId and startAt are required" }, 400);
  }

  const [client] = await db.select().from(clients).where(and(eq(clients.id, body.clientId), eq(clients.businessId, businessId)));
  const [service] = await db.select().from(services).where(and(eq(services.id, body.serviceId), eq(services.businessId, businessId)));
  const [staffMember] = await db.select().from(staff).where(and(eq(staff.id, body.staffId), eq(staff.businessId, businessId)));
  if (!client || !service || !staffMember) return c.json({ error: "invalid_reference" }, 400);
  if (!staffMember.serviceIds.includes(service.id)) return c.json({ error: "staff_service_mismatch" }, 400);

  const startAt = new Date(body.startAt);
  if (Number.isNaN(startAt.getTime())) return c.json({ error: "invalid_start_at" }, 400);
  const endAt = new Date(startAt.getTime() + service.durationMin * 60_000);

  const overlap = await db.select({ id: appointments.id }).from(appointments).where(and(
    eq(appointments.businessId, businessId),
    eq(appointments.staffId, staffMember.id),
    ne(appointments.status, "cancelled"),
    lt(appointments.startAt, endAt),
    gt(appointments.endAt, startAt),
  )).limit(1);
  if (overlap.length) return c.json({ error: "slot_taken", message: "The selected time overlaps another appointment" }, 409);

  const [appointment] = await db.insert(appointments).values({
    businessId, clientId: client.id, staffId: staffMember.id, serviceId: service.id,
    startAt, endAt, status: body.status === "confirmed" ? "confirmed" : "booked", source: "dashboard",
  }).returning();

  await invalidateAllAvailability(businessId);
  await recordOnboardingEvent(businessId, userId, "appointment_created", { appointmentId: appointment.id });
  return c.json({ appointment }, 201);
});

meRoutes.patch("/businesses/:id/appointments/:apptId/reschedule", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const apptId = c.req.param("apptId");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ startAt: string }>();
  const startAt = new Date(body.startAt);
  if (!body.startAt || Number.isNaN(startAt.getTime())) return c.json({ error: "invalid_start_at" }, 400);

  const [current] = await db.select().from(appointments).where(and(eq(appointments.id, apptId), eq(appointments.businessId, businessId)));
  if (!current) return c.json({ error: "not_found" }, 404);
  if (current.status === "cancelled" || current.status === "completed" || current.status === "no_show") {
    return c.json({ error: "invalid_status", message: "Only active appointments can be rescheduled" }, 409);
  }

  const [service] = await db.select().from(services).where(and(eq(services.id, current.serviceId), eq(services.businessId, businessId)));
  if (!service) return c.json({ error: "invalid_reference" }, 400);
  const endAt = new Date(startAt.getTime() + service.durationMin * 60_000);
  const overlap = await db.select({ id: appointments.id }).from(appointments).where(and(
    eq(appointments.businessId, businessId), eq(appointments.staffId, current.staffId),
    ne(appointments.id, apptId), ne(appointments.status, "cancelled"),
    lt(appointments.startAt, endAt), gt(appointments.endAt, startAt),
  )).limit(1);
  if (overlap.length) return c.json({ error: "slot_taken", message: "The selected time overlaps another appointment" }, 409);

  const [appointment] = await db.update(appointments).set({ startAt, endAt }).where(and(eq(appointments.id, apptId), eq(appointments.businessId, businessId))).returning();
  await invalidateAllAvailability(businessId);
  return c.json({ appointment });
});

// ---------- Управление статусом записи ----------
//
// Владелец/менеджер может вручную перевести запись в любой допустимый статус:
// подтвердить (confirmed), отметить выполненной (completed), отменить (cancelled),
// зафиксировать неявку (no_show). Переход booked → confirmed делается автоматически
// при оплате (если подключён эквайринг), но здесь - ручное управление из дашборда.
//
// После перевода в completed обновляем CRM-счётчики клиента (visits, totalSpentCents,
// lastVisitAt) - чтобы карточка клиента всегда отражала реальную историю.
meRoutes.patch("/businesses/:id/appointments/:apptId", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const apptId = c.req.param("apptId");

  if (!(await assertMember(userId, businessId)))
    return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ status: string }>();

  const allowed = ["booked", "confirmed", "completed", "cancelled", "no_show"] as const;
  type AppointmentStatus = (typeof allowed)[number];

  if (!allowed.includes(body.status as AppointmentStatus)) {
    return c.json(
      {
        error: "invalid_status",
        message: `status must be one of: ${allowed.join(", ")}`,
      },
      400,
    );
  }

  const [beforeUpdate] = await db
    .select({ status: appointments.status })
    .from(appointments)
    .where(and(eq(appointments.id, apptId), eq(appointments.businessId, businessId)));
  if (!beforeUpdate) return c.json({ error: "not_found" }, 404);

  const [appt] = await db
    .update(appointments)
    .set({ status: body.status as AppointmentStatus })
    .where(and(eq(appointments.id, apptId), eq(appointments.businessId, businessId)))
    .returning();

  if (!appt) return c.json({ error: "not_found" }, 404);

  // Визит завершён — обновляем CRM-счётчики только при переходе в completed,
  // иначе повторное нажатие дублировало бы выручку и количество визитов.
  if (body.status === "completed" && beforeUpdate.status !== "completed") {
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, appt.serviceId));
    const priceCents = service?.priceCents ?? 0;

    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, appt.clientId));

    if (client) {
      await db
        .update(clients)
        .set({
          visits: client.visits + 1,
          totalSpentCents: client.totalSpentCents + priceCents,
          lastVisitAt: appt.startAt,
        })
        .where(eq(clients.id, appt.clientId));
    }
  }

  // Запись отменена — уведомляем очередь только при фактическом переходе
  // в cancelled, чтобы повторное сохранение не отправляло дубль.
  if (body.status === "cancelled" && beforeUpdate.status !== "cancelled") {
    await handleSlotFreed({
      businessId,
      serviceId: appt.serviceId,
      staffId: appt.staffId,
      startAt: appt.startAt,
      endAt: appt.endAt,
    });
  }

  return c.json({ appointment: appt });
});

// ---------- Шаблоны уведомлений ----------
//
// Шаблоны создаются автоматически при регистрации бизнеса (см. POST /me/businesses).
// Здесь владелец только читает и редактирует переводы - тип (type) менять нельзя,
// он жёстко привязан к событию в системе уведомлений.
//
// translations - объект вида { "ru": "...", "en": "...", ... }.
// Владелец редактирует только нужные ему языки - остальные не трогаются (merge, не replace).
meRoutes.get("/businesses/:id/templates", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");

  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const rows = await db
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.businessId, businessId));

  return c.json({ templates: rows });
});

meRoutes.patch("/businesses/:id/templates/:type", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const type = c.req.param("type");

  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ translations: Record<string, string> }>();

  if (!body.translations || typeof body.translations !== "object" || Array.isArray(body.translations)) {
    return c.json({ error: "invalid_input", message: "translations must be an object { locale: text }" }, 400);
  }

  // Ищем существующий шаблон
  const [existing] = await db
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.businessId, businessId), eq(messageTemplates.type, type)));

  if (!existing) return c.json({ error: "not_found" }, 404);

  // Merge: не затираем языки, которые владелец не передал - только обновляем переданные.
  const merged = { ...existing.translations, ...body.translations };

  const [updated] = await db
    .update(messageTemplates)
    .set({ translations: merged })
    .where(and(eq(messageTemplates.businessId, businessId), eq(messageTemplates.type, type)))
    .returning();

  return c.json({ template: updated });
});

// ---------- Команда бизнеса (businessMembers) ----------
//
// businessMembers - это таблица ДОСТУПА к дашборду (кто может заходить в панель управления).
// Не путать с staff - это сотрудники для записи клиентов (мастера, врачи и т.д.).
// Один человек может быть и в members (доступ к дашборду), и в staff (ведёт записи).
//
// Добавить нового члена команды можно только по email - пользователь должен уже
// быть зарегистрирован в системе. Это сознательное ограничение MVP: не хотим
// реализовывать инвайт-ссылки и pending-состояния прямо сейчас.
meRoutes.get("/businesses/:id/members", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");

  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const members = await db
    .select()
    .from(businessMembers)
    .where(eq(businessMembers.businessId, businessId));

  // Обогащаем email и именем - фронт показывает их в таблице команды.
  const enriched = await Promise.all(
    members.map(async (m) => {
      const [user] = await db.select().from(users).where(eq(users.id, m.userId));
      return {
        id: m.id,
        userId: m.userId,
        role: m.role,
        name: user?.name ?? "—",
        email: user?.email ?? "—",
      };
    })
  );

  return c.json({ members: enriched });
});

meRoutes.post("/businesses/:id/members", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");

  // Добавлять в команду может только owner или administrator
  const membership = await assertMember(userId, businessId);
  if (!membership) return c.json({ error: "forbidden" }, 403);
  if (!["owner", "administrator"].includes(membership.role)) {
    return c.json({ error: "insufficient_role", message: "Only owner or administrator can add members" }, 403);
  }

  const body = await c.req.json<{ email: string; role?: string }>();
  if (!body.email) return c.json({ error: "invalid_input", message: "email is required" }, 400);

  const allowedRoles = ["administrator", "manager", "employee"] as const;
  type MemberRole = (typeof allowedRoles)[number];
  const role: MemberRole = allowedRoles.includes(body.role as MemberRole)
    ? (body.role as MemberRole)
    : "employee";

  // Ищем пользователя по email
  const [targetUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, body.email.toLowerCase()));

  if (!targetUser) {
    return c.json(
      { error: "user_not_found", message: "No user with this email. They must register first." },
      404
    );
  }

  // Проверяем, не состоит ли уже в команде
  const [alreadyMember] = await db
    .select()
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.userId, targetUser.id)
      )
    );

  if (alreadyMember) {
    return c.json({ error: "already_member" }, 409);
  }

  const [newMember] = await db
    .insert(businessMembers)
    .values({ businessId, userId: targetUser.id, role })
    .returning();

  return c.json({
    member: {
      id: newMember.id,
      userId: newMember.userId,
      role: newMember.role,
      name: targetUser.name,
      email: targetUser.email,
    },
  });
});

meRoutes.delete("/businesses/:id/members/:memberId", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const memberId = c.req.param("memberId");

  const membership = await assertMember(userId, businessId);
  if (!membership) return c.json({ error: "forbidden" }, 403);
  if (!["owner", "administrator"].includes(membership.role)) {
    return c.json({ error: "insufficient_role" }, 403);
  }

  // Нельзя удалить owner-а из его собственного бизнеса
  const [target] = await db
    .select()
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.id, memberId),
        eq(businessMembers.businessId, businessId)
      )
    );

  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.role === "owner") {
    return c.json({ error: "cannot_remove_owner", message: "Owner cannot be removed from the business" }, 400);
  }

  await db
    .delete(businessMembers)
    .where(
      and(
        eq(businessMembers.id, memberId),
        eq(businessMembers.businessId, businessId)
      )
    );

  return c.json({ ok: true });
});

// ---------- Подписка ----------
//
// Возвращает текущий статус подписки бизнеса - фронт дашборда показывает
// баннер "триал заканчивается через X дней" и блокирует фичи при expired/cancelled.
// Детали платежей (история списаний) - отдельный эндпоинт, здесь только текущий статус.
meRoutes.get("/businesses/:id/subscription", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");

  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.businessId, businessId));

  if (!subscription) {
    // Бизнес только создан и ещё не прошёл через активацию триала -
    // возвращаем null, фронт покажет онбординг-шаг подключения оплаты.
    return c.json({ subscription: null });
  }

  // Считаем дни до конца триала/периода - удобнее чем парсить даты на фронте.
  const now = Date.now();
  const trialDaysLeft =
    subscription.status === "trial"
      ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - now) / 86_400_000))
      : null;

  const periodDaysLeft =
    subscription.currentPeriodEndsAt
      ? Math.max(0, Math.ceil((subscription.currentPeriodEndsAt.getTime() - now) / 86_400_000))
      : null;

  return c.json({
    subscription: {
      id: subscription.id,
      plan: subscription.plan,
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
      trialDaysLeft,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
      periodDaysLeft,
      hasPaymentMethod: Boolean(subscription.yookassaPaymentMethodId),
      cancelledAt: subscription.cancelledAt,
      createdAt: subscription.createdAt,
    },
  });
});

// Owner-created client, primarily used by onboarding and quick CRM actions.
meRoutes.post("/businesses/:id/clients", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{ name: string; phone?: string; email?: string }>();
  if (!body.name?.trim()) return c.json({ error: "invalid_input", message: "name is required" }, 400);
  const [client] = await db.insert(clients).values({
    businessId, name: body.name.trim(), phone: body.phone?.trim() || null, email: body.email?.trim().toLowerCase() || null, detectedLocale: "ru",
  }).returning();
  await recordOnboardingEvent(businessId, userId, "client_created", { clientId: client.id });
  return c.json({ client }, 201);
});

// ---------- CRM: карточка клиента ----------
//
// GET - полная карточка: контакты + история записей + CRM-поля (теги, заметки).
// PATCH - владелец редактирует только CRM-поля (теги, заметки).
//         Контактные данные (phone, email, telegramChatId) клиент задаёт сам
//         при бронировании - владелец их не меняет, чтобы не сломать доставку уведомлений.
meRoutes.get("/businesses/:id/clients/:clientId", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const clientId = c.req.param("clientId");

  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.businessId, businessId)));

  if (!client) return c.json({ error: "not_found" }, 404);

  // История записей клиента - обогащаем названиями услуги и сотрудника
  const clientAppts = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.clientId, clientId), eq(appointments.businessId, businessId)));

  const enrichedAppts = await Promise.all(
    clientAppts.map(async (a) => {
      const [service] = await db.select().from(services).where(eq(services.id, a.serviceId));
      const [staffMember] = await db.select().from(staff).where(eq(staff.id, a.staffId));
      return {
        id: a.id,
        serviceId: a.serviceId,
        staffId: a.staffId,
        startAt: a.startAt,
        endAt: a.endAt,
        status: a.status,
        serviceName: service?.name.en ?? service?.name.ru ?? "—",
        staffName: staffMember?.name ?? "—",
        priceCents: service?.priceCents ?? 0,
        currency: service?.currency ?? "",
      };
    })
  );

  enrichedAppts.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());

  return c.json({
    client,
    appointments: enrichedAppts,
  });
});

meRoutes.patch("/businesses/:id/clients/:clientId", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const clientId = c.req.param("clientId");

  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{
    tags?: string[];
    notes?: string[];
    marketingOptOut?: boolean;
  }>();

  // Разрешаем менять только CRM-поля - контакты клиент задаёт сам при бронировании.
  const patch: Record<string, unknown> = {};
  if (Array.isArray(body.tags)) patch.tags = body.tags;
  if (Array.isArray(body.notes)) patch.notes = body.notes;
  if (typeof body.marketingOptOut === "boolean") {
    patch.marketingOptOut = body.marketingOptOut;
    patch.marketingConsentAt = body.marketingOptOut ? null : new Date();
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "invalid_input", message: "Provide tags or notes to update" }, 400);
  }

  const [updated] = await db
    .update(clients)
    .set(patch)
    .where(and(eq(clients.id, clientId), eq(clients.businessId, businessId)))
    .returning();

  if (!updated) return c.json({ error: "not_found" }, 404);

  return c.json({ client: updated });
});

// POST /me/businesses - онбординг: владелец создаёт СВОЮ компанию с нуля.
// slug генерируется автоматически из названия - никакого "ivan" по умолчанию.
meRoutes.post("/businesses", async (c) => {
  const userId = c.get("userId") as string;
  const body = await c.req.json<{ name: string; niche: string; timezone: string }>();

  if (!body.name?.trim() || !body.niche?.trim() || !body.timezone?.trim()) {
    return c.json({ error: "invalid_input", message: "name, niche and timezone are required" }, 400);
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: body.timezone }).format();
  } catch {
    return c.json({ error: "invalid_timezone", message: "timezone must be a valid IANA timezone" }, 400);
  }

  const slug = await generateUniqueSlug(body.name.trim());

  const [business] = await db
    .insert(businesses)
    .values({
      ownerId: userId,
      slug,
      name: body.name,
      niche: body.niche,
      timezone: body.timezone,
      channelPriority: ["telegram", "whatsapp", "viber", "messenger", "sms", "email"],
      workingHours: {
        1: { start: 600, end: 1200 },
        2: { start: 600, end: 1200 },
        3: { start: 600, end: 1200 },
        4: { start: 600, end: 1200 },
        5: { start: 600, end: 1200 },
        6: null,
        0: null,
      },
    })
    .returning();

  await db.insert(businessMembers).values({ businessId: business.id, userId, role: "owner" });

  // Уведомления должны работать сразу "из коробки" - создаём дефолтные
  // мультиязычные шаблоны, владелец сможет отредактировать их позже.
  await db.insert(messageTemplates).values(
    Object.entries(defaultTemplates).map(([type, translations]) => ({
      businessId: business.id,
      type,
      translations,
    }))
  );

  await db.insert(businessNotificationSettings).values([
    "appointment.created", "appointment.confirmed", "appointment.cancelled", "appointment.rescheduled",
    "appointment.reminder.24h", "appointment.reminder.3h", "appointment.reminder.15m", "visit.completed",
  ].map((event) => ({
    businessId: business.id,
    event,
    enabled: true,
    channels: ["telegram", "whatsapp", "sms", "email"],
  })));

  return c.json({ business });
});

// GET /me/businesses/:id
meRoutes.get("/businesses/:id", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const membership = await assertMember(userId, businessId);
  if (!membership) return c.json({ error: "forbidden" }, 403);

  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business) return c.json({ error: "not_found" }, 404);
  return c.json({ business, myRole: membership.role });
});

// Расписание работы бизнеса ПО УМОЛЧАНИЮ - используется для всех сотрудников,
// у которых не озадано собственное индивидуальное окн приёма (staff.workingHours = null).
meRoutes.patch("/businesses/:id", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const membership = await assertMember(userId, businessId);
  if (!membership) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<
    Partial<{ name: string; timezone: string; workingHours: Record<number, { start: number; end: number } | null>; taxPercent: number }>
  >();
  const patch: Record<string, unknown> = {};
  if (body.name) patch.name = body.name;
  if (body.timezone) patch.timezone = body.timezone;
  if (body.workingHours) patch.workingHours = body.workingHours;
  if (body.taxPercent != null) patch.taxPercentBp = Math.round(body.taxPercent * 100);

  const [business] = await db.update(businesses).set(patch).where(eq(businesses.id, businessId)).returning();
  if (!business) return c.json({ error: "not_found" }, 404);

  if (body.workingHours) {
    await invalidateAllAvailability(businessId);
    await recordOnboardingEvent(businessId, userId, "schedule_configured");
  }

  return c.json({ business });
});

// ---------- Услуги (СВОИ, индивидуальные для каждого бизнеса) ----------

meRoutes.get("/businesses/:id/services", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const rows = await db.select().from(services).where(eq(services.businessId, businessId));
  return c.json({ services: rows });
});

// Владелец вводит название услуги ОДИН раз на своём языке (locale владельца) -
// мы кладём его во все 7 языковых слотов как стартовое значение, чтобы клиент
// в любом случае увидел текст, а не пустоту. Точный перевод на остальные языки -
// доработка на будущее (человеческий перевод/AI-перевод), но продукт уже рабочий.
meRoutes.post("/businesses/:id/services", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{
    name: string;
    durationMin: number;
    priceCents: number;
    currency: string;
    photoUrl?: string;
  }>();
  if (!body.name || !body.durationMin || body.priceCents == null || !body.currency) {
    return c.json({ error: "invalid_input" }, 400);
  }

  const locales = ["ru", "en", "es", "it", "fr", "kk", "hy"];
  const name = Object.fromEntries(locales.map((l) => [l, body.name]));

  const [service] = await db
    .insert(services)
    .values({
      businessId,
      name,
      durationMin: body.durationMin,
      priceCents: body.priceCents,
      currency: body.currency,
      photoUrl: body.photoUrl,
    })
    .returning();

  await recordOnboardingEvent(businessId, userId, "service_created", { serviceId: service.id });

  return c.json({ service });
});

meRoutes.patch("/businesses/:id/services/:serviceId", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<Partial<{ name: string; durationMin: number; priceCents: number; currency: string; photoUrl: string }>>();
  const patch: Record<string, unknown> = {};
  if (body.durationMin != null) patch.durationMin = body.durationMin;
  if (body.priceCents != null) patch.priceCents = body.priceCents;
  if (body.currency) patch.currency = body.currency;
  if (body.photoUrl !== undefined) patch.photoUrl = body.photoUrl;
  if (body.name) {
    const locales = ["ru", "en", "es", "it", "fr", "kk", "hy"];
    patch.name = Object.fromEntries(locales.map((l) => [l, body.name]));
  }

  const [service] = await db
    .update(services)
    .set(patch)
    .where(and(eq(services.id, c.req.param("serviceId")), eq(services.businessId, businessId)))
    .returning();

  if (!service) return c.json({ error: "not_found" }, 404);
  return c.json({ service });
});

meRoutes.delete("/businesses/:id/services/:serviceId", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  await db
    .delete(services)
    .where(and(eq(services.id, c.req.param("serviceId")), eq(services.businessId, businessId)));
  return c.json({ ok: true });
});

// ---------- Сотрудники ----------

meRoutes.get("/businesses/:id/staff", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const rows = await db.select().from(staff).where(eq(staff.businessId, businessId));
  return c.json({ staff: rows });
});

meRoutes.post("/businesses/:id/staff", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ name: string; serviceIds: string[]; colorHex?: string; photoUrl?: string; commissionPercent?: number }>();
  if (!body.name || !body.serviceIds?.length) return c.json({ error: "invalid_input" }, 400);

  const [member] = await db
    .insert(staff)
    .values({
      businessId,
      name: body.name,
      serviceIds: body.serviceIds,
      colorHex: body.colorHex ?? "#FF4438",
      photoUrl: body.photoUrl,
      commissionPercentBp: body.commissionPercent != null ? Math.round(body.commissionPercent * 100) : 0,
    })
    .returning();

  await recordOnboardingEvent(businessId, userId, "staff_created", { staffId: member.id });

  return c.json({ staff: member });
});

// Индивидуальное окно приёма сотрудника: владелец указывает, в какие дни недели
// и часы этот конкретный сотрудник принимает клиентов (а не "все подряд" по
// умолчанию бизнеса). null для дня = сотрудник в этот день не работает.
// working hours хранятся в минутах от полуночи, как и остальное расписание.
meRoutes.patch("/businesses/:id/staff/:staffId", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<
    Partial<{
      name: string;
      serviceIds: string[];
      colorHex: string;
      photoUrl: string;
      workingHours: Record<number, { start: number; end: number } | null> | null;
      commissionPercent: number;
    }>
  >();

  const patch: Record<string, unknown> = {};
  if (body.name) patch.name = body.name;
  if (body.serviceIds) patch.serviceIds = body.serviceIds;
  if (body.colorHex) patch.colorHex = body.colorHex;
  if (body.photoUrl !== undefined) patch.photoUrl = body.photoUrl;
  if (body.workingHours !== undefined) patch.workingHours = body.workingHours;
  if (body.commissionPercent != null) patch.commissionPercentBp = Math.round(body.commissionPercent * 100);

  const [member] = await db
    .update(staff)
    .set(patch)
    .where(and(eq(staff.id, c.req.param("staffId")), eq(staff.businessId, businessId)))
    .returning();

  if (!member) return c.json({ error: "not_found" }, 404);

  // Расписание изменилось - клиентам публичной страницы нельзя показывать устаревшие свободные окна.
  if (body.workingHours !== undefined) await invalidateAllAvailability(businessId);

  return c.json({ staff: member });
});

meRoutes.delete("/businesses/:id/staff/:staffId", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  await db.delete(staff).where(and(eq(staff.id, c.req.param("staffId")), eq(staff.businessId, businessId)));
  return c.json({ ok: true });
});

// ---------- Записи и клиенты (для дашборда) ----------

meRoutes.get("/businesses/:id/appointments", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const rows = await db.select().from(appointments).where(eq(appointments.businessId, businessId));
  const enriched = await Promise.all(
    rows.map(async (a) => {
      const [client] = await db.select().from(clients).where(eq(clients.id, a.clientId));
      const [service] = await db.select().from(services).where(eq(services.id, a.serviceId));
      const [staffMember] = await db.select().from(staff).where(eq(staff.id, a.staffId));
      return {
        ...a,
        clientName: client?.name,
        clientLocale: client?.detectedLocale, // владелец видит язык клиента, но не задаёт его
        serviceName: service?.name.en,
        priceCents: service?.priceCents ?? 0,
        currency: service?.currency ?? "RUB",
        staffName: staffMember?.name,
      };
    })
  );
  enriched.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  return c.json({ appointments: enriched });
});


// ---------- Retention / Reactivation ----------
meRoutes.get('/businesses/:id/retention/reactivation', async (c) => {
  const userId = c.get('userId') as string;
  const businessId = c.req.param('id');
  if (!(await assertMember(userId, businessId))) return c.json({ error: 'forbidden' }, 403);

  const segment = (c.req.query('segment') ?? 'all') as ReactivationSegment;
  if (!['all', 'due', 'at_risk', 'lost'].includes(segment)) {
    return c.json({ error: 'invalid_segment' }, 400);
  }

  const [clientRows, appointmentRows] = await Promise.all([
    db.select().from(clients).where(eq(clients.businessId, businessId)),
    db.select().from(appointments).where(eq(appointments.businessId, businessId)),
  ]);

  const allCandidates = buildReactivationClients(clientRows.filter((client) => !client.marketingOptOut), appointmentRows);
  const candidates = segment === 'all'
    ? allCandidates
    : allCandidates.filter((client) => client.segment === segment);

  return c.json({
    generatedAt: new Date().toISOString(),
    summary: {
      total: allCandidates.length,
      due: allCandidates.filter((client) => client.segment === 'due').length,
      atRisk: allCandidates.filter((client) => client.segment === 'at_risk').length,
      lost: allCandidates.filter((client) => client.segment === 'lost').length,
    },
    clients: candidates.slice(0, 100),
  });
});

meRoutes.get("/businesses/:id/clients", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const rows = await db.select().from(clients).where(eq(clients.businessId, businessId));
  return c.json({ clients: rows });
});

// ---------- Daily Business Intelligence ----------
meRoutes.get("/businesses/:id/daily-intelligence", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);
  const intelligence = await getDailyBusinessIntelligence(businessId);
  if (!intelligence) return c.json({ error: "not_found" }, 404);
  return c.json(intelligence);
});

// ---------- Empty Slot Intelligence ----------
meRoutes.get("/businesses/:id/empty-slot-intelligence", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);
  const rawDays = Number(c.req.query("days") || "3");
  const days = rawDays === 1 || rawDays === 7 ? rawDays : 3;
  const intelligence = await getEmptySlotIntelligence(businessId, days);
  if (!intelligence) return c.json({ error: "not_found" }, 404);
  return c.json(intelligence);
});

// ---------- Аналитика ----------
// Отдаём "сырые" агрегаты - графики и .xlsx-отчёт строятся на фронте из этих же данных,
// чтобы не тащить xlsx-генерацию на бэкенд ради одного экспорта.
meRoutes.get("/businesses/:id/analytics", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business) return c.json({ error: "not_found" }, 404);

  const [apptRows, svcRows, staffRows, clientRows] = await Promise.all([
    db.select().from(appointments).where(eq(appointments.businessId, businessId)),
    db.select().from(services).where(eq(services.businessId, businessId)),
    db.select().from(staff).where(eq(staff.businessId, businessId)),
    db.select().from(clients).where(eq(clients.businessId, businessId)),
  ]);

  const svcById = new Map(svcRows.map((s) => [s.id, s]));
  const staffById = new Map(staffRows.map((s) => [s.id, s]));
  const clientById = new Map(clientRows.map((cl) => [cl.id, cl]));

  // В деньги считаются только реально состоявшиеся/предстоящие записи -
  // отменённые и неявки (no_show) выручку не приносят.
  const isRevenueGenerating = (status: string) => status !== "cancelled" && status !== "no_show";
  const revenueOf = (a: (typeof apptRows)[number]) => svcById.get(a.serviceId)?.priceCents ?? 0;
  const commissionOf = (a: (typeof apptRows)[number]) => {
    const bp = staffById.get(a.staffId)?.commissionPercentBp ?? 0;
    return Math.round((revenueOf(a) * bp) / 10000);
  };

  const countedAppts = apptRows.filter((a) => isRevenueGenerating(a.status));
  const totalRevenueCents = countedAppts.reduce((sum, a) => sum + revenueOf(a), 0);
  const totalCommissionCents = countedAppts.reduce((sum, a) => sum + commissionOf(a), 0);
  const taxCents = Math.round((totalRevenueCents * business.taxPercentBp) / 10000);
  const netProfitCents = totalRevenueCents - taxCents - totalCommissionCents;

  const byDayMap = new Map<string, { date: string; revenueCents: number; appointments: number }>();
  for (const a of countedAppts) {
    const day = new Date(a.startAt).toISOString().slice(0, 10);
    const entry = byDayMap.get(day) ?? { date: day, revenueCents: 0, appointments: 0 };
    entry.revenueCents += revenueOf(a);
    entry.appointments += 1;
    byDayMap.set(day, entry);
  }

  const byServiceMap = new Map<string, { serviceId: string; name: string; revenueCents: number; count: number }>();
  for (const a of countedAppts) {
    const svc = svcById.get(a.serviceId);
    const entry = byServiceMap.get(a.serviceId) ?? {
      serviceId: a.serviceId,
      name: svc?.name.en ?? svc?.name.ru ?? "—",
      revenueCents: 0,
      count: 0,
    };
    entry.revenueCents += revenueOf(a);
    entry.count += 1;
    byServiceMap.set(a.serviceId, entry);
  }

  const byStaffMap = new Map<
    string,
    { staffId: string; name: string; revenueCents: number; commissionCents: number; count: number }
  >();
  for (const a of countedAppts) {
    const member = staffById.get(a.staffId);
    const entry = byStaffMap.get(a.staffId) ?? {
      staffId: a.staffId,
      name: member?.name ?? "—",
      revenueCents: 0,
      commissionCents: 0,
      count: 0,
    };
    entry.revenueCents += revenueOf(a);
    entry.commissionCents += commissionOf(a);
    entry.count += 1;
    byStaffMap.set(a.staffId, entry);
  }

  const noShowCount = apptRows.filter((a) => a.status === "no_show").length;
  const cancelledCount = apptRows.filter((a) => a.status === "cancelled").length;

  return c.json({
    summary: {
      totalRevenueCents,
      taxPercent: business.taxPercentBp / 100,
      taxCents,
      totalCommissionCents,
      netProfitCents,
      totalAppointments: apptRows.length,
      totalClients: clientRows.length,
      avgCheckCents: countedAppts.length ? Math.round(totalRevenueCents / countedAppts.length) : 0,
      noShowCount,
      cancelledCount,
    },
    byDay: [...byDayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byService: [...byServiceMap.values()].sort((a, b) => b.revenueCents - a.revenueCents),
    byStaff: [...byStaffMap.values()].sort((a, b) => b.revenueCents - a.revenueCents),
    // Детальная построчная выгрузка - основа для .xlsx отчёта на фронте.
    rows: apptRows.map((a) => ({
      date: new Date(a.startAt).toISOString().slice(0, 10),
      client: clientById.get(a.clientId)?.name ?? "—",
      service: svcById.get(a.serviceId)?.name.en ?? "—",
      staff: staffById.get(a.staffId)?.name ?? "—",
      status: a.status,
      priceCents: revenueOf(a),
      commissionCents: isRevenueGenerating(a.status) ? commissionOf(a) : 0,
      currency: svcById.get(a.serviceId)?.currency ?? "",
    })),
  });

  
});

// ---------- Маркетинговые рассылки ----------
//
// Только клиенты с telegramChatId могут получить рассылку - остальные каналы
// (WhatsApp, SMS) подключаются позже. При отправке идём последовательно с
// небольшой задержкой чтобы не словить 429 от Telegram.

type ReactivationCampaignSegment = 'due' | 'at_risk' | 'lost' | 'all';

type CampaignFilters = {
  segment: 'all' | 'inactive' | 'by_tag' | 'top_clients' | 'new_clients' | 'reactivation';
  inactiveDays?: number;
  tag?: string;
  visitsGte?: number;
  reactivationSegment?: ReactivationCampaignSegment;
  // Snapshot recipients used for repeat-contact protection and auditability.
  recipientIds?: string[];
  retentionAction?: 'offer';
  offeredSlot?: { serviceId: string; staffId: string; startAt: string };
};

const REACTIVATION_COOLDOWN_DAYS = 14;

async function getReactivationCampaignIds(businessId: string) {
  const cutoff = new Date(Date.now() - REACTIVATION_COOLDOWN_DAYS * 86_400_000);
  const rows = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.businessId, businessId), gte(campaigns.createdAt, cutoff)));

  const ids = new Set<string>();
  for (const campaign of rows) {
    const filters = campaign.filters as CampaignFilters | null;
    if (filters?.segment !== 'reactivation' || !Array.isArray(filters.recipientIds)) continue;
    for (const id of filters.recipientIds) ids.add(id);
  }
  return ids;
}

// Хелпер: фильтрует клиентов по сегменту. Для reactivation используется тот же
// детерминированный движок, что и Retention Engine. Возвращаются только клиенты
// с Telegram — остальные каналы появятся позже.
async function getSegmentClients(businessId: string, filters: CampaignFilters) {
  const allClients = await db
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.businessId, businessId),
        isNotNull(clients.telegramChatId),
        eq(clients.marketingOptOut, false)
      )
    );

  const now = Date.now();
  let matched: typeof allClients;

  switch (filters.segment) {
    case 'all':
      matched = allClients;
      break;

    case 'inactive': {
      const days = filters.inactiveDays ?? 30;
      const cutoff = now - days * 86_400_000;
      matched = allClients.filter(
        (cl) => !cl.lastVisitAt || cl.lastVisitAt.getTime() < cutoff
      );
      break;
    }

    case 'by_tag': {
      const tag = filters.tag ?? '';
      matched = allClients.filter((cl) => cl.tags.includes(tag));
      break;
    }

    case 'top_clients': {
      const min = filters.visitsGte ?? 5;
      matched = allClients.filter((cl) => cl.visits >= min);
      break;
    }

    case 'new_clients':
      matched = allClients.filter((cl) => cl.visits >= 1 && cl.visits <= 2);
      break;

    case 'reactivation': {
      const segment = filters.reactivationSegment ?? 'all';
      const [appointmentRows] = await Promise.all([
        db.select().from(appointments).where(eq(appointments.businessId, businessId)),
      ]);
      const candidateIds = new Set(
        buildReactivationClients(allClients, appointmentRows)
          .filter((client) => segment === 'all' || client.segment === segment)
          .map((client) => client.id)
      );
      matched = allClients.filter((cl) => candidateIds.has(cl.id));
      break;
    }

    default:
      matched = allClients;
  }

  // Для реактивации не долбим одного клиента повторно в течение cooldown.
  if (filters.segment === 'reactivation') {
    const recentlyContacted = await getReactivationCampaignIds(businessId);
    matched = matched.filter((cl) => !recentlyContacted.has(cl.id));
  }

  return matched;
}

// Хелпер: подставляет переменные в текст сообщения
function renderCampaignMessage(
  template: string,
  vars: { clientName: string; businessName: string }
): string {
  return template
    .replace(/\{\{clientName\}\}/g, vars.clientName)
    .replace(/\{\{businessName\}\}/g, vars.businessName);
}

// GET /me/businesses/:id/campaigns/:campaignId/performance
// Фактический результат кампании: доставка, запись после контакта, завершённый визит и выручка.

function escapeTelegramHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// POST /me/businesses/:id/retention/offer
// Отправляет персональное предложение на повторную запись конкретному клиенту.
// Слот передаётся из Smart Actions, а backend повторно проверяет его перед отправкой.
meRoutes.post("/businesses/:id/retention/offer", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{
    clientId: string;
    serviceId: string;
    staffId: string;
    startAt: string;
    message?: string;
  }>();

  if (!body.clientId || !body.serviceId || !body.staffId || !body.startAt) {
    return c.json({ error: "invalid_input", message: "clientId, serviceId, staffId and startAt are required" }, 400);
  }

  const [business, client, service, staffMember] = await Promise.all([
    db.select().from(businesses).where(eq(businesses.id, businessId)).then((r) => r[0]),
    db.select().from(clients).where(and(eq(clients.id, body.clientId), eq(clients.businessId, businessId))).then((r) => r[0]),
    db.select().from(services).where(and(eq(services.id, body.serviceId), eq(services.businessId, businessId))).then((r) => r[0]),
    db.select().from(staff).where(and(eq(staff.id, body.staffId), eq(staff.businessId, businessId))).then((r) => r[0]),
  ]);

  if (!business || !client || !service || !staffMember) return c.json({ error: "not_found" }, 404);
  if (client.marketingOptOut) return c.json({ error: "marketing_opt_out", message: "Клиент отказался от маркетинговых сообщений" }, 400);
  if (!business.telegramBotToken || !client.telegramChatId) {
    return c.json({ error: "telegram_not_connected", message: "Для предложения нужен подключённый Telegram" }, 400);
  }
  if (!staffMember.serviceIds.includes(service.id)) return c.json({ error: "invalid_staff" }, 400);

  const startAt = new Date(body.startAt);
  if (Number.isNaN(startAt.getTime())) return c.json({ error: "invalid_start_at" }, 400);
  const endAt = new Date(startAt.getTime() + service.durationMin * 60_000);

  // Повторная серверная проверка слота: между предпросмотром и отправкой
  // другой сотрудник/клиент мог занять окно.
  const conflicts = await db.select({ id: appointments.id }).from(appointments).where(
    and(
      eq(appointments.businessId, businessId),
      eq(appointments.staffId, body.staffId),
      lt(appointments.startAt, endAt),
      gt(appointments.endAt, startAt),
      ne(appointments.status, "cancelled")
    )
  );
  if (conflicts.length) return c.json({ error: "slot_unavailable", message: "Это окно уже занято" }, 409);

  const cooldownCutoff = new Date(Date.now() - REACTIVATION_COOLDOWN_DAYS * 86_400_000);
  const recentRecipients = await db.select({ id: campaignRecipients.id, filters: campaigns.filters }).from(campaignRecipients)
    .innerJoin(campaigns, eq(campaignRecipients.campaignId, campaigns.id))
    .where(and(
      eq(campaignRecipients.businessId, businessId),
      eq(campaignRecipients.clientId, client.id),
      gte(campaignRecipients.createdAt, cooldownCutoff)
    ));
  const hasRecentRetentionContact = recentRecipients.some((row) => {
    const filters = row.filters as CampaignFilters | null;
    return filters?.segment === 'reactivation';
  });
  if (hasRecentRetentionContact) return c.json({ error: "retention_cooldown", message: `Клиент уже получал retention-сообщение в последние ${REACTIVATION_COOLDOWN_DAYS} дней` }, 409);

  const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");
  const bookingUrl = `${frontendUrl}/${business.slug}`;
  const localDate = new Intl.DateTimeFormat("ru-RU", { timeZone: business.timezone, day: "2-digit", month: "2-digit", year: "numeric" }).format(startAt);
  const localTime = new Intl.DateTimeFormat("ru-RU", { timeZone: business.timezone, hour: "2-digit", minute: "2-digit" }).format(startAt);
  const defaultMessage = `Привет, ${client.name}! Мы будем рады видеть вас снова в ${business.name}.\n\nМожем предложить ${localDate} в ${localTime} — услуга «${service.name.ru ?? service.name.en}».\n\nЗаписаться: ${bookingUrl}`;
  const message = body.message?.trim() || defaultMessage;

  const campaignFilters: CampaignFilters = {
    segment: "reactivation",
    reactivationSegment: "all",
    recipientIds: [client.id],
    retentionAction: "offer",
    offeredSlot: { serviceId: service.id, staffId: staffMember.id, startAt: startAt.toISOString() },
  };

  const [campaign] = await db.insert(campaigns).values({
    businessId,
    name: `Retention offer · ${client.name}`,
    message,
    filters: campaignFilters,
    channel: "telegram",
    status: "sending",
    recipientCount: 1,
  }).returning();

  await db.insert(campaignRecipients).values({
    campaignId: campaign.id,
    businessId,
    clientId: client.id,
    channel: "telegram",
    status: "pending",
  });

  try {
    const telegramMessage = escapeTelegramHtml(message).slice(0, 4096);
    const result = await sendTelegramMessage(business.telegramBotToken, client.telegramChatId, telegramMessage);
    if (!result.ok) throw new Error(result.description ?? "telegram_delivery_failed");
    await db.update(campaignRecipients).set({ status: "sent", sentAt: new Date(), error: null }).where(
      and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.clientId, client.id))
    );
    const [updated] = await db.update(campaigns).set({ status: "sent", sentCount: 1, sentAt: new Date() }).where(eq(campaigns.id, campaign.id)).returning();
    return c.json({ campaign: updated, bookingUrl, offeredSlot: { serviceId: service.id, staffId: staffMember.id, startAt: startAt.toISOString(), date: localDate, time: localTime } });
  } catch (error) {
    await db.update(campaignRecipients).set({ status: "failed", error: error instanceof Error ? error.message : "send_failed" }).where(
      and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.clientId, client.id))
    );
    const [updated] = await db.update(campaigns).set({ status: "failed", sentCount: 0, sentAt: new Date() }).where(eq(campaigns.id, campaign.id)).returning();
    return c.json({ error: "send_failed", message: "Не удалось отправить предложение в Telegram", campaign: updated }, 502);
  }
});

// GET /me/businesses/:id/retention/dashboard
// Сводка retention за период: только retention/reactivation кампании и их
// детерминированно атрибутированные записи/визиты/выручка.
meRoutes.get("/businesses/:id/retention/dashboard", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const rawDays = Number(c.req.query("days") ?? 30);
  const days = [7, 30, 90].includes(rawDays) ? rawDays : 30;
  const since = new Date(Date.now() - days * 86_400_000);

  const retentionCampaigns = await db.select().from(campaigns).where(
    and(eq(campaigns.businessId, businessId), gte(campaigns.createdAt, since))
  );
  const campaignsOnly = retentionCampaigns.filter((campaign) => {
    const filters = campaign.filters as CampaignFilters | null;
    return filters?.segment === "reactivation";
  });

  const campaignIds = campaignsOnly.map((campaign) => campaign.id);
  const recipients = campaignIds.length
    ? await db.select().from(campaignRecipients).where(
        and(eq(campaignRecipients.businessId, businessId), inArray(campaignRecipients.campaignId, campaignIds))
      )
    : [];

  const clientIds = [...new Set(recipients.map((recipient) => recipient.clientId))];
  const appointmentRows = clientIds.length
    ? await db.select().from(appointments).where(
        and(eq(appointments.businessId, businessId), inArray(appointments.clientId, clientIds))
      )
    : [];
  const serviceIds = [...new Set(appointmentRows.map((appointment) => appointment.serviceId))];
  const serviceRows = serviceIds.length
    ? await db.select().from(services).where(inArray(services.id, serviceIds))
    : [];
  const priceByService = new Map(serviceRows.map((service) => [service.id, service.priceCents]));

  const ATTRIBUTION_DAYS = 30;
  const attributionMs = ATTRIBUTION_DAYS * 86_400_000;
  let delivered = 0;
  let failed = 0;
  let booked = 0;
  let completed = 0;
  let revenueCents = 0;
  const byDay = new Map<string, { date: string; sent: number; booked: number; completed: number; revenueCents: number }>();

  for (const recipient of recipients) {
    if (recipient.status === "sent") delivered++;
    if (recipient.status === "failed") failed++;
    const campaign = campaignsOnly.find((item) => item.id === recipient.campaignId);
    const sentAt = recipient.sentAt ?? campaign?.sentAt ?? campaign?.createdAt;
    if (!sentAt) continue;
    const sentMs = new Date(sentAt).getTime();
    const related = appointmentRows
      .filter((appointment) => appointment.clientId === recipient.clientId)
      .filter((appointment) => {
        const createdMs = new Date(appointment.createdAt).getTime();
        return createdMs >= sentMs && createdMs <= sentMs + attributionMs;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const firstBooked = related.find((appointment) => ["booked", "confirmed", "completed"].includes(appointment.status));
    const firstCompleted = related.find((appointment) => appointment.status === "completed");
    const day = new Date(sentAt).toISOString().slice(0, 10);
    const entry = byDay.get(day) ?? { date: day, sent: 0, booked: 0, completed: 0, revenueCents: 0 };
    entry.sent += recipient.status === "sent" ? 1 : 0;
    if (firstBooked) { booked++; entry.booked += 1; }
    if (firstCompleted) {
      completed++;
      const revenue = priceByService.get(firstCompleted.serviceId) ?? 0;
      revenueCents += revenue;
      entry.completed += 1;
      entry.revenueCents += revenue;
    }
    byDay.set(day, entry);
  }

  const reactivationSummary = await (async () => {
    const clientRows = await db.select().from(clients).where(eq(clients.businessId, businessId));
    const allAppointments = await db.select().from(appointments).where(eq(appointments.businessId, businessId));
    const result = buildReactivationClients(clientRows, allAppointments);
    return {
      total: result.length,
      due: result.filter((client) => client.segment === "due").length,
      atRisk: result.filter((client) => client.segment === "at_risk").length,
      lost: result.filter((client) => client.segment === "lost").length,
    };
  })();

  const base = delivered || recipients.length;
  return c.json({
    periodDays: days,
    attributionWindowDays: ATTRIBUTION_DAYS,
    summary: {
      campaigns: campaignsOnly.length,
      recipients: recipients.length,
      delivered,
      failed,
      booked,
      completed,
      revenueCents,
      bookingConversionPercent: base ? Math.round((booked / base) * 100) : 0,
      completionConversionPercent: base ? Math.round((completed / base) * 100) : 0,
    },
    reactivation: reactivationSummary,
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  });
});

meRoutes.get("/businesses/:id/campaigns/:campaignId/performance", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const campaignId = c.req.param("campaignId");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const [campaign] = await db.select().from(campaigns).where(
    and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId))
  );
  if (!campaign) return c.json({ error: "not_found" }, 404);

  const recipients = await db.select().from(campaignRecipients).where(
    and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.businessId, businessId))
  );

  const clientIds = recipients.map((r) => r.clientId);
  const appointmentRows = clientIds.length
    ? await db.select().from(appointments).where(
        and(eq(appointments.businessId, businessId), inArray(appointments.clientId, clientIds))
      )
    : [];
  const serviceIds = [...new Set(appointmentRows.map((a) => a.serviceId))];
  const serviceRows = serviceIds.length
    ? await db.select().from(services).where(inArray(services.id, serviceIds))
    : [];
  const priceByService = new Map(serviceRows.map((service) => [service.id, service.priceCents]));

  // Attribution window is deliberately deterministic: an appointment must be
  // created after the message was sent and within 30 days. This prevents a
  // future appointment that existed before the campaign from being counted.
  const ATTRIBUTION_DAYS = 30;
  const attributionMs = ATTRIBUTION_DAYS * 86_400_000;
  let booked = 0;
  let completed = 0;
  let revenueCents = 0;

  const recipientResults = [];
  for (const recipient of recipients) {
    const sentAt = recipient.sentAt ?? campaign.sentAt ?? campaign.createdAt;
    const sentMs = new Date(sentAt).getTime();
    const attributionEnd = sentMs + attributionMs;
    const related = appointmentRows
      .filter((a) => {
        if (a.clientId !== recipient.clientId) return false;
        const createdMs = new Date(a.createdAt).getTime();
        return createdMs >= sentMs && createdMs <= attributionEnd;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const firstBooked = related.find((a) => ["booked", "confirmed", "completed"].includes(a.status));
    const firstCompleted = related.find((a) => a.status === "completed");

    if (firstBooked) booked++;
    if (firstCompleted) {
      completed++;
      revenueCents += priceByService.get(firstCompleted.serviceId) ?? 0;
    }

    // Persist attribution so later campaign history does not have to infer it
    // again, while keeping the endpoint idempotent.
    const nextBookedAt = firstBooked?.startAt ?? null;
    const nextCompletedAt = firstCompleted?.startAt ?? null;
    const changed =
      (recipient.bookedAppointmentId ?? null) !== (firstBooked?.id ?? null) ||
      (recipient.completedAppointmentId ?? null) !== (firstCompleted?.id ?? null);
    if (changed) {
      await db.update(campaignRecipients).set({
        bookedAt: nextBookedAt,
        completedAt: nextCompletedAt,
        bookedAppointmentId: firstBooked?.id ?? null,
        completedAppointmentId: firstCompleted?.id ?? null,
      }).where(eq(campaignRecipients.id, recipient.id));
    }

    recipientResults.push({
      clientId: recipient.clientId,
      status: recipient.status,
      sentAt: recipient.sentAt,
      bookedAt: nextBookedAt,
      completedAt: nextCompletedAt,
      bookedAppointmentId: firstBooked?.id ?? null,
      completedAppointmentId: firstCompleted?.id ?? null,
      attributedRevenueCents: firstCompleted ? (priceByService.get(firstCompleted.serviceId) ?? 0) : 0,
    });
  }

  const delivered = recipients.filter((r) => r.status === "sent").length;
  const failed = recipients.filter((r) => r.status === "failed").length;
  const conversionBase = delivered || recipients.length;

  return c.json({
    campaign,
    attribution: { windowDays: ATTRIBUTION_DAYS, rule: "appointment.createdAt after message sentAt" },
    summary: {
      recipients: recipients.length,
      delivered,
      failed,
      booked,
      completed,
      revenueCents,
      bookingConversionPercent: conversionBase ? Math.round((booked / conversionBase) * 100) : 0,
      completionConversionPercent: conversionBase ? Math.round((completed / conversionBase) * 100) : 0,
    },
    recipients: recipientResults,
  });
});

// GET /me/businesses/:id/campaigns - история рассылок
meRoutes.get("/businesses/:id/campaigns", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.businessId, businessId))
    .orderBy(desc(campaigns.createdAt));

  return c.json({ campaigns: rows });
});

// POST /me/businesses/:id/campaigns/preview
// Предварительный просмотр: сколько клиентов попадёт в выборку и кто именно.
// Ничего не отправляет - только считает. Нужен для UI "Получат: 12 клиентов".
meRoutes.post("/businesses/:id/campaigns/preview", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ filters: CampaignFilters }>();
  if (!body.filters?.segment) {
    return c.json({ error: "invalid_input", message: "filters.segment is required" }, 400);
  }
  if (body.filters.segment === 'reactivation' && !['all', 'due', 'at_risk', 'lost'].includes(body.filters.reactivationSegment ?? 'all')) {
    return c.json({ error: 'invalid_reactivation_segment' }, 400);
  }

  const matched = await getSegmentClients(businessId, body.filters);
  let excludedWithoutChannel = 0;

  if (body.filters.segment === 'reactivation') {
    const [allBusinessClients, appointmentRows] = await Promise.all([
      db.select().from(clients).where(eq(clients.businessId, businessId)),
      db.select().from(appointments).where(eq(appointments.businessId, businessId)),
    ]);
    const segment = body.filters.reactivationSegment ?? 'all';
    const candidateIds = new Set(
      buildReactivationClients(allBusinessClients, appointmentRows)
        .filter((client) => segment === 'all' || client.segment === segment)
        .map((client) => client.id)
    );
    excludedWithoutChannel = allBusinessClients.filter((client) => candidateIds.has(client.id) && !client.telegramChatId).length;
  }

  return c.json({
    count: matched.length,
    sample: matched.slice(0, 5).map((cl) => ({ id: cl.id, name: cl.name })),
    channel: 'telegram',
    excludedWithoutChannel,
  });
});



// POST /me/businesses/:id/campaigns/send
// Реальная отправка. Создаёт запись в campaigns и шлёт сообщения последовательно.
// Статус в БД обновляется после завершения всей рассылки.
meRoutes.post("/businesses/:id/campaigns/send", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{
    name: string;
    message: string;
    filters: CampaignFilters;
    channel?: string;
  }>();

  if (!body.name?.trim() || !body.message?.trim() || !body.filters?.segment) {
    return c.json({ error: "invalid_input", message: "name, message and filters.segment are required" }, 400);
  }

  const channel = body.channel ?? 'telegram';
  if (channel !== 'telegram') {
    return c.json({ error: 'channel_not_available', message: 'Сейчас доступна только отправка в Telegram' }, 400);
  }

  if (body.filters.segment === 'reactivation' && !['all', 'due', 'at_risk', 'lost'].includes(body.filters.reactivationSegment ?? 'all')) {
    return c.json({ error: 'invalid_reactivation_segment' }, 400);
  }

  // Проверяем что Telegram-бот подключён - без него отправить невозможно
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId));

  if (!business?.telegramBotToken) {
    return c.json(
      { error: "telegram_not_connected", message: "Подключите Telegram-бота в настройках чтобы делать рассылки" },
      400
    );
  }

  const matched = await getSegmentClients(businessId, body.filters);

  if (matched.length === 0) {
    return c.json({ error: "no_recipients", message: "Ни один клиент не попал в выборку" }, 400);
  }

  // Сохраняем snapshot получателей. Он нужен для истории и защиты от
  // повторной реактивации одного и того же клиента в ближайшие 14 дней.
  const campaignFilters: CampaignFilters = {
    ...body.filters,
    ...(body.filters.segment === 'reactivation' ? { recipientIds: matched.map((client) => client.id) } : {}),
  };

  const [campaign] = await db
    .insert(campaigns)
    .values({
      businessId,
      name: body.name.trim(),
      message: body.message.trim(),
      filters: campaignFilters,
      channel,
      status: 'sending',
      recipientCount: matched.length,
    })
    .returning();

  // Фиксируем snapshot получателей отдельными строками — так можно восстановить
  // результат кампании даже после изменения CRM-карточки клиента.
  await db.insert(campaignRecipients).values(
    matched.map((client) => ({
      campaignId: campaign.id,
      businessId,
      clientId: client.id,
      channel,
      status: "pending",
    }))
  );

  // Отправляем последовательно - 50ms между запросами чтобы не словить 429
  let sentCount = 0;
  for (const client of matched) {
    if (!client.telegramChatId) continue;
    try {
      const text = renderCampaignMessage(body.message, {
        clientName: client.name,
        businessName: business.name,
      });
      const result = await sendTelegramMessage(
        business.telegramBotToken,
        client.telegramChatId,
        text
      );
      if (result.ok) {
        sentCount++;
        await db.update(campaignRecipients).set({ status: "sent", sentAt: new Date(), error: null })
          .where(and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.clientId, client.id)));
      } else {
        await db.update(campaignRecipients).set({ status: "failed", error: "telegram_delivery_failed" })
          .where(and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.clientId, client.id)));
      }
    } catch (error) {
      await db.update(campaignRecipients).set({ status: "failed", error: error instanceof Error ? error.message : "send_failed" })
        .where(and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.clientId, client.id)));
      // Один упавший клиент не останавливает всю рассылку
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  // Обновляем итоговый статус
  const [updated] = await db
    .update(campaigns)
    .set({
      status: sentCount > 0 ? 'sent' : 'failed',
      sentCount,
      sentAt: new Date(),
    })
    .where(eq(campaigns.id, campaign.id))
    .returning();

  return c.json({
    campaign: updated,
    result: {
      total: matched.length,
      sent: sentCount,
      failed: matched.length - sentCount,
    },
  });
});

// GET /me/businesses/:id/waitlist — список очереди
meRoutes.get('/businesses/:id/waitlist', async (c) => {
  const userId = c.get('userId') as string;
  const businessId = c.req.param('id');

  if (!(await assertMember(userId, businessId))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const status = c.req.query('status'); // ?status=active|invited|claimed|expired|cancelled

  const rows = await db
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.businessId, businessId),
        status ? eq(waitlistEntries.status, status as any) : undefined,
      ),
    )
    .orderBy(desc(waitlistEntries.createdAt));

  // Обогащаем именами клиента и услуги
  const enriched = await Promise.all(
    rows.map(async (entry) => {
      const [[cl], [svc], staffMember] = await Promise.all([
        db.select().from(clients).where(eq(clients.id, entry.clientId)),
        db.select().from(services).where(eq(services.id, entry.serviceId)),
        entry.staffId
          ? db.select().from(staff).where(eq(staff.id, entry.staffId)).then(([r]) => r)
          : Promise.resolve(null),
      ]);

      return {
        ...entry,
        clientName: cl?.name ?? '—',
        serviceName: svc?.name['en'] ?? svc?.name['ru'] ?? '—',
        staffName: staffMember?.name ?? 'Любой',
      };
    }),
  );

  return c.json({ waitlist: enriched });
});

// PATCH /me/businesses/:id/waitlist/:entryId — ручная отмена заявки
meRoutes.patch('/businesses/:id/waitlist/:entryId', async (c) => {
  const userId = c.get('userId') as string;
  const businessId = c.req.param('id');
  const entryId = c.req.param('entryId');

  if (!(await assertMember(userId, businessId))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const body = await c.req.json<{ status: 'cancelled' }>();

  if (body.status !== 'cancelled') {
    return c.json({ error: 'invalid_input', message: 'Only cancellation is allowed' }, 400);
  }

  const [entry] = await db
    .update(waitlistEntries)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(waitlistEntries.id, entryId),
        eq(waitlistEntries.businessId, businessId),
      ),
    )
    .returning();

  if (!entry) return c.json({ error: 'not_found' }, 404);

  return c.json({ entry });
});

// POST /me/businesses/:id/waitlist/:entryId/notify — принудительно пригласить
meRoutes.post('/businesses/:id/waitlist/:entryId/notify', async (c) => {
  const userId = c.get('userId') as string;
  const businessId = c.req.param('id');
  const entryId = c.req.param('entryId');

  if (!(await assertMember(userId, businessId))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const [entry] = await db
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.id, entryId),
        eq(waitlistEntries.businessId, businessId),
        eq(waitlistEntries.status, 'active'),
      ),
    );

  if (!entry) {
    return c.json({ error: 'not_found_or_not_active' }, 404);
  }

  await handleSlotFreed({
    businessId: entry.businessId,
    serviceId: entry.serviceId,
    staffId: entry.staffId,
    startAt: entry.startAt,
    endAt: entry.endAt,
  });

  return c.json({ ok: true });
});

// POST /me/businesses/:id/ai/message
// AI Message Generator: LLM is optional; without credentials a safe deterministic fallback is returned.
meRoutes.post("/businesses/:id/ai/message", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const allowed = await redis.incr(`ai:message:${userId}`);
  if (allowed === 1) await redis.expire(`ai:message:${userId}`, 60);
  if (allowed > 20) return c.json({ error: "rate_limited" }, 429);

  const body = await c.req.json<any>();
  const purpose = ["reactivation", "appointment_reminder", "follow_up", "promotion"].includes(body.purpose) ? body.purpose : null;
  const tone = ["friendly", "professional", "warm", "short"].includes(body.tone) ? body.tone : null;
  const language = ["ru", "en", "es", "it", "fr", "kk", "hy"].includes(body.language) ? body.language : null;
  const channel = ["telegram", "whatsapp", "sms", "email"].includes(body.channel) ? body.channel : null;
  if (!purpose || !tone || !language || !channel) return c.json({ error: "invalid_input" }, 400);

  const [business] = await db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId));
  if (!business) return c.json({ error: "not_found" }, 404);

  let clientName: string | undefined;
  let serviceName: string | undefined;
  let lastVisitAt: string | null | undefined;
  if (body.clientId) {
    const [client] = await db.select({ id: clients.id, name: clients.name, marketingOptOut: clients.marketingOptOut }).from(clients).where(and(eq(clients.id, body.clientId), eq(clients.businessId, businessId)));
    if (!client) return c.json({ error: "client_not_found" }, 404);
    clientName = client.name;
    if (client.marketingOptOut && purpose !== "appointment_reminder") return c.json({ error: "marketing_opt_out" }, 409);
    const history = await db.select({ startAt: appointments.startAt, serviceId: appointments.serviceId }).from(appointments).where(and(eq(appointments.businessId, businessId), eq(appointments.clientId, client.id), eq(appointments.status, "completed"))).orderBy(desc(appointments.startAt)).limit(1);
    const last = history[0];
    lastVisitAt = last?.startAt?.toISOString?.() ?? null;
    if (last?.serviceId) {
      const [service] = await db.select({ name: services.name }).from(services).where(and(eq(services.id, last.serviceId), eq(services.businessId, businessId)));
      serviceName = service?.name?.ru ?? service?.name?.en ?? undefined;
    }
  }

  try {
    const result = await generateAiMessage({
      businessName: business.name, clientName, serviceName, lastVisitAt, purpose, tone, language, channel,
      draft: typeof body.draft === "string" ? body.draft.slice(0, 2000) : undefined,
      offer: body.offer && typeof body.offer === "object" ? { date: String(body.offer.date || ""), time: String(body.offer.time || ""), bookingUrl: body.offer.bookingUrl ? String(body.offer.bookingUrl) : undefined } : undefined,
    });
    return c.json({ ...result, configured: getAiMessageStatus().configured });
  } catch (error) {
    return c.json({ error: "ai_provider_failed", message: error instanceof Error ? error.message : "AI provider failed" }, 502);
  }
});

// GET /me/businesses/:id/retention/intelligence
// Explainable AI-ready слой: рекомендации строятся детерминированно,
// поэтому результат полезен даже без подключённого LLM-провайдера.
meRoutes.get("/businesses/:id/retention/intelligence", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const [clientRows, appointmentRows, serviceRows, staffRows] = await Promise.all([
    db.select().from(clients).where(eq(clients.businessId, businessId)),
    db.select().from(appointments).where(eq(appointments.businessId, businessId)),
    db.select().from(services).where(eq(services.businessId, businessId)),
    db.select().from(staff).where(eq(staff.businessId, businessId)),
  ]);
  const candidates = buildReactivationClients(clientRows, appointmentRows).slice(0, 20);
  const serviceById = new Map(serviceRows.map((item) => [item.id, item]));
  const staffById = new Map(staffRows.map((item) => [item.id, item]));

  const recommendations = candidates.slice(0, 10).map((candidate) => {
    const history = appointmentRows
      .filter((item) => item.clientId === candidate.id && item.status === "completed")
      .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
    const last = history[0];
    const service = last ? serviceById.get(last.serviceId) : undefined;
    const staffMember = last ? staffById.get(last.staffId) : undefined;
    const lateness = Math.max(0, (candidate.daysSinceLastVisit ?? 0) - (candidate.expectedReturnDays ?? 30));
    const action = service && staffMember ? "offer_repeat_booking" : "send_reminder";
    return {
      clientId: candidate.id,
      clientName: candidate.name,
      segment: candidate.segment,
      score: candidate.score,
      why: `Обычно визиты каждые ${candidate.expectedReturnDays ?? 30} дн.; сейчас прошло ${candidate.daysSinceLastVisit} дн. Просрочка: ${lateness} дн.`,
      recommendation: service ? `Предложить повторную запись на «${service.name?.ru ?? service.name?.en ?? "последнюю услугу"}»` : "Напомнить о Timio и предложить выбрать удобное время",
      action,
      lastServiceId: service?.id ?? null,
      lastStaffId: staffMember?.id ?? null,
      lastVisitAt: last?.startAt ?? null,
    };
  });

  return c.json({
    generatedAt: new Date().toISOString(),
    provider: "deterministic",
    explanation: "Рекомендации рассчитаны по истории визитов и текущему retention-сегменту. LLM не требуется.",
    recommendations,
  });
});
