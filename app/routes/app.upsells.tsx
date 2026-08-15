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
import { upsellLimit } from "../lib/plans";
import { formatMoney, getMoneyFormat } from "../lib/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const upsells = await listUpsells(session.shop);
  const plan = await getActivePlan(admin);
  const moneyFormat = await getMoneyFormat(admin);
  return { upsells, limit: upsellLimit(plan), moneyFormat };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "create") {
    // Free is capped at one offer; paid plans are unlimited.
    const limit = upsellLimit(await getActivePlan(admin));
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
    await createUpsell(session.shop, {
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
      discountPercent: parseInt(String(form.get("discountPercent") || "0"), 10) || 0,
      minQuantity: parseInt(String(form.get("minQuantity") || "1"), 10) || 1,
    });
    return { ok: true, created: true };
  }
  if (intent === "delete") {
    await deleteUpsell(session.shop, String(form.get("id")));
    return { ok: true };
  }
  if (intent === "toggle") {
    await toggleUpsell(session.shop, String(form.get("id")), form.get("enabled") === "true");
    return { ok: true };
  }
  return { ok: false };
};

const TYPE_LABELS: Record<string, string> = {
  bump: "Order bump",
  quantity: "Quantity offer",
  cross_sell: "Cross-sell",
};

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
  const { upsells, limit, moneyFormat } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const atLimit = limit >= 0 && upsells.length >= limit;
  const createError =
    fetcher.data && "error" in fetcher.data ? (fetcher.data.error as string) : null;

  const [title, setTitle] = useState("Special offer");
  const [type, setType] = useState("bump");
  const [offered, setOffered] = useState<Offered | null>(null);
  const [discount, setDiscount] = useState("10");
  const [minQty, setMinQty] = useState("1");

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
    if (fetcher.data && "created" in fetcher.data && fetcher.data.created) {
      shopify.toast.show("Upsell created");
      setTitle("Special offer");
      setOffered(null);
      setDiscount("10");
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
    fd.append("discountPercent", discount);
    fd.append("minQuantity", minQty);
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
                  options={[
                    { label: "Order bump (pre-purchase)", value: "bump" },
                    { label: "Quantity offer", value: "quantity" },
                    { label: "Cross-sell", value: "cross_sell" },
                  ]}
                  value={type}
                  onChange={setType}
                />
                <TextField label="Discount %" type="number" autoComplete="off" value={discount} onChange={setDiscount} />
                {type === "quantity" && (
                  <TextField label="Min quantity to trigger" type="number" autoComplete="off" value={minQty} onChange={setMinQty} />
                )}
              </InlineGrid>

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
                  disabled={atLimit || !offered}
                  onClick={create}
                >
                  Add offer
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
                    <IndexTable.Cell>{u.discountPercent}%</IndexTable.Cell>
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
