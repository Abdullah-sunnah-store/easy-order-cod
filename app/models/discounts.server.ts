// Real Shopify discounts behind every offer the form shows.
//
// The app never prices a checkout line itself (App Store requirement 1.1.2).
// Instead each offer becomes an ordinary Shopify discount, so checkout applies
// it on its own and the merchant can see it under Shopify → Discounts:
//
//   quantity tier   "Buy 3+, save 15%"     → automatic amount-off discount with a
//                                             minimum quantity, on the offer's products
//   bundle / upsell "Add X for 20% off"    → automatic buy-X-get-Y discount:
//                                             buy a trigger product, get X at 20% off
//   downsell        "Wait! 10% off"        → code discount, applied at checkout
//                                             through /discount/<code>
//
// Every discount is tagged so it can be found again, and is deleted when the
// offer is deleted.

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

export const DISCOUNT_TAG = "easy-order-cod";

export class DiscountError extends Error {}

async function run(admin: AdminClient, query: string, variables: Record<string, unknown>) {
  const response = await admin.graphql(query, { variables });
  const body: any = await response.json();
  if (body?.errors?.length) {
    throw new DiscountError(body.errors.map((e: any) => e.message).join(" "));
  }
  return body?.data ?? {};
}

function userErrors(payload: any): string {
  const errors = payload?.userErrors ?? [];
  return errors.map((e: any) => e.message).join(" ");
}

const pct = (percent: number) => Math.min(100, Math.max(0, percent)) / 100;

function items(productIds: string[]) {
  return productIds.length ? { products: { productsToAdd: productIds } } : { all: true };
}

// Product discounts from this app must not stack on each other (a tier plus a
// bundle on the same line would undercut the merchant), but free shipping and
// order-level codes may still apply on top.
const COMBINES = { productDiscounts: false, orderDiscounts: true, shippingDiscounts: true };

// ---------------------------------------------------------------------------
// Quantity tiers
// ---------------------------------------------------------------------------

export type Tier = { qty: number; percent: number; label?: string; badge?: string };

const AUTOMATIC_BASIC_CREATE = `#graphql
  mutation CodTierDiscount($input: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $input) {
      automaticDiscountNode { id }
      userErrors { field message }
    }
  }`;

/**
 * One automatic discount per discounted tier. Shopify applies the best
 * product discount that qualifies, so with 2+ → 10% and 3+ → 15% a cart with
 * three units gets 15%. The minimum quantity counts only the offer's products.
 */
export async function createTierDiscounts(
  admin: AdminClient,
  title: string,
  productIds: string[],
  tiers: Tier[],
): Promise<string[]> {
  const created: string[] = [];
  try {
    for (const tier of tiers) {
      if (tier.percent <= 0 || tier.qty < 2) continue;
      const data = await run(admin, AUTOMATIC_BASIC_CREATE, {
        input: {
          title: `${title} — buy ${tier.qty}+, ${tier.percent}% off`,
          startsAt: new Date().toISOString(),
          tags: [DISCOUNT_TAG],
          combinesWith: COMBINES,
          minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: String(tier.qty) } },
          customerGets: { value: { percentage: pct(tier.percent) }, items: items(productIds) },
        },
      });
      const payload = data.discountAutomaticBasicCreate;
      const id = payload?.automaticDiscountNode?.id;
      if (!id) throw new DiscountError(userErrors(payload) || "Shopify did not create the discount.");
      created.push(id);
    }
  } catch (error) {
    // All or nothing: a half-created offer would show tiers checkout ignores.
    await deleteAutomaticDiscounts(admin, created);
    throw error;
  }
  return created;
}

// ---------------------------------------------------------------------------
// Bundles / discounted upsells
// ---------------------------------------------------------------------------

const AUTOMATIC_BXGY_CREATE = `#graphql
  mutation CodBundleDiscount($input: DiscountAutomaticBxgyInput!) {
    discountAutomaticBxgyCreate(automaticBxgyDiscount: $input) {
      automaticDiscountNode { id }
      userErrors { field message }
    }
  }`;

/**
 * Buy any one trigger product, get one offered item at `percent` off (100 =
 * free gift). Offered items are a product, a single variant or a collection.
 */
export async function createBundleDiscount(
  admin: AdminClient,
  args: {
    title: string;
    percent: number;
    triggerProductIds: string[];
    offer: { kind: string; productId: string; variantId?: string };
  },
): Promise<string> {
  if (!args.triggerProductIds.length) {
    throw new DiscountError("Choose at least one product this offer is for — Shopify needs it to apply the discount.");
  }
  const gets =
    args.offer.kind === "collection"
      ? { collections: { add: [args.offer.productId] } }
      : args.offer.variantId
        ? { products: { productVariantsToAdd: [args.offer.variantId] } }
        : { products: { productsToAdd: [args.offer.productId] } };

  const data = await run(admin, AUTOMATIC_BXGY_CREATE, {
    input: {
      title: `${args.title} — ${args.percent >= 100 ? "free" : `${args.percent}% off`}`,
      startsAt: new Date().toISOString(),
      tags: [DISCOUNT_TAG],
      combinesWith: COMBINES,
      usesPerOrderLimit: "1",
      customerBuys: {
        value: { quantity: "1" },
        items: { products: { productsToAdd: args.triggerProductIds } },
      },
      customerGets: {
        value: { discountOnQuantity: { quantity: "1", effect: { percentage: pct(args.percent) } } },
        items: gets,
      },
    },
  });
  const payload = data.discountAutomaticBxgyCreate;
  const id = payload?.automaticDiscountNode?.id;
  if (!id) throw new DiscountError(userErrors(payload) || "Shopify did not create the discount.");
  return id;
}

// ---------------------------------------------------------------------------
// Downsell code
// ---------------------------------------------------------------------------

const CODE_BASIC_CREATE = `#graphql
  mutation CodDownsellDiscount($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

export function newDownsellCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `COD${out}`;
}

export async function createDownsellCode(
  admin: AdminClient,
  code: string,
  percent: number,
  opts: { title?: string; oncePerCustomer?: boolean } = {},
): Promise<string> {
  const data = await run(admin, CODE_BASIC_CREATE, {
    input: {
      title: opts.title ?? `Easy order COD downsell — ${percent}% off`,
      code,
      startsAt: new Date().toISOString(),
      tags: [DISCOUNT_TAG],
      context: { all: "ALL" },
      appliesOncePerCustomer: Boolean(opts.oncePerCustomer),
      // Stacks on quantity/bundle discounts: otherwise checkout would reject
      // the code the customer was just promised whenever a tier applies.
      combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: true },
      customerGets: { value: { percentage: pct(percent) }, items: { all: true } },
    },
  });
  const payload = data.discountCodeBasicCreate;
  const id = payload?.codeDiscountNode?.id;
  if (!id) throw new DiscountError(userErrors(payload) || "Shopify did not create the discount code.");
  return id;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const AUTOMATIC_DELETE = `#graphql
  mutation CodDeleteAutomatic($id: ID!) {
    discountAutomaticDelete(id: $id) { deletedAutomaticDiscountId userErrors { message } }
  }`;
const CODE_DELETE = `#graphql
  mutation CodDeleteCode($id: ID!) {
    discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { message } }
  }`;
const AUTOMATIC_ACTIVATE = `#graphql
  mutation CodActivate($id: ID!) {
    discountAutomaticActivate(id: $id) { userErrors { message } }
  }`;
const AUTOMATIC_DEACTIVATE = `#graphql
  mutation CodDeactivate($id: ID!) {
    discountAutomaticDeactivate(id: $id) { userErrors { message } }
  }`;

/** Best effort: a discount the merchant already deleted in Shopify is fine. */
export async function deleteAutomaticDiscounts(admin: AdminClient, ids: string[]) {
  for (const id of ids.filter(Boolean)) {
    await run(admin, AUTOMATIC_DELETE, { id }).catch((e) =>
      console.warn(`COD: could not delete discount ${id}:`, e?.message || e),
    );
  }
}

export async function deleteCodeDiscount(admin: AdminClient, id: string) {
  if (!id) return;
  await run(admin, CODE_DELETE, { id }).catch((e) =>
    console.warn(`COD: could not delete code ${id}:`, e?.message || e),
  );
}

export async function setAutomaticDiscountsActive(admin: AdminClient, ids: string[], active: boolean) {
  for (const id of ids.filter(Boolean)) {
    await run(admin, active ? AUTOMATIC_ACTIVATE : AUTOMATIC_DEACTIVATE, { id }).catch((e) =>
      console.warn(`COD: could not ${active ? "activate" : "deactivate"} ${id}:`, e?.message || e),
    );
  }
}

/** JSON column helpers shared by the offer models. */
export function parseIds(raw: string | null | undefined): string[] {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}
