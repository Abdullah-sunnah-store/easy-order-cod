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
 * For a cart that came from the COD button, hide every payment method except
 * Cash on Delivery so checkout uses it. Any other cart is untouched, and so is
 * a store that doesn't offer Cash on Delivery at all.
 *
 * @param {CartPaymentMethodsTransformRunInput} input
 * @returns {CartPaymentMethodsTransformRunResult}
 */
export function cartPaymentMethodsTransformRun(input) {
  const fromCodButton = input.cart?.codButton?.value === "1";
  if (!fromCodButton) return NO_CHANGES;

  const methods = input.paymentMethods || [];
  const cod = methods.find((m) => COD_NAME.test(m.name || ""));
  if (!cod) return NO_CHANGES;

  return {
    operations: methods
      .filter((m) => m.id !== cod.id)
      .map((m) => ({ paymentMethodHide: { paymentMethodId: m.id } })),
  };
}
