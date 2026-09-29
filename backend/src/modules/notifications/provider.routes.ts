import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { businessMembers, clients } from "../../db/schema.js";
import { requireAuth } from "../authMiddleware.js";
import { getTwilioStatus, sendSms, sendWhatsApp } from "./twilio.service.js";
import { getEmailStatus, sendEmail } from "./resend.service.js";

export const providerRoutes = new Hono();
providerRoutes.use("*", requireAuth);

async function assertMember(userId: string, businessId: string) {
  const [membership] = await db.select().from(businessMembers).where(
    and(eq(businessMembers.businessId, businessId), eq(businessMembers.userId, userId)),
  );
  return membership ?? null;
}

providerRoutes.get("/businesses/:id/notification-providers", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  return c.json({
    twilio: getTwilioStatus(),
    email: getEmailStatus(),
  });
});

providerRoutes.post("/businesses/:id/notification-providers/test", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ channel?: "whatsapp" | "sms" | "email"; clientId?: string }>().catch(() => ({}));
  if (!body.channel || !body.clientId) return c.json({ error: "channel_and_client_id_required" }, 400);

  const [client] = await db.select().from(clients).where(and(eq(clients.id, body.clientId), eq(clients.businessId, businessId)));
  if (!client) return c.json({ error: "client_not_found" }, 404);

  try {
    if (body.channel === "email") {
      if (!client.email) return c.json({ error: "client_email_missing" }, 400);
      await sendEmail({
        to: client.email,
        subject: "Timio · тестовое уведомление",
        text: `Здравствуйте, ${client.name}!\n\nЭто тестовое уведомление Timio. Email-канал подключён корректно.`,
      });
    } else if (body.channel === "sms") {
      if (!client.phone) return c.json({ error: "client_phone_missing" }, 400);
      await sendSms(client.phone, `Timio: тестовое SMS-уведомление. Канал подключён корректно, ${client.name}.`);
    } else {
      if (!client.phone) return c.json({ error: "client_phone_missing" }, 400);
      let mapping: Record<string, string> = {};
      try { mapping = JSON.parse(process.env.TWILIO_WHATSAPP_CONTENT_VARIABLES ?? "{}"); } catch { /* invalid config will surface as provider error */ }
      const semantic = { clientName: client.name, time: "Timio test", serviceName: "Timio" };
      const vars = Object.fromEntries(Object.entries(mapping).map(([key, name]) => [key, semantic[name] ?? ""]));
      await sendWhatsApp(client.phone, "Timio test", vars);
    }

    return c.json({ ok: true, channel: body.channel, clientName: client.name });
  } catch (err) {
    return c.json({
      ok: false,
      channel: body.channel,
      error: err instanceof Error ? err.message : "Провайдер не принял сообщение",
    }, 502);
  }
});
