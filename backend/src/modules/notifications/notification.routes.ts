import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { businessMembers, businessNotificationSettings, clients, notificationLogs } from "../../db/schema.js";
import { requireAuth } from "../authMiddleware.js";
import { NotificationModule } from "./notification.module.js";

export const notificationRoutes = new Hono();
notificationRoutes.use("*", requireAuth);

const notifications = new NotificationModule().notifications;

async function assertMember(userId: string, businessId: string) {
  const [membership] = await db.select().from(businessMembers).where(
    and(eq(businessMembers.businessId, businessId), eq(businessMembers.userId, userId)),
  );
  return membership ?? null;
}

notificationRoutes.get("/businesses/:id/notifications", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);
  return c.json(await notifications.getBusinessSettings(businessId));
});

notificationRoutes.patch("/businesses/:id/notifications", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ event: string; enabled: boolean; channels: string[] }[]>().catch(() => null);
  if (!Array.isArray(body) || body.length === 0) return c.json({ error: "invalid_input" }, 400);

  const allowedEvents = new Set([
    "appointment.created", "appointment.confirmed", "appointment.cancelled",
    "appointment.rescheduled", "appointment.reminder.24h", "appointment.reminder.3h",
    "appointment.reminder.15m", "visit.completed", "review.request", "waitlist.invite",
    "waitlist.expired", "waitlist.confirmed",
  ]);
  const allowedChannels = new Set(["telegram", "whatsapp", "viber", "messenger", "sms", "email"]);

  for (const item of body) {
    if (!item || typeof item.event !== "string" || !allowedEvents.has(item.event) ||
        typeof item.enabled !== "boolean" || !Array.isArray(item.channels) ||
        item.channels.some((channel) => typeof channel !== "string" || !allowedChannels.has(channel))) {
      return c.json({ error: "invalid_input", message: "Invalid notification event or channel" }, 400);
    }
  }

  await notifications.updateBusinessSettings(businessId, body as any);
  return c.json({ success: true });
});

notificationRoutes.get("/businesses/:id/notifications/logs", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const rows = await db
    .select({
      id: notificationLogs.id,
      clientId: notificationLogs.clientId,
      clientName: clients.name,
      appointmentId: notificationLogs.appointmentId,
      event: notificationLogs.event,
      channel: notificationLogs.channel,
      attemptedChannels: notificationLogs.attemptedChannels,
      status: notificationLogs.status,
      scheduledAt: notificationLogs.scheduledAt,
      sentAt: notificationLogs.sentAt,
      retryCount: notificationLogs.retryCount,
      error: notificationLogs.error,
      locale: notificationLogs.locale,
    })
    .from(notificationLogs)
    .innerJoin(clients, eq(clients.id, notificationLogs.clientId))
    .where(eq(clients.businessId, businessId))
    .orderBy(desc(notificationLogs.sentAt))
    .limit(50);

  return c.json({ logs: rows });
});

