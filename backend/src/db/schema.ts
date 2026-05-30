import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  byoAnthropicKey: text("byo_anthropic_key"),
  // JS field is shadowsNotes (renamed from oracleNotes for the Shadows
  // rebrand), but the DB column stays "oracle_notes" — renaming the column
  // would require a SQLite migration that loses no-downtime safety and
  // there's no user value in changing the column name.
  shadowsNotes: text("oracle_notes"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const subscriptions = sqliteTable("subscriptions", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  tier: text("tier", { enum: ["free", "pro"] }).notNull().default("free"),
  status: text("status", {
    enum: ["active", "canceled", "past_due", "trialing", "incomplete", "none"],
  })
    .notNull()
    .default("none"),
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const usageMonthly = sqliteTable(
  "usage_monthly",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    yearMonth: text("year_month").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    scans: integer("scans").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.yearMonth] }),
  })
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type UsageMonthly = typeof usageMonthly.$inferSelect;
