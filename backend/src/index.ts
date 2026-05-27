import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { env } from "./lib/env.js";
import "./db/index.js"; // side-effect: bootstrap DB tables on startup
import { loadUser, requireAuth } from "./lib/auth.js";
import { enforceScanLimit, requireProTier } from "./lib/tiers.js";

import { authRouter } from "./routes/auth.js";
import { billingRouter, billingWebhookRouter } from "./routes/billing.js";
import { installRouter } from "./routes/install.js";
import { reconRouter } from "./routes/recon.js";
import { cveRouter } from "./routes/cve.js";
import { hashRouter } from "./routes/hash.js";
import { breachRouter } from "./routes/breach.js";
import { phishRouter } from "./routes/phish.js";
import { aiRouter } from "./routes/ai.js";
import { settingsRouter } from "./routes/settings.js";

const app = express();
const PORT = env.port;

// CORS must allow credentials so the session cookie travels cross-origin
// from the Vite dev server (http://localhost:5173) to the API.
app.use(
  cors({
    origin: env.isProd ? env.appUrl : true,
    credentials: true,
  })
);

// IMPORTANT: Stripe webhook must receive the raw request body so the
// signature can be verified. Mount it BEFORE express.json() consumes the
// body stream. The route itself uses express.raw() to opt in.
app.use("/api/billing/webhook", billingWebhookRouter);

// Normal body parsers for everything else.
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(loadUser);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "DSOS backend", version: "0.3.0" });
});

// Public auth endpoints (signup/login don't require an existing session).
app.use("/api/auth", authRouter);

// Billing (the non-webhook routes). requireAuth is applied per-route inside.
app.use("/api/billing", billingRouter);

// Everything below requires an authenticated session.
app.use("/api", requireAuth);

// Settings: per-user model/backend preference (currently still file-backed
// globally; per-user-ifying it is a follow-up).
app.use("/api/settings", settingsRouter);

// Install: one-click installer for optional engines (built-in GGUF, etc.)
app.use("/api/install", installRouter);

// AI: tier + key resolution happens inside the router.
app.use("/api/ai", aiRouter);

// Basic tools (free + pro). Scan limit enforced per request.
app.use("/api/recon", enforceScanLimit, reconRouter);
app.use("/api/hash", enforceScanLimit, hashRouter);

// Pro-only tools.
app.use("/api/cve", requireProTier, enforceScanLimit, cveRouter);
app.use("/api/breach", requireProTier, enforceScanLimit, breachRouter);
app.use("/api/phish", requireProTier, enforceScanLimit, phishRouter);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[dsos]", err);
    res.status(500).json({ error: err.message ?? "internal error" });
  }
);

app.listen(PORT, () => {
  console.log(`🜨  DSOS backend listening on http://localhost:${PORT}`);
});
