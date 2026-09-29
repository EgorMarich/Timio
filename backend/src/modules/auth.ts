import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { redis } from "../db/redis.js";

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-timio_session" : "timio_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, derived] = stored.split(":");
  if (!salt || !derived) return false;
  const check = scryptSync(password, salt, 64);
  const original = Buffer.from(derived, "hex");
  return original.length === check.length && timingSafeEqual(original, check);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionKey(sessionId: string) {
  return `auth:session:${hashToken(sessionId)}`;
}

function userSessionsKey(userId: string) {
  return `auth:user-sessions:${userId}`;
}

export interface SessionMeta {
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function createSession(userId: string, meta: { ipAddress?: string; userAgent?: string } = {}): Promise<string> {
  const sessionId = randomToken(32);
  const now = new Date().toISOString();
  const value: SessionMeta = { userId, createdAt: now, lastSeenAt: now, ...meta };
  await redis.set(sessionKey(sessionId), JSON.stringify(value), "EX", SESSION_TTL_SECONDS);
  await redis.sadd(userSessionsKey(userId), sessionId);
  await redis.expire(userSessionsKey(userId), SESSION_TTL_SECONDS);
  return sessionId;
}

export async function getSession(sessionId: string): Promise<SessionMeta | null> {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) return null;
  try { return JSON.parse(raw) as SessionMeta; } catch { return null; }
}

export async function getSessionUserId(sessionId: string): Promise<string | null> {
  return (await getSession(sessionId))?.userId ?? null;
}

export async function touchSession(sessionId: string): Promise<SessionMeta | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const now = new Date().toISOString();
  const updated = { ...session, lastSeenAt: now };
  await redis.set(sessionKey(sessionId), JSON.stringify(updated), "EX", SESSION_TTL_SECONDS);
  return updated;
}

export async function listUserSessions(userId: string) {
  const ids = await redis.smembers(userSessionsKey(userId));
  const sessions = await Promise.all(ids.map(async (id) => ({ id, session: await getSession(id) })));
  const valid = sessions.filter((item): item is { id: string; session: SessionMeta } => Boolean(item.session));
  if (valid.length !== ids.length) {
    const stale = sessions.filter(item => !item.session).map(item => item.id);
    if (stale.length) await redis.srem(userSessionsKey(userId), ...stale);
  }
  return valid;
}

export async function destroySession(sessionId: string): Promise<void> {
  const userId = await getSessionUserId(sessionId);
  await redis.del(sessionKey(sessionId));
  if (userId) await redis.srem(userSessionsKey(userId), sessionId);
}

export async function destroyAllUserSessions(userId: string): Promise<void> {
  const sessionIds = await redis.smembers(userSessionsKey(userId));
  if (sessionIds.length) await redis.del(...sessionIds.map(sessionKey));
  await redis.del(userSessionsKey(userId));
}
