import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { clients, messageTemplates, notificationLogs, businesses, businessNotificationSettings } from "../db/schema.js";
import { scheduleReminder } from "../db/redis.js";
import { DEFAULT_LOCALE, type NotificationChannel } from "../types.js";
import { sendTelegramMessage } from "./telegram/telegram.service.js";
import { getTwilioStatus, sendSms, sendWhatsApp } from "./notifications/twilio.service.js";
import { getEmailStatus, sendEmail } from "./notifications/resend.service.js";

export interface DispatchResult {
  channel: NotificationChannel;
  attempted: NotificationChannel[];
  renderedText: string;
  locale: string;
  status: "sent" | "failed_all_channels";
  // Реальный результат доставки (только для каналов с настоящей интеграцией -
  // сейчас это только Telegram). Для остальных каналов - "simulated": интеграция
  // ещё не подключена, см. комментарий у isChannelAvailable ниже.
  delivery: "delivered" | "failed" | "simulated";
}

type ClientRow = typeof clients.$inferSelect;

// Заглушки "здоровья" канала - в проде реальные health-check'и провайдеров.
function isChannelAvailable(client: ClientRow, channel: NotificationChannel): boolean {
  switch (channel) {
    case "telegram":
      return Boolean(client.telegramChatId);
    case "whatsapp":
      return Boolean(client.phone && getTwilioStatus().whatsapp);
    case "sms":
      return Boolean(client.phone && getTwilioStatus().sms);
    case "email":
      return Boolean(client.email && getEmailStatus().configured);
    case "viber":
    case "messenger":
    default:
      return false;
  }
}

export function resolveChannel(
  client: ClientRow,
  priority: NotificationChannel[]
): { channel: NotificationChannel | null; attempted: NotificationChannel[] } {
  const attempted: NotificationChannel[] = [];
  const order = client.preferredChannel
    ? [client.preferredChannel as NotificationChannel, ...priority.filter((c) => c !== client.preferredChannel)]
    : priority;

  for (const channel of order) {
    attempted.push(channel);
    if (isChannelAvailable(client, channel)) return { channel, attempted };
  }
  return { channel: null, attempted };
}

export function renderTemplate(
  translations: Record<string, string>,
  locale: string,
  vars: Record<string, string>
): { text: string; usedLocale: string } {
  const usedLocale = translations[locale] ? locale : DEFAULT_LOCALE;
  const text = (translations[usedLocale] ?? "").replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
  return { text, usedLocale };
}

function getEventFromTemplateType(templateType: string): string {
  const eventMap: Record<string, string> = {
    'appointment.created': 'appointment.created',
    'appointment.confirmed': 'appointment.confirmed',
    'appointment.cancelled': 'appointment.cancelled',
    'appointment.rescheduled': 'appointment.rescheduled',
    'appointment.reminder.24h': 'appointment.reminder.24h',
    'appointment.reminder.3h': 'appointment.reminder.3h',
    'appointment.reminder.15m': 'appointment.reminder.15m',
    'visit.completed': 'visit.completed',
    'review.request': 'review.request',
    'waitlist.invite': 'waitlist.invite',
    'waitlist.expired': 'waitlist.expired',
    'waitlist.confirmed': 'waitlist.confirmed',
  };
  return eventMap[templateType] || 'appointment.created';
}


/**
 * Резолвит канал + рендерит текст НА ЯЗЫКЕ КЛИЕНТА (client.detectedLocale), логирует
 * попытку в notification_logs и РЕАЛЬНО отправляет сообщение, если для канала
 * подключена настоящая интеграция (сейчас - только Telegram, через собственного
 * бота бизнеса). Остальные каналы сейчас считаются недоступными и НЕ
 * помечаются как отправленные, пока реальный провайдер не подключён.
 */
export async function dispatchNotification(params: {
  businessId: string;
  clientId: string;
  templateType: string;
  channelPriority: NotificationChannel[];
  telegramBotToken?: string | null;
  vars: Record<string, string>;
  appointmentId?: string;
  event?: import("../db/schema.js").NotificationEvent;
}): Promise<DispatchResult | null> {
  const [client] = await db.select().from(clients).where(eq(clients.id, params.clientId));
  const [business] = await db.select().from(businesses).where(eq(businesses.id, params.businessId));
  if (!business) return null;
  const event = params.event ?? getEventFromTemplateType(params.templateType);
  const [eventSettings] = await db.select().from(businessNotificationSettings).where(and(eq(businessNotificationSettings.businessId, params.businessId), eq(businessNotificationSettings.event, event)));
  if (eventSettings && !eventSettings.enabled) return null;
  const configuredPriority = (eventSettings?.channels?.length ? eventSettings.channels : business.channelPriority) as NotificationChannel[];
  const [template] = await db
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.businessId, params.businessId), eq(messageTemplates.type, params.templateType)));
  if (!client || !template) return null;

  const effectivePriority = configuredPriority.length ? configuredPriority : params.channelPriority;
  const attempted = client.preferredChannel
    ? [client.preferredChannel as NotificationChannel, ...effectivePriority.filter((c) => c !== client.preferredChannel)]
    : [...effectivePriority];
  const channel = attempted.find((candidate) => isChannelAvailable(client, candidate)) ?? null;
  const { text, usedLocale } = renderTemplate(template.translations, client.detectedLocale, params.vars);

  let delivery: DispatchResult["delivery"] = "simulated";
  let status: DispatchResult["status"] = channel ? "sent" : "failed_all_channels";
  let error: string | undefined;
  let selectedChannel: NotificationChannel | null = channel;

  // Provider fallback: a configured channel may still reject a message (expired
  // token, invalid WhatsApp template, blocked Telegram bot, provider outage).
  // In that case try the next usable channel instead of stopping at the first
  // configured option. Every attempted channel remains visible in the log.
  const candidates = attempted.filter((candidate) => isChannelAvailable(client, candidate));
  for (const candidate of candidates) {
    selectedChannel = candidate;
    try {
      if (candidate === "telegram") {
        if (!params.telegramBotToken || !client.telegramChatId) throw new Error("Telegram не подключён для этого клиента или бизнеса");
        const sendResult = await sendTelegramMessage(params.telegramBotToken, client.telegramChatId, text);
        if (!sendResult.ok) throw new Error(sendResult.description ?? "Telegram не принял сообщение");
      } else if (candidate === "whatsapp") {
        const mapping = (() => { try { return JSON.parse(process.env.TWILIO_WHATSAPP_CONTENT_VARIABLES ?? "{}"); } catch { return {}; } })() as Record<string, string>;
        const variables = Object.fromEntries(Object.entries(mapping).map(([key, variableName]) => [key, params.vars[variableName] ?? ""]));
        await sendWhatsApp(client.phone!, text, variables);
      } else if (candidate === "sms") {
        await sendSms(client.phone!, text);
      } else if (candidate === "email") {
        await sendEmail({ to: client.email!, subject: params.vars.serviceName ? `Timio · ${params.vars.serviceName}` : "Timio · Напоминание о записи", text });
      } else {
        throw new Error(`Провайдер канала ${candidate} ещё не подключён`);
      }

      delivery = "delivered";
      status = "sent";
      error = undefined;
      break;
    } catch (err) {
      error = err instanceof Error ? err.message : `Канал ${candidate} не принял сообщение`;
      delivery = "failed";
      status = "failed_all_channels";
    }
  }

  if (!channel) {
    selectedChannel = attempted[0] ?? "sms";
    error = "Нет доступного канала доставки для клиента";
  }

  const result: DispatchResult = {
    channel: selectedChannel ?? "sms",
    attempted,
    renderedText: text,
    locale: usedLocale,
    status,
    delivery,
  };

  await db.insert(notificationLogs).values({
    clientId: client.id,
    appointmentId: params.appointmentId,
    channel: selectedChannel ?? "sms",
    attemptedChannels: attempted,
    status: result.status,
    renderedText: result.renderedText,
    locale: result.locale,
    event,
    error,
    sentAt: delivery === "delivered" ? new Date() : undefined,
  });

  return result;
}

/** Ставит в Redis-очередь отложенные напоминания по гибким сценариям (раздел 14 спецификации). */
export async function scheduleAppointmentReminders(appointmentId: string, startAtISO: string) {
  const startAt = new Date(startAtISO).getTime();
  const offsets = [
    { kind: "reminder_24h", ms: 24 * 60 * 60 * 1000 },
    { kind: "reminder_3h", ms: 3 * 60 * 60 * 1000 },
    { kind: "reminder_15m", ms: 15 * 60 * 1000 },
  ];
  for (const offset of offsets) {
    const fireAt = startAt - offset.ms;
    if (fireAt > Date.now()) {
      await scheduleReminder({ appointmentId, fireAt, kind: offset.kind });
    }
  }
}
