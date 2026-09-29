import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { publicRoutes } from "./modules/public.routes.js";
import { authRoutes } from "./modules/auth.routes.js";
import { meRoutes } from "./modules/me.routes.js";
import { subscriptionRoutes } from "./modules/subscriptions/subscription.routes.js";
import { promoCodeRoutes } from "./modules/subscriptions/promoCode.routes.js";
import { yookassaWebhookRoutes } from "./modules/subscriptions/webhook.routes.js";
import { startSubscriptionCron } from "./modules/subscriptions/subscriptionCron.js";
import { telegramWebhookRoutes, telegramSettingsRoutes } from "./modules/telegram/telegram.routes.js";
import { startReminderWorker } from "./modules/notifications/reminderWorker.js";
import { providerRoutes } from "./modules/notifications/provider.routes.js";
import { notificationRoutes } from "./modules/notifications/notification.routes.js";
import { requireUuidParams } from "./modules/validateParams.js";
import { startWaitlistWorker } from './modules/waitlist/waitlistWorker.js';
import { db } from './db/client.js';
import { redis } from './db/redis.js';
const app = new Hono();
function assertProductionConfig() {
    if (process.env.NODE_ENV !== "production")
        return;
    const required = [
        "DATABASE_URL",
        "REDIS_URL",
        "CORS_ORIGINS",
        "FRONTEND_URL",
        "RESEND_API_KEY",
        "RESEND_FROM",
    ];
    const missing = required.filter((key) => !process.env[key]?.trim());
    if (missing.length) {
        throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
    }
}
assertProductionConfig();
const allowedOrigins = (process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? "http://localhost:3000")
    .split(",").map((v) => v.trim()).filter(Boolean);
app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && allowedOrigins.includes(origin))
        c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Headers", "Content-Type, Accept-Language, Authorization");
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    // Cookie-authenticated state changes must originate from an allowed frontend.
    // SameSite=Lax remains the primary browser protection; this is an additional server-side check.
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
        const origin = c.req.header("Origin");
        const hasSessionCookie = Boolean(c.req.header("Cookie")?.includes("timio_session=") || c.req.header("Cookie")?.includes("__Host-timio_session="));
        if (hasSessionCookie && origin && !allowedOrigins.includes(origin))
            return c.json({ error: "origin_not_allowed" }, 403);
    }
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (c.req.method === "OPTIONS")
        return c.body(null, 204);
    await next();
});
app.use("/me/businesses/:id/*", requireUuidParams("id"));
app.use("/me/businesses/:id", requireUuidParams("id"));
app.get("/", (c) => c.json({ name: "Timio API", status: "ok", version: "1.0.0" }));
app.get("/health", async (c) => {
    try {
        await db.execute(sql `select 1`);
        await redis.ping();
        return c.json({ status: "ok", database: "ok", redis: "ok" });
    }
    catch {
        return c.json({ status: "degraded", database: "unknown", redis: "unknown" }, 503);
    }
});
app.route("/auth", authRoutes);
app.route("/me", meRoutes);
app.route("/me", subscriptionRoutes);
app.route("/me", promoCodeRoutes);
app.route("/me", telegramSettingsRoutes);
app.route("/me", providerRoutes);
app.route("/me", notificationRoutes);
app.route("/public", publicRoutes);
app.route("/webhooks", yookassaWebhookRoutes);
app.route("/webhooks", telegramWebhookRoutes);
const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, (info) => console.log(`Timio API listening on http://localhost:${info.port}`));
const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down Timio API`);
    server.close();
    await Promise.allSettled([db.$client.end(), redis.quit()]);
    process.exit(0);
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
startSubscriptionCron();
startReminderWorker();
startWaitlistWorker();
