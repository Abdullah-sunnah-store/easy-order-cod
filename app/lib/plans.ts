// Client-safe plan constants (no server-only imports), shared by the billing
// config in shopify.server.ts, the Plans UI, and every feature gate.
export const PLANS = {
  BASIC: "Basic",
  ADVANCED: "Advanced",
  UNLIMITED: "Unlimited",
} as const;

export const FREE_PLAN = "Free";

export type PlanName = "Free" | "Basic" | "Advanced" | "Unlimited";
export type PaidPlanName = Exclude<PlanName, "Free">;
export type BillingCycle = "monthly" | "yearly";

// Cheapest → most expensive. Index doubles as the entitlement rank.
export const PLAN_ORDER: PlanName[] = [FREE_PLAN, PLANS.BASIC, PLANS.ADVANCED, PLANS.UNLIMITED];

// Every Shopify subscription the app can sell. `key` is the billing plan name
// in shopify.server.ts AND the name Shopify reports back on the subscription,
// which is how a charge is mapped to its tier. Yearly saves ~25%.
export const BILLING_PLANS: {
  key: string;
  tier: PaidPlanName;
  cycle: BillingCycle;
  amount: number;
  price: string;
}[] = [
  { key: "Basic", tier: "Basic", cycle: "monthly", amount: 9.95, price: "$9.95" },
  { key: "Basic Yearly", tier: "Basic", cycle: "yearly", amount: 89.99, price: "$89.99" },
  { key: "Advanced", tier: "Advanced", cycle: "monthly", amount: 24.95, price: "$24.95" },
  { key: "Advanced Yearly", tier: "Advanced", cycle: "yearly", amount: 225.99, price: "$225.99" },
  { key: "Unlimited", tier: "Unlimited", cycle: "monthly", amount: 59.95, price: "$59.95" },
  { key: "Unlimited Yearly", tier: "Unlimited", cycle: "yearly", amount: 539.99, price: "$539.99" },
];

export function billingPlan(key: string) {
  return BILLING_PLANS.find((p) => p.key === key);
}

// -1 means unlimited. Numbers are the single source of truth: the Plans page
// renders these, and proxy.settings.tsx enforces them by withholding the
// storefront button once the allowance is used up.
export const PLAN_LIMITS: Record<PlanName, { orders: number; upsells: number; quantityOffers: number }> = {
  Free: { orders: 60, upsells: 1, quantityOffers: 1 },
  Basic: { orders: 550, upsells: -1, quantityOffers: -1 },
  Advanced: { orders: 10000, upsells: -1, quantityOffers: -1 },
  Unlimited: { orders: -1, upsells: -1, quantityOffers: -1 },
};

// Only features the app actually delivers. OTP, SMS, WhatsApp and IP blocking
// were removed: Shopify checkout collects the phone and address, so the app has
// no point at which it could verify or block a customer before the order.
export type Feature =
  | "pixels"
  | "sheets"
  | "postalBlocking"
  | "analytics"
  | "offerDiscounts"
  | "downsell"
  | "templates"
  | "languages"
  | "productPixels"
  | "thankYou"
  | "recommendations";

// Lowest plan that unlocks each feature.
export const FEATURE_MIN_PLAN: Record<Feature, PlanName> = {
  pixels: PLANS.BASIC,
  sheets: PLANS.BASIC,
  postalBlocking: PLANS.ADVANCED,
  analytics: PLANS.ADVANCED,
  // Discounted bundles / upsells / free gifts (Shopify automatic discounts).
  offerDiscounts: PLANS.BASIC,
  downsell: PLANS.BASIC,
  templates: PLANS.BASIC,
  languages: PLANS.ADVANCED,
  productPixels: PLANS.ADVANCED,
  thankYou: PLANS.BASIC,
  recommendations: PLANS.UNLIMITED,
};

// What each plan card lists on the Plans page. Every line here must be a
// feature that works today — App Store review and merchants both hold us to it.
export const PLAN_FEATURES: Record<PlanName, string[]> = {
  Free: [
    "COD checkout button",
    "Orders dashboard",
    "1 quantity offer (Buy 2, save 10%…)",
    "1 upsell offer",
    "Repeat-customer review tag",
  ],
  Basic: [
    "Everything in Free",
    "Unlimited quantity offers",
    "Bundles, discounted upsells & free gifts",
    "Downsell offer",
    "Thank-you page offer",
    "Form design templates",
    "Marketing pixels (Facebook, TikTok, Google, Snapchat, Pinterest)",
    "Google Sheets export",
  ],
  Advanced: [
    "Everything in Basic",
    "Multi-language form",
    "Product-specific pixels",
    "Funnel analytics (views → opens → checkouts → orders)",
    "Postal code review tag",
    "Priority support",
  ],
  Unlimited: [
    "Everything in Advanced",
    "Unlimited COD orders",
    "Smart product recommendations in the form",
    "Product suggestions on the thank-you page",
    "Priority support",
  ],
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

/** How many quantity offers may exist. -1 = unlimited. */
export function quantityOfferLimit(plan: PlanName): number {
  return PLAN_LIMITS[plan]?.quantityOffers ?? PLAN_LIMITS.Free.quantityOffers;
}

/** How many upsell offers may exist. -1 = unlimited. */
export function upsellLimit(plan: PlanName): number {
  return PLAN_LIMITS[plan]?.upsells ?? PLAN_LIMITS.Free.upsells;
}

export function formatLimit(n: number): string {
  return n < 0 ? "Unlimited" : n.toLocaleString("en-US");
}
