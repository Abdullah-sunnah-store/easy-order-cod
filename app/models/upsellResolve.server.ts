import { listUpsells } from "./upsells.server";

// Turns the offers stored on the Upsells page into something the storefront can
// actually add to an order.
//
// What the merchant picked is a product or a collection GID. The form needs
// concrete variants with current prices, so every offer is resolved against the
// Admin API here. The same resolution runs again when the order is created, so
// the price charged is never the one the browser sent.

export type OfferItem = {
  variantId: string;
  productId: string;
  title: string;
  image: string;
  /** Undiscounted unit price, in the shop's major currency unit. */
  price: number;
};

export type ResolvedOffer = {
  id: string;
  title: string;
  type: string; // "bump" | "quantity" | "cross_sell"
  kind: string; // "product" | "collection"
  discountPercent: number;
  minQuantity: number;
  /** Source label, e.g. the collection's name. */
  sourceTitle: string;
  items: OfferItem[];
};

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

const VARIANT_QUERY = `#graphql
  query CodUpsellVariant($id: ID!) {
    productVariant(id: $id) {
      id
      price
      image { url }
      product { id title featuredImage { url } }
    }
  }`;

const PRODUCT_QUERY = `#graphql
  query CodUpsellProduct($id: ID!) {
    product(id: $id) {
      id
      title
      featuredImage { url }
      variants(first: 1) { nodes { id price } }
    }
  }`;

// 12 is enough to fill a picker without making the form scroll forever.
const COLLECTION_QUERY = `#graphql
  query CodUpsellCollection($id: ID!) {
    collection(id: $id) {
      id
      title
      products(first: 12) {
        nodes {
          id
          title
          featuredImage { url }
          variants(first: 1) { nodes { id price } }
        }
      }
    }
  }`;

async function resolveOne(
  admin: AdminClient,
  offer: any,
): Promise<ResolvedOffer | null> {
  const base = {
    id: offer.id,
    title: offer.title,
    type: offer.type,
    kind: offer.offerKind || "product",
    discountPercent: Math.min(100, Math.max(0, offer.discountPercent || 0)),
    minQuantity: Math.max(1, offer.minQuantity || 1),
  };

  if (base.kind === "collection") {
    const r = await admin.graphql(COLLECTION_QUERY, {
      variables: { id: offer.offerProductId },
    });
    const c = (await r.json())?.data?.collection;
    if (!c) return null;
    const items: OfferItem[] = (c.products?.nodes || [])
      .map((p: any) => {
        const v = p?.variants?.nodes?.[0];
        if (!v?.id) return null;
        return {
          variantId: v.id,
          productId: p.id,
          title: p.title || "",
          image: p.featuredImage?.url || "",
          price: Number(v.price) || 0,
        };
      })
      .filter(Boolean);
    if (items.length === 0) return null;
    return { ...base, sourceTitle: c.title || offer.offerProductTitle, items };
  }

  // A pinned variant (multi-variant product) resolves directly; otherwise take
  // the product's only variant.
  if (offer.offerVariantId) {
    const r = await admin.graphql(VARIANT_QUERY, {
      variables: { id: offer.offerVariantId },
    });
    const v = (await r.json())?.data?.productVariant;
    if (!v?.id) return null;
    return {
      ...base,
      sourceTitle: v.product?.title || offer.offerProductTitle,
      items: [
        {
          variantId: v.id,
          productId: v.product?.id || offer.offerProductId,
          title: v.product?.title || offer.offerProductTitle,
          image: v.image?.url || v.product?.featuredImage?.url || "",
          price: Number(v.price) || 0,
        },
      ],
    };
  }

  const r = await admin.graphql(PRODUCT_QUERY, {
    variables: { id: offer.offerProductId },
  });
  const p = (await r.json())?.data?.product;
  const v = p?.variants?.nodes?.[0];
  if (!p || !v?.id) return null;
  return {
    ...base,
    sourceTitle: p.title || offer.offerProductTitle,
    items: [
      {
        variantId: v.id,
        productId: p.id,
        title: p.title || offer.offerProductTitle,
        image: p.featuredImage?.url || "",
        price: Number(v.price) || 0,
      },
    ],
  };
}

// Every product-page view hits /apps/cod/settings, so the storefront reads
// through a short cache. Order creation passes fresh:true — a stale price would
// end up on a real order.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; offers: ResolvedOffer[] }>();

export async function resolveUpsells(
  admin: AdminClient,
  shop: string,
  opts: { fresh?: boolean } = {},
): Promise<ResolvedOffer[]> {
  if (!opts.fresh) {
    const hit = cache.get(shop);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.offers;
  }

  const stored = (await listUpsells(shop)).filter(
    (u: any) => u.enabled && u.offerProductId,
  );
  const resolved: ResolvedOffer[] = [];
  for (const offer of stored) {
    try {
      const one = await resolveOne(admin, offer);
      if (one) resolved.push(one);
    } catch {
      // A deleted product or a revoked scope shouldn't take the whole form
      // down — drop that offer and keep the rest.
    }
  }
  if (!opts.fresh) cache.set(shop, { at: Date.now(), offers: resolved });
  return resolved;
}

/** Unit price after the offer's discount, rounded to cents. */
export function discountedPrice(price: number, discountPercent: number): number {
  const pct = Math.min(100, Math.max(0, discountPercent || 0));
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}

/**
 * The best quantity-offer discount for a given main-item quantity. Quantity
 * offers discount the product being bought rather than adding an item.
 */
export function quantityDiscountFor(
  offers: ResolvedOffer[],
  quantity: number,
): number {
  return offers
    .filter((o) => o.type === "quantity" && quantity >= o.minQuantity)
    .reduce((best, o) => Math.max(best, o.discountPercent), 0);
}
