import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  InlineStack,
  TextField,
  Text,
  Button,
  Banner,
  Badge,
  IndexTable,
  EmptyState,
  Tag,
  Checkbox,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getActivePlan } from "../models/billing.server";
import {
  createQuantityOffer,
  deleteQuantityOffer,
  listQuantityOffers,
  normaliseTiers,
  parseTiers,
  toggleQuantityOffer,
} from "../models/quantityOffers.server";
import {
  DiscountError,
  createDownsellCode,
  deleteCodeDiscount,
  newDownsellCode,
  parseIds,
} from "../models/discounts.server";
import { getCodSettings, updateCodSettings } from "../models/codSettings.server";
import { setShopAppMetafield } from "../models/appMetafield.server";
import { UpgradeNotice } from "../components/UpgradeNotice";
import { can, quantityOfferLimit, FEATURE_MIN_PLAN } from "../lib/plans";
import { MAX_TIERS } from "../lib/offers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getActivePlan(admin);
  const offers = (await listQuantityOffers(session.shop)).map((o) => ({
    id: o.id,
    title: o.title,
    enabled: o.enabled,
    productTitles: parseIds(o.productTitles),
    tiers: parseTiers(o.tiers),
  }));
  const settings = await getCodSettings(session.shop);
  return {
    offers,
    limit: quantityOfferLimit(plan),
    downsell: {
      enabled: settings.downsellEnabled,
      percent: settings.downsellPercent || 10,
      code: settings.downsellCode,
    },
    canDownsell: can(plan, "downsell"),
    thankYou: {
      enabled: settings.thankYouEnabled,
      percent: settings.thankYouPercent || 10,
      heading: settings.thankYouHeading,
      code: settings.thankYouCode,
      recommend: settings.thankYouRecommend,
    },
    canThankYou: can(plan, "thankYou"),
    canRecommend: can(plan, "recommendations"),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  try {
    if (intent === "create") {
      const limit = quantityOfferLimit(await getActivePlan(admin));
      if (limit >= 0 && (await listQuantityOffers(session.shop)).length >= limit) {
        return { ok: false, error: `Your plan includes ${limit} quantity offer${limit === 1 ? "" : "s"}. Upgrade to add more.` };
      }
      let rawTiers: unknown = [];
      let productIds: string[] = [];
      let productTitles: string[] = [];
      try {
        rawTiers = JSON.parse(String(form.get("tiers") || "[]"));
        productIds = JSON.parse(String(form.get("productIds") || "[]"));
        productTitles = JSON.parse(String(form.get("productTitles") || "[]"));
      } catch {
        return { ok: false, error: "The offer could not be read. Reload the page and try again." };
      }
      const tiers = normaliseTiers(rawTiers);
      if (!tiers.some((t) => t.qty >= 2 && t.percent > 0)) {
        return { ok: false, error: "Add at least one tier of 2 or more items with a discount." };
      }
      await createQuantityOffer(admin, session.shop, {
        title: String(form.get("title") || "Quantity offer").slice(0, 80),
        productIds: productIds.filter((id) => typeof id === "string" && id.startsWith("gid://shopify/Product/")),
        productTitles: productTitles.map(String).slice(0, 50),
        tiers,
      });
      return { ok: true, message: "Offer created — its discounts are live in Shopify." };
    }
    if (intent === "downsell") {
      if (!can(await getActivePlan(admin), "downsell")) {
        return { ok: false, error: `The downsell is on the ${FEATURE_MIN_PLAN.downsell} plan.` };
      }
      const enabled = form.get("enabled") === "true";
      const percent = Math.min(50, Math.max(1, parseInt(String(form.get("percent") || "10"), 10) || 10));
      const current = await getCodSettings(session.shop);

      // A code that no longer matches the settings is retired, never left live.
      const keep = enabled && current.downsellDiscountId && current.downsellPercent === percent;
      if (!keep && current.downsellDiscountId) {
        await deleteCodeDiscount(admin, current.downsellDiscountId);
      }
      let code = keep ? current.downsellCode : "";
      let discountId = keep ? current.downsellDiscountId : "";
      if (enabled && !keep) {
        code = newDownsellCode();
        discountId = await createDownsellCode(admin, code, percent);
      }
      await updateCodSettings(session.shop, {
        downsellEnabled: enabled,
        downsellPercent: percent,
        downsellCode: code,
        downsellDiscountId: discountId,
      });
      return { ok: true, message: enabled ? `Downsell on — code ${code}` : "Downsell off" };
    }
    if (intent === "thankYou") {
      const plan = await getActivePlan(admin);
      if (!can(plan, "thankYou")) {
        return { ok: false, error: `The thank-you offer is on the ${FEATURE_MIN_PLAN.thankYou} plan.` };
      }
      const enabled = form.get("enabled") === "true";
      const percent = Math.min(50, Math.max(0, parseInt(String(form.get("percent") || "0"), 10) || 0));
      const heading = String(form.get("heading") || "").slice(0, 80) || "Thanks for your order!";
      const recommend = can(plan, "recommendations") && form.get("recommend") === "true";
      const current = await getCodSettings(session.shop);

      // Same rule as the downsell: a code that no longer matches is retired.
      const keep = enabled && percent > 0 && current.thankYouDiscountId && current.thankYouPercent === percent;
      if (!keep && current.thankYouDiscountId) await deleteCodeDiscount(admin, current.thankYouDiscountId);
      let code = keep ? current.thankYouCode : "";
      let discountId = keep ? current.thankYouDiscountId : "";
      if (enabled && percent > 0 && !keep) {
        code = newDownsellCode().replace(/^COD/, "THANKS");
        discountId = await createDownsellCode(admin, code, percent, {
          title: `Easy order COD thank-you — ${percent}% off next order`,
          oncePerCustomer: true,
        });
      }
      // What the checkout extension reads.
      await setShopAppMetafield(admin, "thankyou", { enabled, heading, percent, code, recommend });
      await updateCodSettings(session.shop, {
        thankYouEnabled: enabled,
        thankYouPercent: percent,
        thankYouHeading: heading,
        thankYouCode: code,
        thankYouDiscountId: discountId,
        thankYouRecommend: recommend,
      });
      return { ok: true, message: enabled ? "Thank-you offer saved" : "Thank-you offer off" };
    }
    if (intent === "delete") {
      await deleteQuantityOffer(admin, session.shop, String(form.get("id")));
      return { ok: true, message: "Offer and its discounts deleted" };
    }
    if (intent === "toggle") {
      await toggleQuantityOffer(admin, session.shop, String(form.get("id")), form.get("enabled") === "true");
      return { ok: true, message: "Offer updated" };
    }
  } catch (error) {
    const message =
      error instanceof DiscountError
        ? `Shopify refused the discount: ${error.message}`
        : "Something went wrong saving the offer. Try again.";
    console.error("COD offers:", error);
    return { ok: false, error: message };
  }
  return { ok: false, error: "Unknown action." };
};

type TierRow = { qty: string; percent: string; label: string; badge: string };

const DEFAULT_TIERS: TierRow[] = [
  { qty: "1", percent: "0", label: "Buy 1", badge: "" },
  { qty: "2", percent: "10", label: "Buy 2", badge: "Most popular" },
  { qty: "3", percent: "15", label: "Buy 3", badge: "Best value" },
];

export default function OffersPage() {
  const { offers, limit, downsell, canDownsell } = useLoaderData<typeof loader>();
  const [dsEnabled, setDsEnabled] = useState(downsell.enabled);
  const [dsPercent, setDsPercent] = useState(String(downsell.percent));
  const { thankYou, canThankYou, canRecommend } = useLoaderData<typeof loader>();
  const [tyEnabled, setTyEnabled] = useState(thankYou.enabled);
  const [tyPercent, setTyPercent] = useState(String(thankYou.percent));
  const [tyHeading, setTyHeading] = useState(thankYou.heading);
  const [tyRecommend, setTyRecommend] = useState(thankYou.recommend);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [title, setTitle] = useState("Quantity offer");
  const [tiers, setTiers] = useState<TierRow[]>(DEFAULT_TIERS);
  const [products, setProducts] = useState<{ id: string; title: string }[]>([]);
  const busy = fetcher.state !== "idle";
  const atLimit = limit >= 0 && offers.length >= limit;
  const data = fetcher.data as any;

  useEffect(() => {
    if (data?.ok && data.message) {
      shopify.toast.show(data.message);
      if (data.message.startsWith("Offer created")) {
        setTitle("Quantity offer");
        setTiers(DEFAULT_TIERS);
        setProducts([]);
      }
    }
  }, [data, shopify]);

  const pickProducts = async () => {
    const selection: any = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: true,
      filter: { variants: false },
      selectionIds: products.map((p) => ({ id: p.id })),
    });
    if (selection) setProducts(selection.map((p: any) => ({ id: p.id, title: p.title })));
  };

  const setTier = (index: number, key: keyof TierRow) => (value: string) =>
    setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, [key]: value } : t)));

  const submit = (fields: Record<string, string>) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    fetcher.submit(fd, { method: "POST" });
  };

  const create = () =>
    submit({
      intent: "create",
      title,
      tiers: JSON.stringify(tiers),
      productIds: JSON.stringify(products.map((p) => p.id)),
      productTitles: JSON.stringify(products.map((p) => p.title)),
    });

  return (
    <Page>
      <TitleBar title="Quantity offers" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Create a quantity offer</Text>
                <Text as="p" tone="subdued">
                  Customers pick a pack size in the COD form ("Buy 2, save 10%"). Each tier
                  becomes an automatic discount in Shopify → Discounts, so checkout charges
                  exactly what the form shows — including for shoppers who add the same
                  quantity through the normal cart.
                </Text>
              </BlockStack>
              {data && !data.ok && data.error && <Banner tone="critical">{data.error}</Banner>}
              {atLimit && (
                <Banner tone="info">
                  Your plan includes {limit} quantity offer{limit === 1 ? "" : "s"}.{" "}
                  <Link to="/app/plans">Upgrade</Link> for unlimited offers.
                </Banner>
              )}
              <TextField label="Offer name" autoComplete="off" value={title} onChange={setTitle} helpText="Shown in Shopify → Discounts, not to customers." />

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Products</Text>
                <InlineStack gap="200" blockAlign="center">
                  {products.length === 0 ? (
                    <Text as="span" tone="subdued">All products</Text>
                  ) : (
                    products.map((p) => (
                      <Tag key={p.id} onRemove={() => setProducts((prev) => prev.filter((x) => x.id !== p.id))}>
                        {p.title}
                      </Tag>
                    ))
                  )}
                  <Button onClick={pickProducts}>{products.length ? "Change products" : "Choose products"}</Button>
                </InlineStack>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Tiers</Text>
                {tiers.map((tier, i) => (
                  <InlineGrid key={i} columns={{ xs: 2, md: "1fr 1fr 2fr 2fr auto" }} gap="200" alignItems="end">
                    <TextField label="Quantity" type="number" min={1} autoComplete="off" value={tier.qty} onChange={setTier(i, "qty")} />
                    <TextField label="% off" type="number" min={0} max={90} autoComplete="off" value={tier.percent} onChange={setTier(i, "percent")} disabled={tier.qty === "1"} />
                    <TextField label="Label" autoComplete="off" value={tier.label} onChange={setTier(i, "label")} placeholder={`Buy ${tier.qty || "N"}`} />
                    <TextField label="Badge" autoComplete="off" value={tier.badge} onChange={setTier(i, "badge")} placeholder="Most popular" />
                    <Button variant="plain" tone="critical" onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))} disabled={tiers.length <= 1}>
                      Remove
                    </Button>
                  </InlineGrid>
                ))}
                <div>
                  <Button
                    onClick={() => setTiers((prev) => [...prev, { qty: String((Number(prev[prev.length - 1]?.qty) || 1) + 1), percent: "20", label: "", badge: "" }])}
                    disabled={tiers.length >= MAX_TIERS}
                  >
                    Add tier
                  </Button>
                </div>
              </BlockStack>

              <div>
                <Button variant="primary" loading={busy} disabled={atLimit} onClick={create}>
                  Create offer
                </Button>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Downsell</Text>
              <Text as="p" tone="subdued">
                When a customer closes the COD form without continuing, offer a discount
                once ("Wait! Take 10% off"). Accepting applies a real Shopify discount
                code at checkout.
              </Text>
              {!canDownsell && <UpgradeNotice required={FEATURE_MIN_PLAN.downsell} />}
              <Checkbox label="Show a downsell when the form is closed" checked={dsEnabled} onChange={setDsEnabled} disabled={!canDownsell} />
              <TextField
                label="Discount (%)"
                type="number"
                min={1}
                max={50}
                autoComplete="off"
                value={dsPercent}
                onChange={setDsPercent}
                disabled={!canDownsell || !dsEnabled}
                helpText={
                  downsell.enabled && downsell.code
                    ? `Live code: ${downsell.code}. Anyone who has the code can use it — change the % to issue a new one.`
                    : "Applies to the whole order, on top of any quantity or bundle discount."
                }
              />
              <div>
                <Button loading={busy} disabled={!canDownsell} onClick={() => submit({ intent: "downsell", enabled: String(dsEnabled), percent: dsPercent })}>
                  Save downsell
                </Button>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Thank-you page offer</Text>
              <Text as="p" tone="subdued">
                After a COD order, show "{tyPercent || "10"}% off your next order" on Shopify's
                thank-you page — a once-per-customer code that's applied automatically from the
                link. (Shopify doesn't show post-purchase pages for Cash on Delivery, so the
                thank-you page is where this goes.)
              </Text>
              {!canThankYou && <UpgradeNotice required={FEATURE_MIN_PLAN.thankYou} />}
              <Checkbox label="Show the thank-you offer" checked={tyEnabled} onChange={setTyEnabled} disabled={!canThankYou} />
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                <TextField label="Heading" autoComplete="off" value={tyHeading} onChange={setTyHeading} disabled={!canThankYou || !tyEnabled} />
                <TextField
                  label="Next-order discount (%)"
                  type="number"
                  min={0}
                  max={50}
                  autoComplete="off"
                  value={tyPercent}
                  onChange={setTyPercent}
                  disabled={!canThankYou || !tyEnabled}
                  helpText={thankYou.enabled && thankYou.code ? `Live code: ${thankYou.code}` : "0 = no code, recommendations only."}
                />
              </InlineGrid>
              <Checkbox
                label="Also show Shopify's recommended products"
                checked={tyRecommend && canRecommend}
                onChange={setTyRecommend}
                disabled={!canThankYou || !tyEnabled || !canRecommend}
                helpText={canRecommend ? undefined : `On the ${FEATURE_MIN_PLAN.recommendations} plan.`}
              />
              <Banner tone="info">
                After saving, add the block once: <b>Settings → Checkout → Customize → Thank you page →
                Add app block → Easy order COD offer</b>.
              </Banner>
              <div>
                <Button
                  loading={busy}
                  disabled={!canThankYou}
                  onClick={() =>
                    submit({ intent: "thankYou", enabled: String(tyEnabled), percent: tyPercent, heading: tyHeading, recommend: String(tyRecommend) })
                  }
                >
                  Save thank-you offer
                </Button>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            {offers.length === 0 ? (
              <EmptyState heading="No quantity offers yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                <p>Quantity breaks are the fastest way to raise average order value on COD.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "offer", plural: "offers" }}
                itemCount={offers.length}
                selectable={false}
                headings={[{ title: "Offer" }, { title: "Products" }, { title: "Tiers" }, { title: "Status" }, { title: "Actions" }]}
              >
                {offers.map((o, index) => (
                  <IndexTable.Row id={o.id} key={o.id} position={index}>
                    <IndexTable.Cell><Text as="span" fontWeight="bold">{o.title}</Text></IndexTable.Cell>
                    <IndexTable.Cell>{o.productTitles.length ? o.productTitles.join(", ") : "All products"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      {o.tiers.filter((t) => t.percent > 0).map((t) => `${t.qty}+ → ${t.percent}%`).join(" · ")}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={o.enabled ? "success" : undefined}>{o.enabled ? "Active" : "Off"}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="300">
                        <Button variant="plain" onClick={() => submit({ intent: "toggle", id: o.id, enabled: String(!o.enabled) })}>
                          {o.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button variant="plain" tone="critical" onClick={() => submit({ intent: "delete", id: o.id })}>
                          Delete
                        </Button>
                      </InlineStack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
