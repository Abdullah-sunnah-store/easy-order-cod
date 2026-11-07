import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Banner,
  InlineGrid,
  TextField,
  Select,
  Text,
  Button,
  IndexTable,
  Badge,
  EmptyState,
  Box,
  InlineStack,
  Thumbnail,
  Tag,
  Checkbox,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  listUpsells,
  createUpsell,
  deleteUpsell,
  toggleUpsell,
} from "../models/upsells.server";
import { getActivePlan } from "../models/billing.server";
import { can, upsellLimit, FEATURE_MIN_PLAN } from "../lib/plans";
import { UPSELL_TYPES } from "../lib/offers";
import { DiscountError, parseIds } from "../models/discounts.server";
import { UpgradeNotice } from "../components/UpgradeNotice";
import { getCodSettings, updateCodSettings } from "../models/codSettings.server";
import { formatMoney, getMoneyFormat } from "../lib/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const upsells = (await listUpsells(session.shop)).map((u) => ({
    ...u,
    triggerTitles: parseIds(u.triggerTitles),
  }));
  const plan = await getActivePlan(admin);
  const moneyFormat = await getMoneyFormat(admin);
  const settings = await getCodSettings(session.shop);
  return {
    upsells,
    limit: upsellLimit(plan),
    moneyFormat,
    canDiscount: can(plan, "offerDiscounts"),
    canRecommend: can(plan, "recommendations"),
    recommend: { enabled: settings.recommendEnabled, limit: settings.recommendLimit },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "recommend") {
    if (!can(await getActivePlan(admin), "recommendations")) {
      return { ok: false, error: `Smart recommendations are on the ${FEATURE_MIN_PLAN.recommendations} plan.` };
    }
    await updateCodSettings(session.shop, {
      recommendEnabled: form.get("enabled") === "true",
      recommendLimit: Math.min(4, Math.max(1, parseInt(String(form.get("limit") || "2"), 10) || 2)),
    });
    return { ok: true, saved: true };
  }
  if (intent === "create") {
    // Free is capped at one offer; paid plans are unlimited.
    const plan = await getActivePlan(admin);
    const limit = upsellLimit(plan);
    if (limit >= 0) {
      const existing = await listUpsells(session.shop);
      if (existing.length >= limit) {
        return {
          ok: false,
          error: `Your plan includes ${limit} upsell offer${limit === 1 ? "" : "s"}. Upgrade to add more.`,
        };
      }
    }
    // The picker is the only way to fill this in, so an empty id means the
    // merchant pressed Add before choosing anything.
    const offerProductId = String(form.get("offerProductId") || "");
    if (!offerProductId) {
      return { ok: false, error: "Pick the product or collection to offer." };
    }
    let triggerProductIds: string[] = [];
    let triggerTitles: string[] = [];
    try {
      triggerProductIds = JSON.parse(String(form.get("triggerProductIds") || "[]"))
        .filter((id: unknown) => typeof id === "string" && id.startsWith("gid://shopify/Product/"));
      triggerTitles = JSON.parse(String(form.get("triggerTitles") || "[]")).map(String);
    } catch {
      /* treated as "every product" */
    }
    // Discounts are a paid feature; on Free the offer is saved at full price.
    const requested = parseInt(String(form.get("discountPercent") || "0"), 10) || 0;
    const discountPercent = can(plan, "offerDiscounts") ? Math.min(100, Math.max(0, requested)) : 0;
    if (discountPercent > 0 && triggerProductIds.length === 0) {
      return {
        ok: false,
        error: "A discounted offer needs the products it goes with — choose them under \"Show with\".",
      };
    }
    try {
      await createUpsell(admin, session.shop, {
      title: String(form.get("title") || "Special offer"),
      type: String(form.get("type") || "bump"),
      offerKind: String(form.get("offerKind") || "product"),
      offerProductTitle: String(form.get("offerProductTitle") || ""),
      offerProductId,
      offerVariantId: String(form.get("offerVariantId") || ""),
      offerHandle: String(form.get("offerHandle") || ""),
      offerImage: String(form.get("offerImage") || ""),
      offerPrice: String(form.get("offerPrice") || ""),
      offerProductCount:
        parseInt(String(form.get("offerProductCount") || "0"), 10) || 0,
      discountPercent,
      minQuantity: parseInt(String(form.get("minQuantity") || "1"), 10) || 1,
      triggerProductIds,
      triggerTitles,
    });
    } catch (error) {
      console.error("COD upsells:", error);
      return {
        ok: false,
        error:
          error instanceof DiscountError
            ? `Shopify refused the discount: ${error.message}`
            : "The offer could not be saved. Try again.",
      };
    }
    return { ok: true, created: true };
  }
  if (intent === "delete") {
    await deleteUpsell(admin, session.shop, String(form.get("id")));
    return { ok: true };
  }
  if (intent === "toggle") {
    await toggleUpsell(admin, session.shop, String(form.get("id")), form.get("enabled") === "true");
    return { ok: true };
  }
  return { ok: false };
};

const TYPE_LABELS: Record<string, string> = Object.fromEntries([
  ...UPSELL_TYPES.map((t) => [t.value, t.label]),
  ["quantity", "Quantity offer"],
]);

/** What the resource picker handed back, flattened to what we store. */
type Offered = {
  kind: "product" | "collection";
  id: string;
  title: string;
  handle: string;
  image: string;
  /** Products only — the amount of the chosen variant. */
  price: string;
  /** Products only — the specific variant, when one was picked. */
  variantId: string;
  /** Collections only. */
  productCount: number;
};

export default function UpsellsPage() {
  const { upsells, limit, moneyFormat, canDiscount, canRecommend, recommend } = useLoaderData<typeof loader>();
  const [recOn, setRecOn] = useState(recommend.enabled);
  const [recLimit, setRecLimit] = useState(String(recommend.limit));
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const atLimit = limit >= 0 && upsells.length >= limit;
  const createError =
    fetcher.data && "error" in fetcher.data ? (fetcher.data.error as string) : null;

  const [title, setTitle] = useState("Special offer");
  const [type, setType] = useState("bump");
  const [offered, setOffered] = useState<Offered | null>(null);
  const [discount, setDiscount] = useState("0");
  const [triggers, setTriggers] = useState<{ id: string; title: string }[]>([]);

  // Picking a type fills in the sensible default discount for it.
  const chooseType = (value: string) => {
    setType(value);
    if (value === "free_gift") setDiscount("100");
    else if (value === "bundle" && discount === "0") setDiscount("10");
  };

  const pickTriggers = async () => {
    const selection: any = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: true,
      filter: { variants: false },
      selectionIds: triggers.map((t) => ({ id: t.id })),
    });
    if (selection) setTriggers(selection.map((p: any) => ({ id: p.id, title: p.title })));
  };

  // Opens Shopify's own picker, so merchants search their real catalogue
  // instead of retyping a title that nothing validates.
  const pick = async (which: "product" | "collection") => {
    const selection = await shopify.resourcePicker({
      type: which,
      action: "select",
      multiple: false,
      // Reopening the picker keeps the current choice highlighted.
      selectionIds:
        offered && offered.kind === which ? [{ id: offered.id }] : undefined,
    });
    // Undefined means the merchant closed the picker without choosing.
    const chosen: any = selection?.[0];
    if (!chosen) return;

    if (which === "collection") {
      setOffered({
        kind: "collection",
        id: chosen.id,
        title: chosen.title || "",
        handle: chosen.handle || "",
        image: chosen.image?.originalSrc || "",
        price: "",
        variantId: "",
        productCount: Number(chosen.productsCount) || 0,
      });
      return;
    }
    // A product selection carries the variants the merchant ticked; with
    // multiple:false that's either the whole product or one variant of it.
    const variant = chosen.variants?.length === 1 ? chosen.variants[0] : null;
    setOffered({
      kind: "product",
      id: chosen.id,
      title: chosen.title || "",
      handle: chosen.handle || "",
      image: variant?.image?.originalSrc || chosen.images?.[0]?.originalSrc || "",
      price: String(variant?.price ?? ""),
      // Only pin a variant when the product actually has more than one; the
      // default variant of a simple product would just be noise.
      variantId:
        variant && !chosen.hasOnlyDefaultVariant ? String(variant.id) : "",
      productCount: 0,
    });
  };

  const saving =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data && "saved" in fetcher.data && fetcher.data.saved) shopify.toast.show("Recommendations saved");
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (fetcher.data && "created" in fetcher.data && fetcher.data.created) {
      shopify.toast.show("Upsell created");
      setTitle("Special offer");
      setOffered(null);
      setDiscount("0");
      setTriggers([]);
    }
  }, [fetcher.data, shopify]);

  const create = () => {
    if (!offered) return;
    const fd = new FormData();
    fd.append("intent", "create");
    fd.append("title", title);
    fd.append("type", type);
    fd.append("offerKind", offered.kind);
    fd.append("offerProductId", offered.id);
    fd.append("offerProductTitle", offered.title);
    fd.append("offerVariantId", offered.variantId);
    fd.append("offerHandle", offered.handle);
    fd.append("offerImage", offered.image);
    fd.append("offerPrice", offered.price);
    fd.append("offerProductCount", String(offered.productCount));
    // Priced by a Shopify buy-X-get-Y discount created on save, never by the app.
    fd.append("discountPercent", canDiscount ? discount : "0");
    fd.append("triggerProductIds", JSON.stringify(triggers.map((t) => t.id)));
    fd.append("triggerTitles", JSON.stringify(triggers.map((t) => t.title)));
    fd.append("minQuantity", "1");
    fetcher.submit(fd, { method: "POST" });
  };

  const rowAction = (intent: string, id: string, enabled?: boolean) => {
    const fd = new FormData();
    fd.append("intent", intent);
    fd.append("id", id);
    if (enabled !== undefined) fd.append("enabled", String(enabled));
    fetcher.submit(fd, { method: "POST" });
  };

  return (
    <Page>
      <TitleBar title="Upsells" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Create an offer</Text>
              {createError && <Banner tone="warning">{createError}</Banner>}
              {atLimit && !createError && (
                <Banner tone="info">
                  <Text as="p" variant="bodyMd">
                    Your plan includes {limit} upsell offer{limit === 1 ? "" : "s"}.{" "}
                    <Link to="/app/plans">Upgrade</Link> for unlimited offers.
                  </Text>
                </Banner>
              )}
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                <TextField label="Offer title" autoComplete="off" value={title} onChange={setTitle} />
                <Select
                  label="Type"
                  options={UPSELL_TYPES.map((t) => ({ label: t.label, value: t.value }))}
                  value={type}
                  onChange={chooseType}
                  helpText={UPSELL_TYPES.find((t) => t.value === type)?.hint}
                />
              </InlineGrid>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Show with</Text>
                <InlineStack gap="200" blockAlign="center">
                  {triggers.length === 0 ? (
                    <Text as="span" tone="subdued">Every product</Text>
                  ) : (
                    triggers.map((t) => (
                      <Tag key={t.id} onRemove={() => setTriggers((prev) => prev.filter((x) => x.id !== t.id))}>
                        {t.title}
                      </Tag>
                    ))
                  )}
                  <Button onClick={pickTriggers}>{triggers.length ? "Change products" : "Choose products"}</Button>
                </InlineStack>
              </BlockStack>

              <BlockStack gap="200">
                {!canDiscount && <UpgradeNotice required={FEATURE_MIN_PLAN.offerDiscounts} />}
                <TextField
                  label="Discount on the offered item (%)"
                  type="number"
                  min={0}
                  max={100}
                  autoComplete="off"
                  value={canDiscount ? discount : "0"}
                  onChange={setDiscount}
                  disabled={!canDiscount}
                  helpText={
                    Number(discount) > 0
                      ? "Creates an automatic buy-X-get-Y discount in Shopify: buy one of the products above, get one offered item at this discount. Needs at least one product under \"Show with\"."
                      : "0 = the add-on is sold at its normal price."
                  }
                />
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Offered item</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Offer one product, or let the customer take any item from a
                  collection.
                </Text>
                {offered ? (
                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <InlineStack
                      gap="300"
                      blockAlign="center"
                      align="space-between"
                      wrap={false}
                    >
                      <InlineStack gap="300" blockAlign="center" wrap={false}>
                        <Thumbnail
                          size="small"
                          alt=""
                          source={
                            offered.image ||
                            "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                          }
                        />
                        <BlockStack gap="050">
                          <Text as="span" fontWeight="semibold">{offered.title}</Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {offered.kind === "collection"
                              ? `Collection · ${offered.productCount} product${offered.productCount === 1 ? "" : "s"}`
                              : [
                                  offered.price
                                    ? formatMoney(Number(offered.price) || 0, moneyFormat, "")
                                    : null,
                                  offered.variantId ? "1 variant" : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "Product"}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                      <InlineStack gap="200" wrap={false}>
                        <Button onClick={() => pick(offered.kind)}>Change</Button>
                        <Button
                          variant="plain"
                          tone="critical"
                          onClick={() => setOffered(null)}
                        >
                          Remove
                        </Button>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                ) : (
                  <InlineStack gap="300">
                    <Button onClick={() => pick("product")}>Select product</Button>
                    <Button onClick={() => pick("collection")}>Select collection</Button>
                  </InlineStack>
                )}
              </BlockStack>

              <div>
                <Button
                  variant="primary"
                  loading={saving}
                  disabled={atLimit || !offered || (Number(discount) > 0 && canDiscount && triggers.length === 0)}
                  onClick={create}
                >
                  Add offer
                </Button>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Smart recommendations</Text>
              <Text as="p" tone="subdued">
                Let Shopify pick add-ons for each product automatically — its own
                "frequently bought with" (complementary) products, or related ones when
                none are set. They appear in the form next to your offers, at normal price.
                Tune them in Shopify's Search &amp; Discovery app.
              </Text>
              {!canRecommend && <UpgradeNotice required={FEATURE_MIN_PLAN.recommendations} />}
              <Checkbox label="Show recommended products in the COD form" checked={recOn} onChange={setRecOn} disabled={!canRecommend} />
              <Select
                label="How many"
                options={["1", "2", "3", "4"].map((n) => ({ label: n, value: n }))}
                value={recLimit}
                onChange={setRecLimit}
                disabled={!canRecommend || !recOn}
              />
              <div>
                <Button
                  disabled={!canRecommend}
                  loading={saving}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "recommend");
                    fd.append("enabled", String(recOn));
                    fd.append("limit", recLimit);
                    fetcher.submit(fd, { method: "POST" });
                  }}
                >
                  Save recommendations
                </Button>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            {upsells.length === 0 ? (
              <EmptyState
                heading="No upsell offers yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Create an order bump or quantity offer above to boost average order value.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "offer", plural: "offers" }}
                itemCount={upsells.length}
                selectable={false}
                headings={[
                  { title: "Offer" },
                  { title: "Type" },
                  { title: "Offered item" },
                  { title: "Shown with" },
                  { title: "Discount" },
                  { title: "Status" },
                  { title: "Actions" },
                ]}
              >
                {upsells.map((u: any, index: number) => (
                  <IndexTable.Row id={u.id} key={u.id} position={index}>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="bold">{u.title}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{TYPE_LABELS[u.type] ?? u.type}</IndexTable.Cell>
                    <IndexTable.Cell>
                      {u.offerProductTitle ? (
                        <InlineStack gap="200" blockAlign="center" wrap={false}>
                          {u.offerImage && (
                            <Thumbnail size="extraSmall" alt="" source={u.offerImage} />
                          )}
                          <BlockStack gap="050">
                            <Text as="span">{u.offerProductTitle}</Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {u.offerKind === "collection"
                                ? `Collection · ${u.offerProductCount} product${u.offerProductCount === 1 ? "" : "s"}`
                                : u.offerPrice
                                  ? formatMoney(Number(u.offerPrice) || 0, moneyFormat, "")
                                  : "Product"}
                            </Text>
                          </BlockStack>
                        </InlineStack>
                      ) : (
                        "—"
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {u.triggerTitles.length ? u.triggerTitles.join(", ") : "Every product"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {u.discountPercent >= 100 ? "Free" : u.discountPercent > 0 ? `${u.discountPercent}%` : "—"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={u.enabled ? "success" : undefined}>
                        {u.enabled ? "Active" : "Off"}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Button variant="plain" onClick={() => rowAction("toggle", u.id, !u.enabled)}>
                        {u.enabled ? "Disable" : "Enable"}
                      </Button>
                      {"  "}
                      <Button variant="plain" tone="critical" onClick={() => rowAction("delete", u.id)}>
                        Delete
                      </Button>
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
