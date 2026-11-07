import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCodSettings } from "../models/codSettings.server";
import { getConnections } from "../models/connections.server";
import { getActivePlanCached } from "../models/billing.server";
import { getMonthlyOrderCount } from "../models/usage.server";
import { can, orderLimit } from "../lib/plans";
import { resolveUpsells } from "../models/upsellResolve.server";
import { tiersForProduct } from "../models/quantityOffers.server";
import { pixelsForProduct } from "../models/productPixels.server";
import {
  DEFAULT_TEXT,
  isRtl,
  parseTranslations,
  translationFor,
  type TextKey,
} from "../lib/storefrontText";

// Storefront settings for the COD block and the app embed, via the app proxy
// (/apps/cod/settings?product=<id>&locale=<code>, signed by Shopify).
//
// Nothing here is a price the app charges. Quantity tiers, bundle discounts
// and the downsell are real Shopify discounts created on the Offers and
// Upsells pages, so the numbers the block shows are the ones checkout applies.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return json({ enabled: false }, { status: 401 });
  }
  const shop = session.shop;
  const url = new URL(request.url);
  const productNumeric = (url.searchParams.get("product") || "").replace(/\D/g, "").slice(0, 20);
  const productGid = productNumeric ? `gid://shopify/Product/${productNumeric}` : null;
  const locale = (url.searchParams.get("locale") || "").slice(0, 10);

  const [s, c, plan] = await Promise.all([
    getCodSettings(shop),
    getConnections(shop),
    getActivePlanCached(shop, admin),
  ]);

  let builder: Record<string, any> = {};
  try {
    builder = JSON.parse(s.builderConfig || "{}");
  } catch {
    /* ignore malformed */
  }

  // The plan's monthly allowance is enforced by withholding the button —
  // never inside the customer's checkout.
  const limit = orderLimit(plan);
  const overLimit = limit >= 0 && (await getMonthlyOrderCount(shop)) >= limit;

  // ---- Wording: defaults → merchant's English → visitor's language --------
  const t: Record<TextKey, string> = { ...DEFAULT_TEXT };
  const english: Partial<Record<TextKey, string>> = {
    heading: s.headingText,
    button: builder.buttonText || s.buttonText,
    buttonSub: builder.buttonSubtitle,
    submit: builder.submitText,
    trust: builder.trustBadge,
  };
  const translated = can(plan, "languages")
    ? translationFor(parseTranslations(s.translations), locale)
    : {};
  for (const source of [english, translated]) {
    for (const [k, v] of Object.entries(source)) {
      if (typeof v === "string" && v.trim()) t[k as TextKey] = v;
    }
  }
  // The builder's text fields now carry the localized wording too.
  builder = {
    ...builder,
    buttonText: t.button,
    buttonSubtitle: t.buttonSub,
    submitText: t.submit,
    trustBadge: t.trust,
  };

  // ---- Offers ------------------------------------------------------------
  let upsells: Awaited<ReturnType<typeof resolveUpsells>> = [];
  try {
    upsells = await resolveUpsells(admin, shop);
  } catch {
    /* block still works without offers */
  }
  // Offers tied to products show only on those products; the discount is
  // shown only where Shopify's buy-X-get-Y discount will actually apply.
  const visible = upsells
    .filter((o) => o.type !== "quantity")
    .filter((o) => !o.triggerProductIds.length || (productGid && o.triggerProductIds.includes(productGid)))
    .map((o) => ({
      id: o.id,
      title: o.title,
      type: o.type,
      kind: o.kind,
      sourceTitle: o.sourceTitle,
      items: o.items,
      discountPercent:
        can(plan, "offerDiscounts") && productGid && o.triggerProductIds.includes(productGid)
          ? o.discountPercent
          : 0,
    }));

  const tiers = await tiersForProduct(shop, productGid).catch(() => []);

  // Smart recommendations come from Shopify's own storefront endpoint in the
  // browser; the app only says whether to ask and how many to show.
  const recommend =
    can(plan, "recommendations") && s.recommendEnabled
      ? { limit: Math.min(4, Math.max(1, s.recommendLimit || 2)) }
      : null;

  const downsell =
    can(plan, "downsell") && s.downsellEnabled && s.downsellCode && s.downsellPercent > 0
      ? { percent: s.downsellPercent, code: s.downsellCode }
      : null;

  // ---- Pixels (Basic) and product-specific pixels (Advanced) -------------
  const pixels = can(plan, "pixels")
    ? {
        facebook: c.fbPixelId,
        tiktok: c.tiktokPixelId,
        google: c.googleTagId,
        snapchat: c.snapPixelId,
        pinterest: c.pinterestTagId,
        extra: can(plan, "productPixels") ? pixelsForProduct(c.productPixels, productGid) : [],
      }
    : {};

  return json(
    {
      enabled: s.enabled && !overLimit,
      t,
      rtl: isRtl(locale) && Object.keys(translated).length > 0,
      builder,
      currencySymbol: s.currencySymbol,
      countdownMinutes: s.countdownMinutes,
      upsells: visible,
      tiers,
      downsell,
      recommend,
      pixels,
    },
    // Both the block and the app embed fetch this on every page view; a short
    // browser cache stops a single visit from asking twice.
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
};
