import { PLANS, FREE_PLAN, type PlanName } from "../lib/plans";

// Whether charges are created in Shopify's test mode (no real money moves).
// Defaults to test everywhere except production, so a forgotten flag can never
// silently bill a real merchant — and production can't silently issue fake
// charges. Override explicitly with SHOPIFY_BILLING_TEST=true|false.
export const BILLING_TEST =
  process.env.SHOPIFY_BILLING_TEST !== undefined
    ? process.env.SHOPIFY_BILLING_TEST === "true"
    : process.env.NODE_ENV !== "production";

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

/**
 * The shop's current plan, resolved from its active app subscriptions.
 *
 * Uses the Admin API rather than `billing.check` so the same helper works on
 * app-proxy requests (storefront order creation), where no billing context
 * exists. Falls back to Free on any error — a billing hiccup must never take
 * the storefront order form down.
 */
export async function getActivePlan(admin: AdminClient): Promise<PlanName> {
  try {
    const response = await admin.graphql(
      `#graphql
      query ActivePlan {
        currentAppInstallation {
          activeSubscriptions { name status }
        }
      }`,
    );
    const body: any = await response.json();
    const names: string[] = (body?.data?.currentAppInstallation?.activeSubscriptions ?? [])
      .filter((s: any) => s?.status === "ACTIVE")
      .map((s: any) => s?.name);

    if (names.includes(PLANS.ADVANCED)) return PLANS.ADVANCED;
    if (names.includes(PLANS.BASIC)) return PLANS.BASIC;
    return FREE_PLAN;
  } catch {
    return FREE_PLAN;
  }
}

// Storefront requests (/apps/cod/settings) arrive on every product page view.
// Asking Shopify for the plan each time made each view cost an Admin API call,
// which is slow and eats the shop's rate limit. A warm serverless instance
// keeps the answer for a few minutes; a plan change shows up on the storefront
// within that window, and the admin pages always ask Shopify directly.
const PLAN_TTL_MS = 5 * 60 * 1000;
const planCache = new Map<string, { plan: PlanName; at: number }>();

export async function getActivePlanCached(shop: string, admin: AdminClient): Promise<PlanName> {
  const hit = planCache.get(shop);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.plan;
  const plan = await getActivePlan(admin);
  planCache.set(shop, { plan, at: Date.now() });
  if (planCache.size > 5000) planCache.delete(planCache.keys().next().value as string);
  return plan;
}

/** Drop the cached plan after a subscription change in this instance. */
export function forgetCachedPlan(shop: string) {
  planCache.delete(shop);
}
