// НОВЫЙ ФАЙЛ (модуль уведомлений)

import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { businesses, businessMembers, clients, notificationLogs } from "../../db/schema.js";
import { requireAuth } from "../authMiddleware.js";
import { sendTelegramMessage, verifyTelegramBotToken } from "./telegram.service.js";
import { registerTelegramWebhook, unregisterTelegramWebhook } from "./telegramWebhookRegistration.js";

// ---------- Публичный webhook (без авторизации - вызывается Telegram-серверами) ----------

export const telegramWebhookRoutes = new Hono();

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
}

// POST /webhooks/telegram/:businessId
// Ловит команду "/start <clientId>" из deep-link (см. buildTelegramConnectLink) и
// сохраняет chat.id клиента - после этого уведомления реально начинают уходить в Telegram.
telegramWebhookRoutes.post("/telegram/:businessId", async (c) => {
  const businessId = c.req.param("businessId");
  const update = await c.req.json<TelegramUpdate>().catch(() => null);

  const text = update?.message?.text;
  const chatId = update?.message?.chat?.id;
  if (!text || chatId == null) return c.json({ ok: true }); // не сообщение с текстом - игнорируем, Telegram не должен ретраить

  const match = text.match(/^\/start\s+(\S+)$/);
  if (!match) return c.json({ ok: true });

  const clientId = match[1];
  await db
    .update(clients)
    .set({ telegramChatId: String(chatId) })
    .where(and(eq(clients.id, clientId), eq(clients.businessId, businessId)));

  return c.json({ ok: true });
});

// ---------- Настройки бота владельцем бизнеса ----------

export const telegramSettingsRoutes = new Hono();
telegramSettingsRoutes.use("*", requireAuth);

async function assertMember(userId: string, businessId: string) {
  const [membership] = await db
    .select()
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.userId, userId)));
  return membership ?? null;
}

// GET /me/businesses/:id/telegram - статус подключения (без самого токена в ответе)
telegramSettingsRoutes.get("/businesses/:id/telegram", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  if (!(await assertMember(userId, businessId))) return c.json({ error: "forbidden" }, 403);

  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business) return c.json({ error: "not_found" }, 404);

  return c.json({
    connected: Boolean(business.telegramBotToken),
    botUsername: business.telegramBotUsername,
  });
});

// PATCH /me/businesses/:id/telegram { botToken }
// Проверяет токен через getMe, сохраняет его и пытается зарегистрировать webhook.
telegramSettingsRoutes.patch("/businesses/:id/telegram", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const membership = await assertMember(userId, businessId);
  if (!membership) return c.json({ error: "forbidden" }, 403);
  if (membership.role !== "owner") return c.json({ error: "only_owner_can_manage_integrations" }, 403);

  const body = await c.req.json<{ botToken: string }>();
  if (!body.botToken?.trim()) return c.json({ error: "bot_token_required" }, 400);

  const info = await verifyTelegramBotToken(body.botToken.trim());
  if (!info.ok) {
    return c.json({ error: "invalid_bot_token", message: info.error ?? "Токен недействителен" }, 400);
  }

  await db
    .update(businesses)
    .set({ telegramBotToken: body.botToken.trim(), telegramBotUsername: info.username })
    .where(eq(businesses.id, businessId));

  const webhookResult = await registerTelegramWebhook(body.botToken.trim(), businessId);

  return c.json({
    connected: true,
    botUsername: info.username,
    webhookRegistered: webhookResult.ok,
    webhookWarning: webhookResult.ok ? undefined : webhookResult.error,
  });
});


// POST /me/businesses/:id/telegram/test — отправить реальное тестовое сообщение
// выбранному подключённому клиенту. Это позволяет проверить всю цепочку без
// ожидания ближайшего reminder.
telegramSettingsRoutes.post("/businesses/:id/telegram/test", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const membership = await assertMember(userId, businessId);
  if (!membership) return c.json({ error: "forbidden" }, 403);

  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business?.telegramBotToken) return c.json({ error: "telegram_not_connected" }, 400);

  const body = await c.req.json<{ clientId?: string }>().catch(() => ({}));
  if (!body.clientId) return c.json({ error: "client_id_required" }, 400);
  const [client] = await db.select().from(clients).where(and(eq(clients.id, body.clientId), eq(clients.businessId, businessId)));
  if (!client) return c.json({ error: "client_not_found" }, 404);
  if (!client.telegramChatId) return c.json({ error: "client_telegram_not_connected" }, 400);

  const message = `Timio: тестовое уведомление\n\nTelegram подключён корректно. Клиент ${client.name} сможет получать напоминания о визитах.`;
  const result = await sendTelegramMessage(business.telegramBotToken, client.telegramChatId, message);

  return c.json({
    ok: result.ok,
    status: result.ok ? "sent" : "failed",
    description: result.description,
    clientName: client.name,
  }, result.ok ? 200 : 502);
});

// GET /me/businesses/:id/notifications/logs — последние попытки доставки.
telegramSettingsRoutes.get("/businesses/:id/notifications/logs", async (c) => {
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
    .orderBy(desc(notificationLogs.scheduledAt), desc(notificationLogs.sentAt))
    .limit(50);

  return c.json({ logs: rows });
});

// DELETE /me/businesses/:id/telegram - отключить бота
telegramSettingsRoutes.delete("/businesses/:id/telegram", async (c) => {
  const userId = c.get("userId") as string;
  const businessId = c.req.param("id");
  const membership = await assertMember(userId, businessId);
  if (!membership) return c.json({ error: "forbidden" }, 403);
  if (membership.role !== "owner") return c.json({ error: "only_owner_can_manage_integrations" }, 403);

  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (business?.telegramBotToken) await unregisterTelegramWebhook(business.telegramBotToken);

  await db
    .update(businesses)
    .set({ telegramBotToken: null, telegramBotUsername: null })
    .where(eq(businesses.id, businessId));

  return c.json({ connected: false });
});
