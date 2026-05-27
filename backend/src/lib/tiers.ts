import type { Request, Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "./env.js";
import type { Subscription, User } from "../db/schema.js";

export type Tier = "free" | "pro";

export interface TierLimits {
  scansPerMonth: number;      // -1 = unlimited
  monthlyTokenQuota: number;  // platform-key monthly cap; 0 = no platform AI access
  toolsUnlocked: "basic" | "all";
}

export const TIERS: Record<Tier, TierLimits> = {
  free: {
    scansPerMonth: 150,
    monthlyTokenQuota: 0,    // free users must BYO AI key
    toolsUnlocked: "basic",  // recon + hash only
  },
  pro: {
    scansPerMonth: -1,
    monthlyTokenQuota: 500_000,
    toolsUnlocked: "all",
  },
};

const BASIC_TOOLS = new Set(["recon", "hash"]);

export function isToolAllowed(tier: Tier, tool: string): boolean {
  if (TIERS[tier].toolsUnlocked === "all") return true;
  return BASIC_TOOLS.has(tool);
}

export function getSubscription(userId: string): Subscription {
  const [sub] = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .all();
  if (sub) return sub;

  // Should always exist (seeded on signup), but defensive: create one if missing.
  const now = new Date();
  db.insert(schema.subscriptions)
    .values({ userId, tier: "free", status: "none", updatedAt: now })
    .run();
  return {
    userId,
    stripeSubscriptionId: null,
    stripePriceId: null,
    tier: "free",
    status: "none",
    currentPeriodEnd: null,
    updatedAt: now,
  };
}

export function getEffectiveTier(userId: string): Tier {
  const sub = getSubscription(userId);
  if (sub.tier === "pro" && (sub.status === "active" || sub.status === "trialing")) {
    return "pro";
  }
  return "free";
}

export function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getUsageThisMonth(userId: string) {
  const ym = currentYearMonth();
  const [row] = db
    .select()
    .from(schema.usageMonthly)
    .where(
      and(eq(schema.usageMonthly.userId, userId), eq(schema.usageMonthly.yearMonth, ym))
    )
    .all();
  return row ?? { userId, yearMonth: ym, tokensIn: 0, tokensOut: 0, scans: 0 };
}

export function recordTokens(userId: string, tokensIn: number, tokensOut: number) {
  const ym = currentYearMonth();
  const existing = getUsageThisMonth(userId);
  db.insert(schema.usageMonthly)
    .values({ userId, yearMonth: ym, tokensIn, tokensOut, scans: 0 })
    .onConflictDoUpdate({
      target: [schema.usageMonthly.userId, schema.usageMonthly.yearMonth],
      set: {
        tokensIn: existing.tokensIn + tokensIn,
        tokensOut: existing.tokensOut + tokensOut,
      },
    })
    .run();
}

export function recordScan(userId: string) {
  const ym = currentYearMonth();
  const existing = getUsageThisMonth(userId);
  db.insert(schema.usageMonthly)
    .values({ userId, yearMonth: ym, tokensIn: 0, tokensOut: 0, scans: 1 })
    .onConflictDoUpdate({
      target: [schema.usageMonthly.userId, schema.usageMonthly.yearMonth],
      set: { scans: existing.scans + 1 },
    })
    .run();
}

export type AiKeyResolution =
  | { kind: "user"; key: string }
  | { kind: "platform"; key: string; tokensRemaining: number }
  | { kind: "none"; reason: string };

/**
 * Decide which Anthropic API key to use for this request.
 * 1. User's BYO key wins if present (no quota consumed).
 * 2. Pro users can use the platform key, up to monthly token quota.
 * 3. Otherwise: deny with an explanation the UI can surface.
 */
export function aiKeyFor(user: User): AiKeyResolution {
  if (user.byoAnthropicKey) {
    return { kind: "user", key: user.byoAnthropicKey };
  }
  const tier = getEffectiveTier(user.id);
  if (tier !== "pro") {
    return {
      kind: "none",
      reason:
        "AI requires a Pro subscription, or add your own Anthropic API key in Account settings.",
    };
  }
  if (!env.platformAnthropicKey) {
    return {
      kind: "none",
      reason:
        "Platform AI is not configured. Add your own Anthropic API key in Account settings.",
    };
  }
  const usage = getUsageThisMonth(user.id);
  const used = usage.tokensIn + usage.tokensOut;
  const quota = TIERS.pro.monthlyTokenQuota;
  if (used >= quota) {
    return {
      kind: "none",
      reason: `Monthly AI quota exhausted (${quota.toLocaleString()} tokens). Add your own Anthropic API key in Account settings to continue.`,
    };
  }
  return { kind: "platform", key: env.platformAnthropicKey, tokensRemaining: quota - used };
}

/**
 * Express middleware. Gate a route behind Pro tier.
 * Free users get a 402 with an upgrade hint the UI can render.
 */
export function requireProTier(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "not authenticated" });
  if (getEffectiveTier(req.user.id) !== "pro") {
    return res.status(402).json({
      error: "this tool requires a Pro subscription",
      upgrade: true,
    });
  }
  next();
}

/**
 * Enforce monthly scan limit on free-tier users. Pro is unlimited.
 * Records the scan after the response is sent so failed requests don't count.
 */
export function enforceScanLimit(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "not authenticated" });
  const userId = req.user.id;
  const tier = getEffectiveTier(userId);
  const limit = TIERS[tier].scansPerMonth;

  if (limit !== -1) {
    const used = getUsageThisMonth(userId).scans;
    if (used >= limit) {
      return res.status(402).json({
        error: `monthly scan limit reached (${limit}). Upgrade to Pro for unlimited scans.`,
        upgrade: true,
      });
    }
  }

  res.on("finish", () => {
    if (res.statusCode < 400) recordScan(userId);
  });
  next();
}
