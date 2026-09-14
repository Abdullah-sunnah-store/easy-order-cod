import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCodSettings } from "../models/codSettings.server";
import { getConnections } from "../models/connections.server";
import { getActivePlan } from "../models/billing.server";
import { can } from "../lib/plans";
import { resolveUpsells } from "../models/upsellResolve.server";

// Returns the storefront-relevant COD form settings as JSON.
// Called by the theme extension via /apps/cod/settings (signed by Shopify).
//
// Nothing here may describe shipping rates, delivery charges or COD fees. The
// form no longer prices an order — Shopify checkout does — and sending rates
// down would only tempt the form back into the behaviour that App Store
// requirement 1.1.2 prohibits.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return json({ enabled: false }, { status: 401 });
  }
  const s = await getCodSettings(session.shop);
  const c = await getConnections(session.shop);
  const plan = await getActivePlan(admin);
  const pixelsAllowed = can(plan, "pixels");
  let builder: Record<string, unknown> = {};
  try {
    builder = JSON.parse(s.builderConfig || "{}");
  } catch {
    /* ignore malformed */
  }

  // Offers from the Upsells page, resolved to real variants and prices. A
  // failure here must not take the order form down with it.
  let upsells: Awaited<ReturnType<typeof resolveUpsells>> = [];
  try {
    upsells = await resolveUpsells(admin, session.shop);
  } catch {
    /* form still works without offers */
  }

  return json({
    enabled: s.enabled,
    headingText: s.headingText,
    buttonText: s.buttonText,
    // Stamped on the cart as the "Order type" attribute so the merchant (and
    // our orders/create webhook) can recognise a COD order.
    orderTag: s.orderTag,
    builder,
    currencySymbol: s.currencySymbol,
    countdownMinutes: s.countdownMinutes,
    checkoutNotice: s.checkoutNotice,
    upsells,
    // Quantity and note are all that is left. Name, email, phone, address and
    // city moved to Shopify checkout, which is where they belong.
    fields: {
      quantity: s.showQuantity,
      notes: s.showNotes,
    },
    // Marketing pixels are a Basic-plan feature — withheld on Free so the
    // storefront never fires them for a shop that isn't entitled to them.
    pixels: pixelsAllowed
      ? {
          facebook: c.fbPixelId,
          tiktok: c.tiktokPixelId,
          google: c.googleTagId,
        }
      : {},
  });
};
