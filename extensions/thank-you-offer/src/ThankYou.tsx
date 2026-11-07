import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

// Thank-you page block: the merchant's next-order code and, optionally,
// Shopify's recommended products for what was just bought. Read-only — the
// order is complete, so nothing here changes it.

export default async () => {
  render(<Extension />, document.body);
};

type Offer = {
  enabled: boolean;
  heading: string;
  percent: number;
  code: string;
  recommend: boolean;
};

type Rec = {
  id: string;
  title: string;
  handle: string;
  featuredImage: { url: string; altText: string | null } | null;
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
};

function readOffer(): Offer | null {
  const entry = shopify.appMetafields.value.find(
    (e) => e.target.type === "shop" && e.metafield.key === "thankyou",
  );
  if (!entry) return null;
  try {
    const value = JSON.parse(String(entry.metafield.value));
    return value && value.enabled ? (value as Offer) : null;
  } catch {
    return null;
  }
}

const RECS_QUERY = `query CodRecs($id: ID!, $intent: ProductRecommendationIntent) {
  productRecommendations(productId: $id, intent: $intent) {
    id
    title
    handle
    featuredImage { url altText }
    priceRange { minVariantPrice { amount currencyCode } }
  }
}`;

function Extension() {
  const offer = readOffer();
  const [recs, setRecs] = useState<Rec[]>([]);
  const productId = shopify.lines.value[0]?.merchandise?.product?.id;
  const base = (shopify.shop.storefrontUrl || "").replace(/\/+$/, "");
  const wantRecs = Boolean(offer?.recommend && productId);

  useEffect(() => {
    if (!wantRecs || !productId) return;
    let alive = true;
    const load = async (intent: "COMPLEMENTARY" | "RELATED") => {
      const { data } = await shopify.query<{ productRecommendations: Rec[] | null }>(RECS_QUERY, {
        variables: { id: productId, intent },
      });
      return data?.productRecommendations ?? [];
    };
    (async () => {
      try {
        let list = await load("COMPLEMENTARY");
        if (!list.length) list = await load("RELATED");
        if (alive) setRecs(list.slice(0, 3));
      } catch {
        /* recommendations are optional */
      }
    })();
    return () => {
      alive = false;
    };
  }, [wantRecs, productId]);

  if (!offer || !base) return null;
  const hasCode = Boolean(offer.code && offer.percent > 0);

  // /discount/<code> stores the code in the buyer's session and then goes to
  // `redirect`, so the discount is already applied when they reach checkout.
  const link = (path: string) =>
    hasCode
      ? `${base}/discount/${encodeURIComponent(offer.code)}?redirect=${encodeURIComponent(path)}`
      : `${base}${path}`;

  return (
    <s-section heading={offer.heading || undefined}>
      <s-stack gap="base">
        {hasCode && (
          <s-stack gap="small-200">
            <s-text type="strong">{shopify.i18n.translate("offer", { percent: offer.percent })}</s-text>
            <s-text>{shopify.i18n.translate("code", { code: offer.code })}</s-text>
            <s-text color="subdued">{shopify.i18n.translate("once")}</s-text>
          </s-stack>
        )}
        {hasCode && (
          <s-button href={link("/collections/all")} variant="primary">
            {shopify.i18n.translate("shop")}
          </s-button>
        )}
        {recs.length > 0 && (
          <s-stack gap="small-200">
            <s-heading>{shopify.i18n.translate("recommended")}</s-heading>
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              {recs.map((p) => (
                <s-link key={p.id} href={link(`/products/${p.handle}`)}>
                  <s-stack gap="small-300">
                    {p.featuredImage && (
                      <s-image
                        src={p.featuredImage.url}
                        alt={p.featuredImage.altText || p.title}
                        aspectRatio="1"
                        objectFit="cover"
                      />
                    )}
                    <s-text>{p.title}</s-text>
                    <s-text color="subdued">
                      {shopify.i18n.formatCurrency(Number(p.priceRange.minVariantPrice.amount), {
                        currency: p.priceRange.minVariantPrice.currencyCode,
                      })}
                    </s-text>
                  </s-stack>
                </s-link>
              ))}
            </s-grid>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}
