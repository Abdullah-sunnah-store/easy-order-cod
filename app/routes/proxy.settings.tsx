import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCodSettings } from "../models/codSettings.server";
import { getConnections } from "../models/connections.server";
import { getActivePlan } from "../models/billing.server";
import { can } from "../lib/plans";
import { getLiveRates } from "../models/shippingSync.server";
import { resolveUpsells } from "../models/upsellResolve.server";
import type { ShipMode, ShipOption, ShipRule } from "../lib/shipping";
import {
  DEFAULT_FALLBACK_LABEL,
  parseJsonArray,
  resolveShippingOptions,
} from "../lib/shipping";

// Returns the storefront-relevant COD form settings as JSON.
// Called by the theme extension via /apps/cod/settings (signed by Shopify).
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
  const mode = ((s.shippingMode as ShipMode) || "manual") as ShipMode;
  const manual = parseJsonArray<ShipOption>(s.shippingOptions);
  let synced = parseJsonArray<ShipOption>(s.shippingSynced);
  // Auto-refresh keeps the form in step with the shop's shipping zones; it falls
  // back to the last stored sync if the Admin API call fails.
  if (s.shippingAutoSync && (mode === "auto" || mode === "both")) {
    synced = await getLiveRates(admin, session.shop, synced);
  }
  const shipping = {
    mode,
    manual,
    synced,
    hiddenRates: parseJsonArray<string>(s.shippingHiddenRates),
    rulesEnabled: s.shippingRulesEnabled,
    rules: parseJsonArray<ShipRule>(s.shippingRules),
    fallbackPrice: s.shippingFallbackPrice,
    fallbackLabel: s.shippingFallbackLabel || DEFAULT_FALLBACK_LABEL,
    freeShippingThreshold: s.freeShippingThreshold,
  };
  // The city-independent list, for older cached copies of cod-form.js that
  // don't know how to re-price by city.
  const shippingOptions = resolveShippingOptions(shipping);

  // Offers from the Upsells page, resolved to real variants and prices. A
  // failure here must not take the order form down with it.
  let upsells: Awaited<ReturnType<typeof resolveUpsells>> = [];
  try {
    upsells = await resolveUpsells(admin, session.shop);
  } catch {
    /* form still works without offers */
  }
  // "+880, +91" -> ["+880","+91"]; the first is preselected on the form.
  const dialCodes = String((s as any).dialCodes || "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  return json({
    enabled: s.enabled,
    dialCodes,
    headingText: s.headingText,
    buttonText: s.buttonText,
    successMessage: s.successMessage,
    builder,
    // Storefront values that used to live in the theme block's schema.
    currencySymbol: s.currencySymbol,
    countdownMinutes: s.countdownMinutes,
    codFee: s.codFee,
    shippingOptions,
    shipping,
    upsells,
    fields: {
      name: s.showName,
      email: s.showEmail,
      phone: s.showPhone,
      address: s.showAddress,
      city: s.showCity,
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
