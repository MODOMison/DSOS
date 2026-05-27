import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env, requireStripe } from "./env.js";
import type { User } from "../db/schema.js";

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (!_stripe) {
    const cfg = requireStripe();
    _stripe = new Stripe(cfg.secretKey, { apiVersion: "2025-02-24.acacia" });
  }
  return _stripe;
}

export async function ensureStripeCustomer(user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe().customers.create({
    email: user.email,
    metadata: { userId: user.id },
  });

  db.update(schema.users)
    .set({ stripeCustomerId: customer.id })
    .where(eq(schema.users.id, user.id))
    .run();

  return customer.id;
}

export async function createCheckoutSession(user: User): Promise<string> {
  const cfg = requireStripe();
  const customerId = await ensureStripeCustomer(user);

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: cfg.proPriceId, quantity: 1 }],
    success_url: `${env.appUrl}/?billing=success`,
    cancel_url: `${env.appUrl}/?billing=cancel`,
    allow_promotion_codes: true,
    subscription_data: { metadata: { userId: user.id } },
  });

  if (!session.url) throw new Error("Stripe did not return a Checkout URL");
  return session.url;
}

export async function createPortalSession(user: User): Promise<string> {
  if (!user.stripeCustomerId) {
    throw new Error("no stripe customer yet — subscribe first");
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${env.appUrl}/`,
  });
  return session.url;
}

/**
 * Map a Stripe subscription's status + price into our local subscriptions row.
 * Centralized so webhook + manual sync share the same logic.
 */
export function syncSubscription(userId: string, sub: Stripe.Subscription) {
  const cfg = requireStripe();
  const priceId = sub.items.data[0]?.price.id ?? null;
  const isPro = priceId === cfg.proPriceId;
  const tier = isPro && (sub.status === "active" || sub.status === "trialing") ? "pro" : "free";

  db.update(schema.subscriptions)
    .set({
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      tier,
      status: sub.status as schema.Subscription["status"],
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.subscriptions.userId, userId))
    .run();
}
