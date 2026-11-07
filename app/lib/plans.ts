// Client-safe plan constants (no server-only imports), shared by the billing
// config in shopify.server.ts, the Plans UI, and every feature gate.
export const PLANS = {
  BASIC: "Basic",
  ADVANCED: "Advanced",
} as const;

export const FREE_PLAN = "Free";

export type PlanName = "Free" | "Basic" | "Advanced";

// Cheapest → most expensive. Index doubles as the entitlement rank.
export const PLAN_ORDER: PlanName[] = [FREE_PLAN, PLANS.BASIC, PLANS.ADVANCED];

// -1 means unlimited. Numbers are the single source of truth: the Plans page
// renders these, and proxy.settings.tsx enforces them by withholding the
// storefront button once the allowance is used up.
export const PLAN_LIMITS: Record<PlanName, { orders: number; upsells: number }> = {
  Free: { orders: 60, upsells: 1 },
  Basic: { orders: 550, upsells: -1 },
  Advanced: { orders: 10000, upsells: -1 },
};

// Only features the app actually delivers. OTP, SMS, WhatsApp and IP blocking
// were removed: Shopify checkout collects the phone and address, so the app has
// no point at which it could verify or block a customer before the order.
export type Feature = "pixels" | "sheets" | "postalBlocking" | "analytics";

// Lowest plan that unlocks each feature.
export const FEATURE_MIN_PLAN: Record<Feature, PlanName> = {
  pixels: PLANS.BASIC,
  sheets: PLANS.BASIC,
  postalBlocking: PLANS.ADVANCED,
  analytics: PLANS.ADVANCED,
};

// What each plan card lists on the Plans page. Every line here must be a
// feature that works today — App Store review and merchants both hold us to it.
export const PLAN_FEATURES: Record<PlanName, string[]> = {
  Free: ["COD checkout button", "Orders dashboard", "1 upsell offer", "Max orders per phone (review tag)"],
  Basic: ["Everything in Free", "Marketing pixels (Facebook, TikTok, Google, Snapchat, Pinterest)", "Google Sheets export", "Unlimited upsells"],
  Advanced: ["Everything in Basic", "Postal code blocking (review tag)", "Analytics: monthly orders, revenue, flagged", "Priority support"],
};

export function planRank(plan: PlanName): number {
  const i = PLAN_ORDER.indexOf(plan);
  return i === -1 ? 0 : i;
}

/** Does this plan include the feature? */
export function can(plan: PlanName, feature: Feature): boolean {
  return planRank(plan) >= planRank(FEATURE_MIN_PLAN[feature]);
}

/** Monthly COD order allowance. -1 = unlimited. */
export function orderLimit(plan: PlanName): number {
  return PLAN_LIMITS[plan]?.orders ?? PLAN_LIMITS.Free.orders;
}

/** How many upsell offers may exist. -1 = unlimited. */
export function upsellLimit(plan: PlanName): number {
  return PLAN_LIMITS[plan]?.upsells ?? PLAN_LIMITS.Free.upsells;
}

export function formatLimit(n: number): string {
  return n < 0 ? "Unlimited" : n.toLocaleString("en-US");
}
