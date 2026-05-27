import { Router } from "express";
import { z } from "zod";
import {
  clearSessionCookie,
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from "../lib/auth.js";
import { getSubscription } from "../lib/tiers.js";

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
});

authRouter.post("/signup", async (req, res, next) => {
  try {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid input" });
    }
    const { email, password } = parsed.data;

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "an account with that email already exists" });
    }

    const user = await createUser(email, password);
    const session = createSession(user.id);
    setSessionCookie(res, session.id, session.expiresAt);

    res.json({
      user: { id: user.id, email: user.email },
      subscription: getSubscription(user.id),
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid input" });
    }
    const { email, password } = parsed.data;

    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      // Same message for both — don't leak which emails exist.
      return res.status(401).json({ error: "incorrect email or password" });
    }

    const session = createSession(user.id);
    setSessionCookie(res, session.id, session.expiresAt);

    res.json({
      user: { id: user.id, email: user.email },
      subscription: getSubscription(user.id),
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/logout", (req, res) => {
  if (req.sessionId) deleteSession(req.sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  const user = req.user!;
  res.json({
    user: { id: user.id, email: user.email, hasByoKey: !!user.byoAnthropicKey },
    subscription: getSubscription(user.id),
  });
});
