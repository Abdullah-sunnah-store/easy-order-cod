// @ts-check

/**
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunInput} CartPaymentMethodsTransformRunInput
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunResult} CartPaymentMethodsTransformRunResult
 */

/** @type {CartPaymentMethodsTransformRunResult} */
const NO_CHANGES = { operations: [] };

// Shopify's manual method is called "Cash on Delivery (COD)" by default;
// merchants often rename it ("Cash on delivery", "COD", "Pay on delivery").
const COD_NAME = /cash\s*on\s*delivery|pay(ment)?\s*on\s*delivery|\bcod\b/i;

/**
 * Merchant settings (Fraud & delivery page), all optional:
 *   codOnly      true  = carts from the COD button see only Cash on Delivery
 *                false = Cash on Delivery is moved to the top instead
 *   blockedZips  postal codes where COD is not offered; "1212*" = prefix
 *   minTotal     COD only from this order total (shop currency)
 *   maxTotal     COD only up to this order total
 * @param {any} raw
 */
function readConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const num = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? v : null);
  return {
    codOnly: c.codOnly !== false,
    blockedZips: Array.isArray(c.blockedZips) ? c.blockedZips.map((z) => String(z).trim().toUpperCase()).filter(Boolean) : [],
    minTotal: num(c.minTotal),
    maxTotal: num(c.maxTotal),
  };
}

/** @param {string} zip @param {string[]} rules */
function zipBlocked(zip, rules) {
  const z = zip.replace(/\s+/g, "").toUpperCase();
  if (!z) return false;
  return rules.some((r) => {
    const rule = r.replace(/\s+/g, "");
    return rule.endsWith("*") ? z.startsWith(rule.slice(0, -1)) : z === rule;
  });
}

/**
 * 1. COD rules (every cart): hide Cash on Delivery for blocked postal codes or
 *    an order total outside the merchant's min/max.
 * 2. Carts from the COD button: Cash on Delivery is the payment — the other
 *    methods are hidden (or COD is moved to the top, if the merchant prefers).
 *
 * @param {CartPaymentMethodsTransformRunInput} input
 * @returns {CartPaymentMethodsTransformRunResult}
 */
export function cartPaymentMethodsTransformRun(input) {
  const methods = input.paymentMethods || [];
  const cod = methods.find((m) => COD_NAME.test(m.name || ""));
  if (!cod) return NO_CHANGES;

  const cfg = readConfig(input.paymentCustomization?.metafield?.jsonValue);
  const total = Number(input.cart?.cost?.totalAmount?.amount ?? 0);
  const zips = (input.cart?.deliveryGroups || []).map((g) => g?.deliveryAddress?.zip || "");

  const codNotAllowed =
    (cfg.blockedZips.length > 0 && zips.some((z) => zipBlocked(z, cfg.blockedZips))) ||
    (cfg.minTotal !== null && total < cfg.minTotal) ||
    (cfg.maxTotal !== null && total > cfg.maxTotal);
  if (codNotAllowed) {
    return { operations: [{ paymentMethodHide: { paymentMethodId: cod.id } }] };
  }

  const fromCodButton = input.cart?.codButton?.value === "1";
  if (!fromCodButton) return NO_CHANGES;

  if (!cfg.codOnly) {
    return { operations: [{ paymentMethodMove: { paymentMethodId: cod.id, index: 0 } }] };
  }
  return {
    operations: methods
      .filter((m) => m.id !== cod.id)
      .map((m) => ({ paymentMethodHide: { paymentMethodId: m.id } })),
  };
}
