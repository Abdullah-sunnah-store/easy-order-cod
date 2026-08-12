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
// renders these, and proxy.order.tsx enforces them.
export const PLAN_LIMITS: Record<PlanName, { orders: number; upsells: number }> = {
  Free: { orders: 60, upsells: 1 },
  Basic: { orders: 550, upsells: -1 },
  Advanced: { orders: 10000, upsells: -1 },
};

export type Feature =
  | "pixels"
  | "sheets"
  | "otp"
  | "sms"
  | "whatsapp"
  | "ipBlocking"
  | "analytics";

// Lowest plan that unlocks each feature.
export const FEATURE_MIN_PLAN: Record<Feature, PlanName> = {
  pixels: PLANS.BASIC,
  sheets: PLANS.BASIC,
  otp: PLANS.BASIC,
  sms: PLANS.ADVANCED,
  whatsapp: PLANS.ADVANCED,
  ipBlocking: PLANS.ADVANCED,
  analytics: PLANS.ADVANCED,
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
