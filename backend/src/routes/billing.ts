import { Router, raw } from "express";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../lib/auth.js";
import { requireStripe } from "../lib/env.js";
import {
  createCheckoutSession,
  createPortalSession,
  stripe,
  syncSubscription,
} from "../lib/stripe.js";
import { getSubscription, getUsageThisMonth, TIERS, getEffectiveTier } from "../lib/tiers.js";

export const billingRouter = Router();
export const billingWebhookRouter = Router();

billingRouter.get("/status", requireAuth, (req, res) => {
  const userId = req.user!.id;
  const sub = getSubscription(userId);
  const usage = getUsageThisMonth(userId);
  const effectiveTier = getEffectiveTier(userId);
  res.json({
    subscription: sub,
    effectiveTier,
    limits: TIERS[effectiveTier],
    usage,
  });
});

billingRouter.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    requireStripe();
    const url = await createCheckoutSession(req.user!);
    res.json({ url });
  } catch (e) {
    next(e);
  }
});

billingRouter.post("/portal", requireAuth, async (req, res, next) => {
  try {
    requireStripe();
    const url = await createPortalSession(req.user!);
    res.json({ url });
  } catch (e) {
    next(e);
  }
});

/**
 * Webhook handler. Lives on its own router so it can be mounted BEFORE
 * express.json() and receive the raw request body — required for Stripe
 * signature verification.
 */
billingWebhookRouter.post("/", raw({ type: "application/json" }), async (req, res) => {
  const cfg = requireStripe();
  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string") {
    return res.status(400).send("missing stripe-signature header");
  }

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(req.body, sig, cfg.webhookSecret);
  } catch (e) {
    console.error("[stripe] webhook signature verification failed:", e);
    return res.status(400).send(`signature verification failed`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription && session.customer) {
          const userId = await userIdForCustomer(session.customer as string);
          if (userId) {
            const sub = await stripe().subscriptions.retrieve(session.subscription as string);
            syncSubscription(userId, sub);
          }
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId =
          (sub.metadata?.userId as string | undefined) ??
          (await userIdForCustomer(sub.customer as string));
        if (userId) syncSubscription(userId, sub);
        break;
      }
      default:
        // Ignore everything else for the MVP.
        break;
    }
  } catch (e) {
    console.error("[stripe] webhook handler error:", e);
    // Tell Stripe to retry.
    return res.status(500).send("handler error");
  }

  res.json({ received: true });
});

async function userIdForCustomer(customerId: string): Promise<string | undefined> {
  const [row] = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.stripeCustomerId, customerId))
    .all();
  return row?.id;
}
