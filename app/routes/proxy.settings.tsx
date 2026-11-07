import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCodSettings } from "../models/codSettings.server";
import { getConnections } from "../models/connections.server";
import { getActivePlanCached } from "../models/billing.server";
import { getMonthlyOrderCount } from "../models/usage.server";
import { can, orderLimit } from "../lib/plans";
import { resolveUpsells } from "../models/upsellResolve.server";

// Returns the storefront-relevant COD settings as JSON.
// Called by the theme extension via /apps/cod/settings (signed by Shopify).
//
// Nothing here describes prices the app intends to charge: shipping, taxes,
// discounts and any cash-on-delivery fee are Shopify checkout's to calculate.
// What the block needs is the merchant's wording, its appearance, and which
// add-on products may be offered.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return json({ enabled: false }, { status: 401 });
  }
  const [s, c, plan] = await Promise.all([
    getCodSettings(session.shop),
    getConnections(session.shop),
    getActivePlanCached(session.shop, admin),
  ]);
  const pixelsAllowed = can(plan, "pixels");
  let builder: Record<string, unknown> = {};
  try {
    builder = JSON.parse(s.builderConfig || "{}");
  } catch {
    /* ignore malformed */
  }

  // The plan's monthly allowance used to be enforced when the app created the
  // order. It no longer creates one, so the only honest place to stop is
  // before the button is offered — never inside the customer's checkout.
  const limit = orderLimit(plan);
  const overLimit =
    limit >= 0 && (await getMonthlyOrderCount(session.shop)) >= limit;

  // Offers from the Upsells page, resolved to real variants and prices. A
  // failure here must not take the block down with it.
  let upsells: Awaited<ReturnType<typeof resolveUpsells>> = [];
  try {
    upsells = await resolveUpsells(admin, session.shop);
  } catch {
    /* block still works without offers */
  }

  // Both the block and the app embed fetch this on every page view; a short
  // browser cache stops a single visit from asking twice.
  return json({
    enabled: s.enabled && !overLimit,
    headingText: s.headingText,
    buttonText: s.buttonText,
    builder,
    // Storefront values that used to live in the theme block's schema.
    currencySymbol: s.currencySymbol,
    countdownMinutes: s.countdownMinutes,
    // Offers are added to the Shopify cart at the price Shopify holds for
    // them, so the stored discount percentage is deliberately not sent — the
    // block must never show a price checkout won't honour.
    upsells: upsells.map((o) => ({
      id: o.id,
      title: o.title,
      type: o.type,
      kind: o.kind,
      minQuantity: o.minQuantity,
      sourceTitle: o.sourceTitle,
      items: o.items,
    })),
    // Marketing pixels are a Basic-plan feature — withheld on Free so the
    // storefront never fires them for a shop that isn't entitled to them.
    pixels: pixelsAllowed
      ? {
          facebook: c.fbPixelId,
          tiktok: c.tiktokPixelId,
          google: c.googleTagId,
          snapchat: c.snapPixelId,
          pinterest: c.pinterestTagId,
        }
      : {},
  }, { headers: { "Cache-Control": "private, max-age=60" } });
};
