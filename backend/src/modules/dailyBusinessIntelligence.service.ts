import { and, eq, gte, lt, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { appointments, businesses, clients, services, staff } from "../db/schema.js";
import { buildReactivationClients } from "./retentionEngine.js";

export type DailyActionPriority = "high" | "medium" | "info";

export interface DailyBusinessIntelligence {
  generatedAt: string;
  date: string;
  timezone: string;
  summary: {
    appointments: number;
    upcoming: number;
    confirmed: number;
    needsConfirmation: number;
    completed: number;
    noShow: number;
    cancelled: number;
    clients: number;
    expectedRevenueCents: number;
    completedRevenueCents: number;
  };
  capacity: {
    workingMinutes: number;
    bookedMinutes: number;
    freeMinutes: number;
    utilizationPercent: number;
    freeBlocks: number;
  };
  actions: {
    id: string;
    priority: DailyActionPriority;
    title: string;
    description: string;
    count?: number;
    target: "appointments" | "clients" | "campaigns" | "analytics";
  }[];
  nextAppointments: {
    id: string;
    clientId: string;
    clientName: string;
    staffId: string;
    staffName: string;
    serviceName: string;
    startAt: string;
    endAt: string;
    status: string;
    priceCents: number;
    currency: string;
  }[];
  retention: {
    total: number;
    due: number;
    atRisk: number;
    lost: number;
  };
}

function localDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localDateToUtcMidnight(date: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(guess);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

function nextLocalDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function weekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function mergeIntervals(intervals: Array<{ start: number; end: number }>) {
  const sorted = intervals.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) merged.push({ ...interval });
    else last.end = Math.max(last.end, interval.end);
  }
  return merged;
}

export async function getDailyBusinessIntelligence(businessId: string): Promise<DailyBusinessIntelligence | null> {
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business) return null;

  const date = localDate(new Date(), business.timezone);
  const dayStart = localDateToUtcMidnight(date, business.timezone);
  const dayEnd = localDateToUtcMidnight(nextLocalDate(date), business.timezone);

  const [apptRows, serviceRows, staffRows, clientRows, historyRows] = await Promise.all([
    db.select().from(appointments).where(and(eq(appointments.businessId, businessId), gte(appointments.startAt, dayStart), lt(appointments.startAt, dayEnd))),
    db.select().from(services).where(eq(services.businessId, businessId)),
    db.select().from(staff).where(eq(staff.businessId, businessId)),
    db.select().from(clients).where(eq(clients.businessId, businessId)),
    db.select().from(appointments).where(eq(appointments.businessId, businessId)),
  ]);

  const serviceById = new Map(serviceRows.map((s) => [s.id, s]));
  const staffById = new Map(staffRows.map((s) => [s.id, s]));
  const clientById = new Map(clientRows.map((c) => [c.id, c]));
  const activeToday = apptRows.filter((a) => a.status !== "cancelled");
  const upcoming = activeToday.filter((a) => new Date(a.endAt).getTime() >= Date.now() && a.status !== "completed" && a.status !== "no_show");
  const needsConfirmation = upcoming.filter((a) => a.status === "booked");
  const completed = apptRows.filter((a) => a.status === "completed");
  const noShow = apptRows.filter((a) => a.status === "no_show");
  const cancelled = apptRows.filter((a) => a.status === "cancelled");
  const priceOf = (a: (typeof apptRows)[number]) => serviceById.get(a.serviceId)?.priceCents ?? 0;
  const expectedRevenueCents = activeToday.filter((a) => ["booked", "confirmed", "completed"].includes(a.status)).reduce((sum, a) => sum + priceOf(a), 0);
  const completedRevenueCents = completed.reduce((sum, a) => sum + priceOf(a), 0);
  const clientsToday = new Set(activeToday.map((a) => a.clientId));

  const dayOfWeek = weekday(date);
  let workingMinutes = 0;
  let bookedMinutes = 0;
  let freeBlocks = 0;
  const now = Date.now();
  for (const member of staffRows) {
    const window = (member.workingHours ?? business.workingHours)?.[dayOfWeek];
    if (!window) continue;
    workingMinutes += Math.max(0, window.end - window.start);
    const intervals = mergeIntervals(activeToday.filter((a) => a.staffId === member.id).map((a) => {
      const start = Math.max(0, Math.round((new Date(a.startAt).getTime() - dayStart.getTime()) / 60000));
      const end = Math.min(1440, Math.round((new Date(a.endAt).getTime() - dayStart.getTime()) / 60000));
      return { start, end };
    }));
    bookedMinutes += intervals.reduce((sum, x) => sum + (x.end - x.start), 0);
    let cursor = window.start;
    for (const interval of intervals) {
      if (interval.start > cursor) freeBlocks += 1;
      cursor = Math.max(cursor, interval.end);
    }
    if (cursor < window.end) freeBlocks += 1;
  }
  const freeMinutes = Math.max(0, workingMinutes - bookedMinutes);
  const utilizationPercent = workingMinutes ? Math.min(100, Math.round((bookedMinutes / workingMinutes) * 100)) : 0;

  const retentionClients = buildReactivationClients(clientRows.filter((client) => !client.marketingOptOut), historyRows);
  const retention = {
    total: retentionClients.length,
    due: retentionClients.filter((c) => c.segment === "due").length,
    atRisk: retentionClients.filter((c) => c.segment === "at_risk").length,
    lost: retentionClients.filter((c) => c.segment === "lost").length,
  };

  const actions: DailyBusinessIntelligence["actions"] = [];
  if (needsConfirmation.length) actions.push({ id: "confirm", priority: "high", title: "Подтвердить записи", description: `${needsConfirmation.length} ${needsConfirmation.length === 1 ? "клиент ещё не подтвердил запись" : "записей требуют подтверждения"}.`, count: needsConfirmation.length, target: "appointments" });
  const overdue = apptRows.filter((a) => ["booked", "confirmed"].includes(a.status) && new Date(a.endAt).getTime() < now);
  if (overdue.length) actions.push({ id: "close-visits", priority: "high", title: "Закрыть прошедшие визиты", description: `${overdue.length} ${overdue.length === 1 ? "визит уже закончился" : "визитов уже закончились"}. Отметьте результат, чтобы CRM и аналитика были актуальны.`, count: overdue.length, target: "appointments" });
  if (retention.total) actions.push({ id: "retention", priority: "medium", title: "Вернуть клиентов", description: `${retention.due} пора напомнить, ${retention.atRisk} под угрозой, ${retention.lost} потеряны.`, count: retention.total, target: "campaigns" });
  if (freeMinutes >= 120 && activeToday.length) actions.push({ id: "free-capacity", priority: "medium", title: "Есть свободная ёмкость", description: `${Math.round(freeMinutes / 60)} ч свободного времени у команды сегодня.`, count: freeBlocks, target: "appointments" });
  if (!actions.length) actions.push({ id: "healthy", priority: "info", title: "На сегодня всё под контролем", description: "Критичных действий по текущим данным нет. Следите за расписанием и результатами визитов.", target: "analytics" });

  const nextAppointments = upcoming
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .slice(0, 5)
    .map((a) => ({
      id: a.id, clientId: a.clientId, clientName: clientById.get(a.clientId)?.name ?? "—",
      staffId: a.staffId, staffName: staffById.get(a.staffId)?.name ?? "—",
      serviceName: serviceById.get(a.serviceId)?.name?.ru ?? serviceById.get(a.serviceId)?.name?.en ?? "—",
      startAt: a.startAt.toISOString(), endAt: a.endAt.toISOString(), status: a.status,
      priceCents: priceOf(a), currency: serviceById.get(a.serviceId)?.currency ?? "",
    }));

  return {
    generatedAt: new Date().toISOString(), date, timezone: business.timezone,
    summary: { appointments: apptRows.length, upcoming: upcoming.length, confirmed: upcoming.filter((a) => a.status === "confirmed").length, needsConfirmation: needsConfirmation.length, completed: completed.length, noShow: noShow.length, cancelled: cancelled.length, clients: clientsToday.size, expectedRevenueCents, completedRevenueCents },
    capacity: { workingMinutes, bookedMinutes, freeMinutes, utilizationPercent, freeBlocks },
    actions, nextAppointments, retention,
  };
}
