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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const upsells = await listUpsells(session.shop);
  const plan = await getActivePlan(admin);
  return { upsells, limit: upsellLimit(plan) };
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
    await createUpsell(session.shop, {
      title: String(form.get("title") || "Special offer"),
      type: String(form.get("type") || "bump"),
      offerProductTitle: String(form.get("offerProductTitle") || ""),
      offerProductId: String(form.get("offerProductId") || ""),
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

export default function UpsellsPage() {
  const { upsells, limit } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const atLimit = limit >= 0 && upsells.length >= limit;
  const createError =
    fetcher.data && "error" in fetcher.data ? (fetcher.data.error as string) : null;

  const [title, setTitle] = useState("Special offer");
  const [type, setType] = useState("bump");
  const [product, setProduct] = useState("");
  const [discount, setDiscount] = useState("10");
  const [minQty, setMinQty] = useState("1");

  const saving =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data && "created" in fetcher.data && fetcher.data.created) {
      shopify.toast.show("Upsell created");
      setTitle("Special offer");
      setProduct("");
      setDiscount("10");
    }
  }, [fetcher.data, shopify]);

  const create = () => {
    const fd = new FormData();
    fd.append("intent", "create");
    fd.append("title", title);
    fd.append("type", type);
    fd.append("offerProductTitle", product);
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
                <TextField label="Offered product" autoComplete="off" value={product} onChange={setProduct} placeholder="e.g. Extra pack" />
                <TextField label="Discount %" type="number" autoComplete="off" value={discount} onChange={setDiscount} />
                {type === "quantity" && (
                  <TextField label="Min quantity to trigger" type="number" autoComplete="off" value={minQty} onChange={setMinQty} />
                )}
              </InlineGrid>
              <div>
                <Button variant="primary" loading={saving} disabled={atLimit} onClick={create}>Add offer</Button>
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
                  { title: "Product" },
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
                    <IndexTable.Cell>{u.offerProductTitle || "—"}</IndexTable.Cell>
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
