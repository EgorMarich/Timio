import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE, getSession, touchSession } from "./auth.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";

export async function requireAuth(c: Context, next: Next) {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) return c.json({ error: "unauthorized" }, 401);

  const session = await getSession(sessionId);
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const [user] = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, session.userId));
  if (!user || user.status !== "active") return c.json({ error: "unauthorized" }, 401);

  await touchSession(sessionId);
  c.set("userId", user.id);
  await next();
}
