import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { authTokens, users, userIdentities, authAuditEvents } from "../db/schema.js";
import { hashPassword, verifyPassword, randomToken, hashToken, createSession, destroySession, destroyAllUserSessions, getSession, listUserSessions, SESSION_COOKIE } from "./auth.js";
import { sendEmail } from "./notifications/resend.service.js";
import { redis } from "../db/redis.js";
export const authRoutes = new Hono();
const TOKEN_TTL = { emailVerification: 1000 * 60 * 60 * 24, passwordReset: 1000 * 60 * 30 };
function normalizeEmail(email) { return email.trim().toLowerCase(); }
function frontendUrl() { return (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, ""); }
function isProduction() { return process.env.NODE_ENV === "production"; }
function clientIp(c) { return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown"; }
function clientUserAgent(c) { return c.req.header("user-agent")?.slice(0, 1000) ?? undefined; }
async function audit(c, event, userId, metadata) {
    try {
        await db.insert(authAuditEvents).values({ userId: userId ?? null, event, ipAddress: clientIp(c), userAgent: clientUserAgent(c), metadata });
    }
    catch { /* audit must never break auth */ }
}
function passwordIsStrong(password) {
    return password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
function userDto(user) { return { id: user.id, email: user.email, name: user.name, locale: user.locale, status: user.status, emailVerifiedAt: user.emailVerifiedAt }; }
async function rateLimit(key, limit, windowSeconds) {
    const count = await redis.incr(key);
    if (count === 1)
        await redis.expire(key, windowSeconds);
    return count <= limit;
}
function setSessionCookie(c, sessionId) {
    setCookie(c, SESSION_COOKIE, sessionId, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
    });
}
async function issueAuthToken(userId, type, ttl) {
    const raw = randomToken(32);
    await db.insert(authTokens).values({ userId, type, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttl) });
    return raw;
}
async function sendVerificationEmail(user, rawToken) {
    const url = `${frontendUrl()}/verify-email?token=${encodeURIComponent(rawToken)}`;
    await sendEmail({
        to: user.email,
        subject: "Подтвердите email в Timio",
        text: `Здравствуйте, ${user.name}!\n\nПодтвердите email: ${url}\n\nСсылка действует 24 часа.`,
        html: `<p>Здравствуйте, ${escapeHtml(user.name)}!</p><p>Подтвердите email, чтобы активировать аккаунт Timio.</p><p><a href="${escapeHtml(url)}">Подтвердить email</a></p><p>Ссылка действует 24 часа.</p>`,
    });
    return url;
}
function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}
async function oauthConfig(provider) {
    if (provider === "google")
        return {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorize: "https://accounts.google.com/o/oauth2/v2/auth",
            token: "https://oauth2.googleapis.com/token",
            redirect: `${process.env.API_PUBLIC_URL ?? process.env.FRONTEND_URL ?? "http://localhost:8787"}/auth/oauth/google/callback`,
        };
    return {
        clientId: process.env.VK_CLIENT_ID,
        clientSecret: process.env.VK_CLIENT_SECRET,
        authorize: "https://id.vk.com/authorize",
        token: "https://id.vk.com/oauth2/auth",
        redirect: `${process.env.API_PUBLIC_URL ?? process.env.FRONTEND_URL ?? "http://localhost:8787"}/auth/oauth/vk/callback`,
    };
}
async function startOAuth(c, provider) {
    const cfg = await oauthConfig(provider);
    if (!cfg.clientId)
        return c.json({ error: "oauth_not_configured", provider }, 503);
    const state = randomToken(24);
    await redis.set(`oauth:state:${hashToken(state)}`, JSON.stringify({ provider }), "EX", 600);
    const params = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirect, response_type: "code", state });
    if (provider === "google")
        params.set("scope", "openid email profile");
    else {
        params.set("scope", "email phone");
    }
    return c.redirect(`${cfg.authorize}?${params.toString()}`);
}
async function finishOAuth(c, provider) {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state)
        return c.redirect(`${frontendUrl()}/login?error=oauth_invalid`);
    const stateKey = `oauth:state:${hashToken(state)}`;
    const stateData = await redis.get(stateKey);
    await redis.del(stateKey);
    if (!stateData)
        return c.redirect(`${frontendUrl()}/login?error=oauth_state`);
    const cfg = await oauthConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret)
        return c.redirect(`${frontendUrl()}/login?error=oauth_not_configured`);
    let identity;
    if (provider === "google") {
        const tokenRes = await fetch(cfg.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirect, grant_type: "authorization_code" }) });
        const token = await tokenRes.json();
        if (!tokenRes.ok || !token.access_token)
            return c.redirect(`${frontendUrl()}/login?error=oauth_token`);
        const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
        const info = await infoRes.json();
        if (!infoRes.ok || !info.sub || !info.email)
            return c.redirect(`${frontendUrl()}/login?error=oauth_profile`);
        identity = { providerUserId: String(info.sub), email: normalizeEmail(info.email), name: info.name || info.email.split("@")[0] };
    }
    else {
        const tokenRes = await fetch(cfg.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirect }) });
        const token = await tokenRes.json();
        const accessToken = token.access_token;
        if (!tokenRes.ok || !accessToken)
            return c.redirect(`${frontendUrl()}/login?error=oauth_token`);
        const infoRes = await fetch("https://id.vk.com/oauth2/user_info", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${accessToken}` }, body: new URLSearchParams({ client_id: cfg.clientId }) });
        const info = await infoRes.json();
        const profile = info.user ?? info;
        if (!infoRes.ok || !profile.user_id)
            return c.redirect(`${frontendUrl()}/login?error=oauth_profile`);
        identity = { providerUserId: String(profile.user_id), email: profile.email ? normalizeEmail(profile.email) : undefined, name: [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Timio user" };
    }
    let [linked] = await db.select().from(userIdentities).where(and(eq(userIdentities.provider, provider), eq(userIdentities.providerUserId, identity.providerUserId)));
    let user;
    if (linked) {
        [user] = await db.select().from(users).where(eq(users.id, linked.userId));
    }
    else if (identity.email) {
        [user] = await db.select().from(users).where(eq(users.email, identity.email));
        if (!user) {
            [user] = await db.insert(users).values({ email: identity.email, passwordHash: null, name: identity.name, status: "active", emailVerifiedAt: new Date(), locale: "en", lastLoginAt: new Date() }).returning();
        }
        else if (user.status === "pending_email_verification") {
            [user] = await db.update(users).set({ status: "active", emailVerifiedAt: new Date() }).where(eq(users.id, user.id)).returning();
        }
        await db.insert(userIdentities).values({ userId: user.id, provider, providerUserId: identity.providerUserId, providerEmail: identity.email });
    }
    else {
        return c.redirect(`${frontendUrl()}/login?error=oauth_email_required`);
    }
    if (!user || user.status === "suspended" || user.status === "deleted")
        return c.redirect(`${frontendUrl()}/login?error=account_unavailable`);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const session = await createSession(user.id, { ipAddress: clientIp(c), userAgent: clientUserAgent(c) });
    setSessionCookie(c, session);
    await audit(c, "oauth_login_success", user.id, { provider });
    return c.redirect(`${frontendUrl()}/app`);
}
authRoutes.post("/register", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!(await rateLimit(`auth:register:${ip}`, 10, 900)))
        return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json();
    const email = normalizeEmail(body.email ?? "");
    if (!email || !body.password || !passwordIsStrong(body.password) || !body.name?.trim())
        return c.json({ error: "invalid_input", message: "Email, name and password (10+ chars, letters and numbers) are required" }, 400);
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing)
        return c.json({ error: "email_taken" }, 409);
    const [user] = await db.insert(users).values({ email, passwordHash: hashPassword(body.password), name: body.name.trim(), locale: body.locale ?? "en", status: "pending_email_verification" }).returning();
    const token = await issueAuthToken(user.id, "email_verification", TOKEN_TTL.emailVerification);
    try {
        const devVerificationUrl = await sendVerificationEmail(user, token);
        return c.json({ verificationRequired: true, user: userDto(user), ...(isProduction() ? {} : { devVerificationUrl }) });
    }
    catch {
        if (isProduction())
            return c.json({ error: "email_delivery_failed" }, 503);
        return c.json({ verificationRequired: true, user: userDto(user), devVerificationUrl: `${frontendUrl()}/verify-email?token=${encodeURIComponent(token)}`, emailConfigured: false });
    }
});
authRoutes.post("/login", async (c) => {
    const ip = clientIp(c);
    if (!(await rateLimit(`auth:login:ip:${ip}`, 20, 900)))
        return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json();
    const email = normalizeEmail(body.email ?? "");
    if (!(await rateLimit(`auth:login:email:${hashToken(email)}`, 8, 900)))
        return c.json({ error: "rate_limited" }, 429);
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || !verifyPassword(body.password ?? "", user.passwordHash)) {
        await audit(c, "login_failed", user?.id, { reason: "invalid_credentials" });
        return c.json({ error: "invalid_credentials" }, 401);
    }
    if (user.status === "pending_email_verification")
        return c.json({ error: "email_not_verified" }, 403);
    if (user.status !== "active")
        return c.json({ error: "account_unavailable" }, 403);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const session = await createSession(user.id, { ipAddress: clientIp(c), userAgent: clientUserAgent(c) });
    setSessionCookie(c, session);
    await audit(c, "login_success", user.id);
    return c.json({ user: userDto(user) });
});
authRoutes.post("/logout", async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    const session = sessionId ? await getSession(sessionId) : null;
    if (sessionId)
        await destroySession(sessionId);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    if (session)
        await audit(c, "logout", session.userId);
    return c.json({ ok: true });
});
authRoutes.get("/me", async (c) => {
    const session = getCookie(c, SESSION_COOKIE);
    if (!session)
        return c.json({ error: "unauthorized" }, 401);
    const raw = await import("./auth.js").then(m => m.getSessionUserId(session));
    if (!raw)
        return c.json({ error: "unauthorized" }, 401);
    const [user] = await db.select().from(users).where(eq(users.id, raw));
    if (!user || user.status !== "active")
        return c.json({ error: "unauthorized" }, 401);
    return c.json({ user: userDto(user) });
});
authRoutes.post("/verify-email", async (c) => {
    const body = await c.req.json();
    if (!body.token)
        return c.json({ error: "invalid_token" }, 400);
    const [row] = await db.select().from(authTokens).where(and(eq(authTokens.type, "email_verification"), eq(authTokens.tokenHash, hashToken(body.token)), gt(authTokens.expiresAt, new Date()), isNull(authTokens.usedAt)));
    if (!row)
        return c.json({ error: "invalid_or_expired_token" }, 400);
    const [user] = await db.update(users).set({ status: "active", emailVerifiedAt: new Date() }).where(eq(users.id, row.userId)).returning();
    await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
    await audit(c, "email_verified", user.id);
    return c.json({ user: userDto(user) });
});
authRoutes.post("/resend-verification", async (c) => {
    const body = await c.req.json();
    const email = normalizeEmail(body.email ?? "");
    if (!(await rateLimit(`auth:verify-resend:${hashToken(email)}`, 3, 900)))
        return c.json({ ok: true });
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || user.status !== "pending_email_verification")
        return c.json({ ok: true });
    const token = await issueAuthToken(user.id, "email_verification", TOKEN_TTL.emailVerification);
    try {
        const devVerificationUrl = await sendVerificationEmail(user, token);
        return c.json({ ok: true, ...(isProduction() ? {} : { devVerificationUrl }) });
    }
    catch {
        if (isProduction())
            return c.json({ ok: true });
        return c.json({ ok: true, devVerificationUrl: `${frontendUrl()}/verify-email?token=${encodeURIComponent(token)}` });
    }
});
authRoutes.post("/request-password-reset", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!(await rateLimit(`auth:reset:${ip}`, 10, 900)))
        return c.json({ ok: true });
    const body = await c.req.json();
    const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(body.email ?? "")));
    if (user && user.status !== "deleted") {
        const token = await issueAuthToken(user.id, "password_reset", TOKEN_TTL.passwordReset);
        const url = `${frontendUrl()}/reset-password?token=${encodeURIComponent(token)}`;
        try {
            await sendEmail({ to: user.email, subject: "Сброс пароля Timio", text: `Сбросьте пароль: ${url}\nСсылка действует 30 минут.` });
        }
        catch { /* generic response */ }
        if (!isProduction())
            return c.json({ ok: true, devResetUrl: url });
    }
    return c.json({ ok: true });
});
authRoutes.post("/reset-password", async (c) => {
    const body = await c.req.json();
    if (!body.token || !body.password || !passwordIsStrong(body.password))
        return c.json({ error: "invalid_input", message: "Password must be 10+ chars and contain letters and numbers" }, 400);
    const [row] = await db.select().from(authTokens).where(and(eq(authTokens.type, "password_reset"), eq(authTokens.tokenHash, hashToken(body.token)), gt(authTokens.expiresAt, new Date()), isNull(authTokens.usedAt)));
    if (!row)
        return c.json({ error: "invalid_or_expired_token" }, 400);
    await db.update(users).set({ passwordHash: hashPassword(body.password) }).where(eq(users.id, row.userId));
    await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
    await destroyAllUserSessions(row.userId);
    await audit(c, "password_reset", row.userId);
    return c.json({ ok: true });
});
authRoutes.get("/audit-events", async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    const session = sessionId ? await getSession(sessionId) : null;
    if (!session)
        return c.json({ error: "unauthorized" }, 401);
    const rows = await db.select({ id: authAuditEvents.id, event: authAuditEvents.event, ipAddress: authAuditEvents.ipAddress, userAgent: authAuditEvents.userAgent, metadata: authAuditEvents.metadata, createdAt: authAuditEvents.createdAt })
        .from(authAuditEvents).where(eq(authAuditEvents.userId, session.userId)).orderBy(desc(authAuditEvents.createdAt)).limit(50);
    return c.json({ events: rows });
});
authRoutes.get("/sessions", async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    const current = sessionId ? await getSession(sessionId) : null;
    if (!current)
        return c.json({ error: "unauthorized" }, 401);
    const rows = await listUserSessions(current.userId);
    return c.json({ sessions: rows.map(({ id, session }) => ({
            id,
            current: id === sessionId,
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
            ipAddress: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
        })) });
});
authRoutes.delete("/sessions/:sessionId", async (c) => {
    const currentId = getCookie(c, SESSION_COOKIE);
    const current = currentId ? await getSession(currentId) : null;
    if (!current)
        return c.json({ error: "unauthorized" }, 401);
    const targetId = c.req.param("sessionId");
    const rows = await listUserSessions(current.userId);
    const target = rows.find(row => row.id === targetId);
    if (!target)
        return c.json({ error: "session_not_found" }, 404);
    await destroySession(targetId);
    await audit(c, "session_revoked", current.userId, { current: targetId === currentId });
    if (targetId === currentId)
        deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true, current: targetId === currentId });
});
authRoutes.post("/sessions/revoke-others", async (c) => {
    const currentId = getCookie(c, SESSION_COOKIE);
    const current = currentId ? await getSession(currentId) : null;
    if (!current)
        return c.json({ error: "unauthorized" }, 401);
    const rows = await listUserSessions(current.userId);
    let revoked = 0;
    for (const row of rows)
        if (row.id !== currentId) {
            await destroySession(row.id);
            revoked++;
        }
    await audit(c, "sessions_revoked_others", current.userId, { count: revoked });
    return c.json({ ok: true, revoked });
});
authRoutes.post("/change-password", async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (!(await rateLimit(`auth:password-change:${clientIp(c)}`, 10, 900)))
        return c.json({ error: "rate_limited" }, 429);
    const session = sessionId ? await getSession(sessionId) : null;
    if (!session)
        return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json();
    if (!passwordIsStrong(body.newPassword ?? ""))
        return c.json({ error: "invalid_input", message: "Password must be 10+ chars and contain letters and numbers" }, 400);
    const [user] = await db.select().from(users).where(eq(users.id, session.userId));
    if (!user || !verifyPassword(body.currentPassword ?? "", user.passwordHash)) {
        await audit(c, "password_change_failed", session.userId, { reason: "invalid_current_password" });
        return c.json({ error: "invalid_current_password" }, 400);
    }
    if (verifyPassword(body.newPassword, user.passwordHash))
        return c.json({ error: "password_reused" }, 400);
    await db.update(users).set({ passwordHash: hashPassword(body.newPassword) }).where(eq(users.id, user.id));
    await destroyAllUserSessions(user.id);
    const nextSession = await createSession(user.id, { ipAddress: clientIp(c), userAgent: clientUserAgent(c) });
    setSessionCookie(c, nextSession);
    await audit(c, "password_changed", user.id);
    return c.json({ ok: true });
});
authRoutes.post("/request-email-change", async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (!(await rateLimit(`auth:email-change:${clientIp(c)}`, 5, 900)))
        return c.json({ error: "rate_limited" }, 429);
    const session = sessionId ? await getSession(sessionId) : null;
    if (!session)
        return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json();
    const email = normalizeEmail(body.email ?? "");
    if (!email || !/^\S+@\S+\.\S+$/.test(email))
        return c.json({ error: "invalid_email" }, 400);
    const [user] = await db.select().from(users).where(eq(users.id, session.userId));
    if (!user)
        return c.json({ error: "unauthorized" }, 401);
    if (email === user.email)
        return c.json({ error: "same_email" }, 400);
    const [taken] = await db.select().from(users).where(eq(users.email, email));
    if (taken)
        return c.json({ error: "email_taken" }, 409);
    const token = await issueAuthToken(user.id, "email_change", TOKEN_TTL.emailVerification);
    const url = `${frontendUrl()}/confirm-email-change?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    try {
        await sendEmail({ to: email, subject: "Подтвердите новый email в Timio", text: `Подтвердите новый email: ${url}\\nСсылка действует 24 часа.` });
    }
    catch {
        if (isProduction())
            return c.json({ error: "email_delivery_failed" }, 503);
    }
    await redis.set(`auth:email-change:${hashToken(token)}`, email, "EX", 86400);
    await audit(c, "email_change_requested", user.id, { target: email });
    return c.json({ ok: true, ...(isProduction() ? {} : { devConfirmUrl: url }) });
});
authRoutes.post("/confirm-email-change", async (c) => {
    const body = await c.req.json();
    if (!body.token)
        return c.json({ error: "invalid_or_expired_token" }, 400);
    const [row] = await db.select().from(authTokens).where(and(eq(authTokens.type, "email_change"), eq(authTokens.tokenHash, hashToken(body.token)), gt(authTokens.expiresAt, new Date()), isNull(authTokens.usedAt)));
    if (!row)
        return c.json({ error: "invalid_or_expired_token" }, 400);
    const email = await redis.get(`auth:email-change:${hashToken(body.token)}`);
    if (!email)
        return c.json({ error: "invalid_or_expired_token" }, 400);
    const [taken] = await db.select().from(users).where(eq(users.email, email));
    if (taken && taken.id !== row.userId)
        return c.json({ error: "email_taken" }, 409);
    await db.update(users).set({ email, emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
    await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
    await redis.del(`auth:email-change:${hashToken(body.token)}`);
    await destroyAllUserSessions(row.userId);
    const nextSession = await createSession(row.userId, { ipAddress: clientIp(c), userAgent: clientUserAgent(c) });
    setSessionCookie(c, nextSession);
    await audit(c, "email_changed", row.userId, { target: email });
    return c.json({ ok: true });
});
authRoutes.get("/oauth/:provider", async (c) => {
    const provider = c.req.param("provider");
    if (provider !== "google" && provider !== "vk")
        return c.json({ error: "unsupported_provider" }, 400);
    return startOAuth(c, provider);
});
authRoutes.get("/oauth/:provider/callback", async (c) => {
    const provider = c.req.param("provider");
    if (provider !== "google" && provider !== "vk")
        return c.json({ error: "unsupported_provider" }, 400);
    return finishOAuth(c, provider);
});
