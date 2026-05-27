import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(
      `Missing required env var: ${name}. See backend/.env.example for the full list.`
    );
  }
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  appUrl: required("APP_URL", "http://localhost:5173"),
  databaseUrl: required("DATABASE_URL", "./dsos.db"),
  sessionSecret: required("SESSION_SECRET", "dev-only-insecure-secret-change-me"),

  stripeSecretKey: optional("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: optional("STRIPE_WEBHOOK_SECRET"),
  stripeProPriceId: optional("STRIPE_PRO_PRICE_ID"),

  platformAnthropicKey: optional("PLATFORM_ANTHROPIC_KEY"),

  isProd: process.env.NODE_ENV === "production",
};

export function requireStripe() {
  if (!env.stripeSecretKey || !env.stripeWebhookSecret || !env.stripeProPriceId) {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and STRIPE_PRO_PRICE_ID in backend/.env."
    );
  }
  return {
    secretKey: env.stripeSecretKey,
    webhookSecret: env.stripeWebhookSecret,
    proPriceId: env.stripeProPriceId,
  };
}
