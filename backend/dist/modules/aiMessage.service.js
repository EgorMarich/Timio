function config() {
    return {
        apiKey: process.env.YANDEXGPT_API_KEY?.trim() || "",
        folderId: process.env.YANDEXGPT_FOLDER_ID?.trim() || "",
        model: process.env.YANDEXGPT_MODEL?.trim() || "",
        baseUrl: (process.env.YANDEXGPT_BASE_URL?.trim() || "https://ai.api.cloud.yandex.net/v1").replace(/\/$/, ""),
    };
}
export function getAiMessageStatus() {
    const c = config();
    return { configured: Boolean(c.apiKey && (c.model || c.folderId)), model: c.model || (c.folderId ? `gpt://${c.folderId}/yandexgpt/latest` : null) };
}
function modelName() {
    const c = config();
    return c.model || (c.folderId ? `gpt://${c.folderId}/yandexgpt/latest` : "");
}
function fallback(input) {
    const name = input.clientName ? `{{clientName}}` : "{{clientName}}";
    const business = "{{businessName}}";
    if (input.language === "en") {
        if (input.purpose === "appointment_reminder")
            return { message: `Hi ${name}! Just a quick reminder about your appointment at ${business}. See you soon!`, provider: "fallback", model: null };
        if (input.offer)
            return { message: `Hi ${name}! We'd love to see you again at ${business}. We have a free slot on ${input.offer.date} at ${input.offer.time}. ${input.offer.bookingUrl ? `Book here: ${input.offer.bookingUrl}` : "Would you like me to reserve it?"}`, provider: "fallback", model: null };
        return { message: `Hi ${name}! We haven't seen you at ${business} for a while. We'd be happy to see you again${input.serviceName ? ` for ${input.serviceName}` : ""}. Would you like to choose a convenient time?`, provider: "fallback", model: null };
    }
    if (input.purpose === "appointment_reminder")
        return { message: `Привет, ${name}! Небольшое напоминание о вашей записи в ${business}. Будем ждать вас 😊`, provider: "fallback", model: null };
    if (input.offer)
        return { message: `Привет, ${name}! Будем рады видеть вас снова в ${business}. Есть свободное окно ${input.offer.date} в ${input.offer.time}. ${input.offer.bookingUrl ? `Записаться: ${input.offer.bookingUrl}` : "Подойдёт это время?"}`, provider: "fallback", model: null };
    return { message: `Привет, ${name}! Давно не виделись в ${business}. Будем рады принять вас снова${input.serviceName ? ` на услугу «${input.serviceName}»` : ""}. Хотите подобрать удобное время?`, provider: "fallback", model: null };
}
function systemPrompt(input) {
    const tone = {
        friendly: "дружелюбный и естественный",
        professional: "профессиональный, спокойный и уважительный",
        warm: "тёплый и заботливый, без навязчивости",
        short: "максимально короткий, 1–2 предложения",
    }[input.tone];
    return [
        "Ты пишешь короткие клиентские сообщения для SaaS-сервиса Timio.",
        `Язык: ${input.language}. Тон: ${tone}. Канал: ${input.channel}.`,
        "Не выдумывай скидки, цены, услуги, даты, факты или обещания. Используй только переданный контекст.",
        "Не упоминай, что сообщение создано ИИ.",
        "Сохраняй плейсхолдеры {{clientName}}, {{businessName}}, {{serviceName}}, {{bookingUrl}}, если они уместны.",
        "Не добавляй тему письма, markdown и пояснения. Верни только готовый текст сообщения.",
        "Если это реактивация — не дави на клиента и не создавай чувство вины.",
        input.draft ? `Черновик пользователя, который нужно улучшить: ${input.draft}` : "",
    ].filter(Boolean).join("\n");
}
export async function generateAiMessage(input) {
    const c = config();
    if (!c.apiKey || !(c.model || c.folderId))
        return fallback(input);
    const model = modelName();
    const response = await fetch(`${c.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Api-Key ${c.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            temperature: 0.55,
            max_tokens: input.channel === "sms" ? 120 : 220,
            messages: [
                { role: "system", content: systemPrompt(input) },
                { role: "user", content: JSON.stringify({
                        businessName: input.businessName,
                        clientName: "{{clientName}}",
                        serviceName: input.serviceName || null,
                        lastVisitAt: input.lastVisitAt || null,
                        purpose: input.purpose,
                        offer: input.offer || null,
                    }) },
            ],
        }),
    });
    const data = await response.json();
    const message = data?.choices?.[0]?.message?.content?.trim();
    if (!response.ok || !message)
        throw new Error(data?.error?.message || `YandexGPT HTTP ${response.status}`);
    return { message, provider: "yandexgpt", model };
}
