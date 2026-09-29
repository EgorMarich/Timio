import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { appointments, businesses, clients, services, staff as staffTable } from "../db/schema.js";
import { getAvailability } from "./availability.js";
import { buildReactivationClients } from "./retentionEngine.js";

type HorizonDays = 1 | 3 | 7;

function businessDateKey(date: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function localDateTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function dateTimeParts(iso: string, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export interface EmptySlotIntelligence {
  generatedAt: string;
  timezone: string;
  days: HorizonDays;
  summary: { freeSlots: number; opportunities: number; matchedClients: number };
  opportunities: Array<{
    id: string;
    startAt: string;
    endAt: string;
    date: string;
    time: string;
    staffId: string;
    staffName: string;
    serviceId: string;
    serviceName: string;
    durationMin: number;
    priceCents: number;
    currency: string;
    client: {
      id: string;
      name: string;
      score: number;
      segment: "due" | "at_risk" | "lost";
      reason: string;
      lastVisitAt: string | null;
      expectedReturnDays: number | null;
      telegramAvailable: boolean;
      phoneAvailable: boolean;
      emailAvailable: boolean;
    } | null;
    matchReason: string | null;
    action: "offer_repeat_booking" | "open_client";
  }>;
}

export async function getEmptySlotIntelligence(businessId: string, days: HorizonDays = 3): Promise<EmptySlotIntelligence | null> {
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business) return null;

  const [serviceRows, staffRows, clientRows, appointmentRows] = await Promise.all([
    db.select().from(services).where(eq(services.businessId, businessId)),
    db.select().from(staffTable).where(eq(staffTable.businessId, businessId)),
    db.select().from(clients).where(eq(clients.businessId, businessId)),
    db.select().from(appointments).where(eq(appointments.businessId, businessId)),
  ]);

  const serviceById = new Map(serviceRows.map((s) => [s.id, s]));
  const staffById = new Map(staffRows.map((s) => [s.id, s]));
  const retention = buildReactivationClients(clientRows.filter((c) => !c.marketingOptOut), appointmentRows);
    const lastVisit = new Map<string, { serviceId: string; staffId: string; startAt: string }>();
  for (const a of appointmentRows.filter((a) => a.status === "completed")) {
    const current = lastVisit.get(a.clientId);
    if (!current || new Date(a.startAt).getTime() > new Date(current.startAt).getTime()) {
      lastVisit.set(a.clientId, { serviceId: a.serviceId, staffId: a.staffId, startAt: a.startAt.toISOString() });
    }
  }

  const startDate = businessDateKey(new Date(), business.timezone);
  const freeSlots: EmptySlotIntelligence["opportunities"] = [];
  let totalFreeSlots = 0;

  for (let offset = 1; offset <= days; offset++) {
    const date = addDays(startDate, offset);
    for (const service of serviceRows) {
      const slots = await getAvailability({ businessId, serviceId: service.id, date });
      for (const slot of slots) {
        const member = staffById.get(slot.staffId);
        if (!member) continue;
        totalFreeSlots++;

        const candidates = retention
          .map((candidate) => {
            const last = lastVisit.get(candidate.id);
            if (!last) return null;
            if (last.serviceId !== service.id) return null;
            const sameStaff = last.staffId === member.id;
            const daysLate = candidate.latenessDays ?? 0;
            const score = candidate.score + (sameStaff ? 20 : 0) + Math.min(10, Math.round(daysLate / 7));
            return { candidate, last, sameStaff, score };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .sort((a, b) => b.score - a.score)[0];

        const picked = candidates?.candidate;
        const pickedLast = candidates?.last;
        const client = picked ? {
          id: picked.id,
          name: picked.name,
          score: Math.min(100, candidates!.score),
          segment: picked.segment,
          reason: picked.reason,
          lastVisitAt: pickedLast?.startAt ?? null,
          expectedReturnDays: picked.expectedReturnDays,
          telegramAvailable: Boolean(clientRows.find((row) => row.id === picked.id)?.telegramChatId),
          phoneAvailable: Boolean(picked.phone),
          emailAvailable: Boolean(picked.email),
        } : null;

        freeSlots.push({
          id: `${slot.staffId}:${service.id}:${slot.startAt}`,
          startAt: slot.startAt,
          endAt: slot.endAt,
          date,
          time: dateTimeParts(slot.startAt, business.timezone).time,
          staffId: member.id,
          staffName: member.name,
          serviceId: service.id,
          serviceName: service.name?.ru ?? service.name?.en ?? "Услуга",
          durationMin: service.durationMin,
          priceCents: service.priceCents,
          currency: service.currency,
          client,
          matchReason: client ? (candidates!.sameStaff ? `Обычно ходит к ${member.name} на эту услугу.` : "Услуга совпадает с последним визитом клиента.") : null,
          action: client ? "offer_repeat_booking" : "open_client",
        });
      }
    }
  }

  // One client should not occupy every free window in the owner dashboard.
  // Prefer matched opportunities, then earlier slots, then higher client score.
  const usedClients = new Set<string>();
  const sorted = freeSlots.sort((a, b) => {
    if (Boolean(a.client) !== Boolean(b.client)) return a.client ? -1 : 1;
    if ((b.client?.score ?? 0) !== (a.client?.score ?? 0)) return (b.client?.score ?? 0) - (a.client?.score ?? 0);
    return a.startAt.localeCompare(b.startAt);
  });
  const opportunities = sorted.filter((item) => {
    if (!item.client) return false;
    if (usedClients.has(item.client.id)) return false;
    usedClients.add(item.client.id);
    return true;
  }).slice(0, 12);

  return {
    generatedAt: new Date().toISOString(),
    timezone: business.timezone,
    days,
    summary: { freeSlots: totalFreeSlots, opportunities: opportunities.length, matchedClients: opportunities.length },
    opportunities,
  };
}
