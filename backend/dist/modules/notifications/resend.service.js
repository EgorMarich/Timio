const RESEND_API = "https://api.resend.com/emails";
function config() {
    return {
        apiKey: process.env.RESEND_API_KEY?.trim() || "",
        from: process.env.RESEND_FROM?.trim() || "",
    };
}
export function getEmailStatus() {
    const c = config();
    return { configured: Boolean(c.apiKey && c.from), from: c.from || null };
}
export async function sendEmail(params) {
    const c = config();
    if (!c.apiKey || !c.from)
        throw new Error("Email не настроен: RESEND_API_KEY/RESEND_FROM отсутствуют");
    const res = await fetch(RESEND_API, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${c.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from: c.from,
            to: [params.to],
            subject: params.subject,
            text: params.text,
            html: params.html ?? `<p>${params.text.replace(/\n/g, "<br>")}</p>`,
        }),
    });
    const data = await res.json();
    if (!res.ok || !data.id)
        throw new Error(data.message ?? `Resend HTTP ${res.status}`);
    return { id: data.id };
}
