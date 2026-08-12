import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCodSettings } from "../models/codSettings.server";
import { getConnections } from "../models/connections.server";
import { getActivePlan } from "../models/billing.server";
import { can } from "../lib/plans";

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
  let shippingOptions: Array<{ name: string; price: number }> = [];
  try {
    const parsed = JSON.parse(s.shippingOptions || "[]");
    if (Array.isArray(parsed)) shippingOptions = parsed;
  } catch {
    /* ignore malformed */
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
