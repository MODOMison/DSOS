import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { db, schema } from "../db/index.js";
import { env } from "./env.js";
import type { User } from "../db/schema.js";

const SESSION_COOKIE = "dsos_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

export async function createUser(email: string, password: string): Promise<User> {
  const id = newId("usr");
  const passwordHash = await hashPassword(password);
  const now = new Date();

  db.insert(schema.users)
    .values({ id, email: email.toLowerCase(), passwordHash, createdAt: now })
    .run();

  // Seed a "free" subscription row so the rest of the app can assume it exists.
  db.insert(schema.subscriptions)
    .values({ userId: id, tier: "free", status: "none", updatedAt: now })
    .run();

  const [user] = db.select().from(schema.users).where(eq(schema.users.id, id)).all();
  return user;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const [user] = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .all();
  return user;
}

export function createSession(userId: string): { id: string; expiresAt: Date } {
  const id = newId("sess");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  db.insert(schema.sessions)
    .values({ id, userId, expiresAt, createdAt: new Date() })
    .run();
  return { id, expiresAt };
}

export function deleteSession(sessionId: string): void {
  db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
}

export function getSessionUser(sessionId: string): User | undefined {
  const [row] = db
    .select({
      user: schema.users,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.id, sessionId))
    .all();

  if (!row) return undefined;
  if (row.expiresAt.getTime() < Date.now()) {
    deleteSession(sessionId);
    return undefined;
  }
  return row.user;
}

export function setSessionCookie(res: Response, sessionId: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
    }
  }
}

export function loadUser(req: Request, _res: Response, next: NextFunction) {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) {
    const user = getSessionUser(sid);
    if (user) {
      req.user = user;
      req.sessionId = sid;
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "not authenticated" });
  }
  next();
}
