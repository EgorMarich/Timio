const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

function config() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID?.trim() || "",
    authToken: process.env.TWILIO_AUTH_TOKEN?.trim() || "",
    smsFrom: process.env.TWILIO_SMS_FROM?.trim() || "",
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM?.trim() || "",
    whatsappContentSid: process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim() || "",
  };
}

export function getTwilioStatus() {
  const c = config();
  return {
    configured: Boolean(c.accountSid && c.authToken),
    sms: Boolean(c.accountSid && c.authToken && c.smsFrom),
    whatsapp: Boolean(c.accountSid && c.authToken && c.whatsappFrom && c.whatsappContentSid),
    smsFrom: c.smsFrom || null,
    whatsappFrom: c.whatsappFrom || null,
  };
}

async function sendTwilioMessage(params: Record<string, string>) {
  const c = config();
  if (!c.accountSid || !c.authToken) throw new Error("Twilio не настроен: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN");
  const body = new URLSearchParams(params);
  const auth = Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64");
  const res = await fetch(`${TWILIO_API_BASE}/Accounts/${c.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json() as { sid?: string; status?: string; message?: string; code?: number };
  if (!res.ok || !data.sid) throw new Error(data.message ?? `Twilio HTTP ${res.status}`);
  return { sid: data.sid, status: data.status ?? "queued" };
}

export async function sendSms(to: string, body: string) {
  const c = config();
  if (!c.smsFrom) throw new Error("SMS не настроен: TWILIO_SMS_FROM отсутствует");
  return sendTwilioMessage({ From: c.smsFrom, To: to, Body: body });
}

export async function sendWhatsApp(to: string, body: string, variables?: Record<string, string>) {
  const c = config();
  if (!c.whatsappFrom || !c.whatsappContentSid) {
    throw new Error("WhatsApp не настроен: TWILIO_WHATSAPP_FROM/TWILIO_WHATSAPP_CONTENT_SID отсутствуют");
  }

  // Для бизнес-инициированных WhatsApp сообщений используем approved template.
  // Если template содержит {{1}}, {{2}} и т.д., значения берём из variables.
  const contentVariables = variables
    ? Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, v]))
    : undefined;

  return sendTwilioMessage({
    From: `whatsapp:${c.whatsappFrom.replace(/^whatsapp:/, "")}`,
    To: `whatsapp:${to.replace(/^whatsapp:/, "")}`,
    ContentSid: c.whatsappContentSid,
    ...(contentVariables ? { ContentVariables: JSON.stringify(contentVariables) } : {}),
    // Body не передаём: для WhatsApp template delivery контент определяется ContentSid.
    ...(body ? {} : {}),
  });
}
