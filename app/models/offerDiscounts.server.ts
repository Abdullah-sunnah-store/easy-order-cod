import prisma from "../db.server";

// Upsell offers used to be priced by the app: it set priceSet on the order line
// it created itself. App Store requirement 1.1.2 (Use Shopify checkout) rules
// that out — the app must not create the order, so it cannot price it either.
//
// Instead every discounted offer is backed by a real Shopify discount in the
// merchant's admin. The storefront form only names the code on the checkout
// URL; Shopify decides whether it applies and what it's worth. That keeps the
// money math where checkout can see it, and leaves an audit trail the merchant
// can inspect and revoke.

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

type OfferRow = {
  id: string;
  shop: string;
  title: string;
  type: string;
  offerKind: string;
  offerProductId: string;
  offerVariantId: string;
  discountPercent: number;
  minQuantity: number;
  discountId: string;
  discountCode: string;
};

const CREATE = `#graphql
  mutation CodOfferDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

const UPDATE = `#graphql
  mutation CodOfferDiscountUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

const DELETE = `#graphql
  mutation CodOfferDiscountDelete($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      userErrors { field message }
    }
  }`;

/**
 * A stable, human-readable code for an offer. Stable so re-saving an offer
 * updates the same discount instead of littering the admin with new codes, and
 * prefixed so the merchant can tell at a glance where it came from.
 */
export function codeForOffer(offer: { id: string }): string {
  return `COD-${offer.id.slice(-10).toUpperCase()}`;
}

/**
 * What the discount applies to.
 *
 * A quantity offer ("buy 3+, save 10%") discounts whatever product the customer
 * is already buying, so it has to cover the whole catalogue and lean on the
 * minimum-quantity requirement. Bump and cross-sell offers discount only the
 * item they add.
 */
function customerGets(offer: OfferRow) {
  const percentage = Math.min(100, Math.max(0, offer.discountPercent || 0)) / 100;

  if (offer.type === "quantity") {
    return {
      value: { percentage },
      items: { all: true },
      appliesOnOneTimePurchase: true,
    };
  }
  if (offer.offerKind === "collection") {
    return {
      value: { percentage },
      items: { collections: { add: [offer.offerProductId] } },
      appliesOnOneTimePurchase: true,
    };
  }
  // A pinned variant discounts just that variant; otherwise the whole product.
  return {
    value: { percentage },
    items: offer.offerVariantId
      ? { products: { productVariantsToAdd: [offer.offerVariantId] } }
      : { products: { productsToAdd: [offer.offerProductId] } },
    appliesOnOneTimePurchase: true,
  };
}

function discountInput(offer: OfferRow, code: string) {
  const input: Record<string, unknown> = {
    title: `Easy order COD — ${offer.title || "Special offer"}`,
    code,
    // No end date: the offer is switched on and off in the app, and disabling it
    // deletes the discount outright.
    startsAt: new Date().toISOString(),
    // `context` is the current field for buyer eligibility; `customerSelection`
    // is deprecated. ALL = any buyer can use the code, which is what an offer
    // shown on the product page has to mean.
    context: { all: "ALL" },
    customerGets: customerGets(offer),
    // Several offers can be accepted on one order, so the codes have to stack.
    combinesWith: {
      productDiscounts: true,
      orderDiscounts: true,
      shippingDiscounts: true,
    },
    appliesOncePerCustomer: false,
  };
  // "Buy 3+ and save" is the quantity condition, enforced by Shopify rather
  // than by the form's own arithmetic.
  if (offer.type === "quantity" && offer.minQuantity > 1) {
    input.minimumRequirement = {
      quantity: { greaterThanOrEqualToQuantity: String(offer.minQuantity) },
    };
  }
  return input;
}

function firstError(payload: any): string | null {
  const errors = payload?.userErrors ?? [];
  return errors.length ? errors.map((e: any) => e.message).join(" ") : null;
}

/**
 * Creates or updates the Shopify discount behind an offer, and records its id
 * and code on the offer row.
 *
 * An offer with no discount percentage needs no discount at all — its items go
 * into the cart at their normal price. Any existing discount is removed so a
 * percentage that was edited down to zero doesn't keep applying.
 *
 * Returns the code to put on the checkout URL, or null when there is none.
 * Never throws: a discount that can't be created is a degraded offer, not a
 * reason to fail the merchant's save.
 */
export async function syncOfferDiscount(
  admin: AdminClient,
  offerId: string,
): Promise<string | null> {
  const offer = (await prisma.upsell.findUnique({
    where: { id: offerId },
  })) as (OfferRow & { enabled: boolean }) | null;
  if (!offer) return null;

  if (!needsDiscount(offer)) {
    await removeOfferDiscount(admin, offer);
    return null;
  }

  const code = offer.discountCode || codeForOffer(offer);
  const basicCodeDiscount = discountInput(offer, code);

  try {
    // Update the existing discount when we already made one, so editing an
    // offer doesn't leave a second live code behind.
    if (offer.discountId) {
      const res = await admin.graphql(UPDATE, {
        variables: { id: offer.discountId, basicCodeDiscount },
      });
      const payload = (await res.json())?.data?.discountCodeBasicUpdate;
      const error = firstError(payload);
      if (!error && payload?.codeDiscountNode?.id) {
        await prisma.upsell.updateMany({
          where: { id: offer.id },
          data: { discountId: payload.codeDiscountNode.id, discountCode: code },
        });
        return code;
      }
      // The merchant deleted it in the Shopify admin — fall through and make a
      // fresh one rather than leaving the offer silently undiscounted.
      console.warn("COD: offer discount update failed, recreating:", error);
    }

    const res = await admin.graphql(CREATE, { variables: { basicCodeDiscount } });
    const payload = (await res.json())?.data?.discountCodeBasicCreate;
    const error = firstError(payload);
    if (error || !payload?.codeDiscountNode?.id) {
      console.warn("COD: could not create offer discount:", error);
      return null;
    }
    await prisma.upsell.updateMany({
      where: { id: offer.id },
      data: { discountId: payload.codeDiscountNode.id, discountCode: code },
    });
    return code;
  } catch (e: any) {
    console.warn("COD: offer discount sync threw:", e?.message || e);
    return null;
  }
}

/** True when this offer needs a Shopify discount to exist. */
function needsDiscount(offer: OfferRow & { enabled?: boolean }): boolean {
  return (offer.discountPercent || 0) > 0 && offer.enabled !== false;
}

/**
 * Removes the Shopify discount behind an offer, if it has one, and clears the
 * stored id/code. Safe to call for an offer that never had one.
 */
export async function removeOfferDiscount(
  admin: AdminClient,
  offer: Pick<OfferRow, "id" | "discountId">,
): Promise<void> {
  if (!offer.discountId) return;
  try {
    const res = await admin.graphql(DELETE, { variables: { id: offer.discountId } });
    const error = firstError((await res.json())?.data?.discountCodeDelete);
    // A discount the merchant already deleted by hand is not a failure — the
    // goal state (no discount) is what we wanted.
    if (error && !/not found|does not exist/i.test(error)) {
      console.warn("COD: could not delete offer discount:", error);
    }
  } catch (e: any) {
    console.warn("COD: offer discount delete threw:", e?.message || e);
  }
  await prisma.upsell.updateMany({
    where: { id: offer.id },
    data: { discountId: "", discountCode: "" },
  });
}
