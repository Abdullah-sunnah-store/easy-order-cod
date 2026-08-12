import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  Text,
  Badge,
  Banner,
  Button,
  Icon,
  InlineStack,
  List,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getCodSettings } from "../models/codSettings.server";
import { getConnections } from "../models/connections.server";
import { listUpsells } from "../models/upsells.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getCodSettings(session.shop);
  const connections = await getConnections(session.shop);
  const upsells = await listUpsells(session.shop);
  const tag = settings.orderTag || "COD";

  let revenue = 0;
  let currency = "USD";
  let pending = 0;
  let count = 0;
  let ordersBlocked = false;
  try {
    const response = await admin.graphql(
      `#graphql
      query CodStats($query: String!) {
        orders(first: 100, query: $query) {
          edges {
            node {
              displayFinancialStatus
              totalPriceSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }`,
      { variables: { query: `tag:${tag}` } },
    );
    const json = await response.json();
    if ((json as any).errors) throw new Error("orders query failed");
    const orders = (json.data?.orders?.edges ?? []).map((e: any) => e.node);
    count = orders.length;
    for (const o of orders) {
      const m = o.totalPriceSet?.shopMoney;
      if (m) {
        revenue += parseFloat(m.amount);
        currency = m.currencyCode;
      }
      if (o.displayFinancialStatus === "PENDING") pending += 1;
    }
  } catch {
    // App not yet approved for protected customer data → show a notice.
    ordersBlocked = true;
  }

  const hasPixels = Boolean(
    connections.fbPixelId ||
      connections.tiktokPixelId ||
      connections.googleTagId,
  );

  return {
    stats: { count, revenue, currency, pending },
    ordersBlocked,
    checklist: {
      formEnabled: settings.enabled,
      hasPixels,
      hasUpsells: upsells.length > 0,
      fraudOn: settings.otpEnabled || settings.ipBlockingEnabled,
    },
  };
};

function ChecklistItem({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%" }}>
      <Text as="span" variant="bodyMd" tone={done ? "subdued" : undefined}>
        {children}
      </Text>
      <span style={{ flexShrink: 0 }}>
        <Icon source={done ? CheckCircleIcon : AlertCircleIcon} tone={done ? "success" : "caution"} />
      </span>
    </div>
  );
}

export default function Dashboard() {
  const { stats, checklist, ordersBlocked } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Easy order COD" />
      <BlockStack gap="500">
        {ordersBlocked && (
          <Banner tone="warning" title="Approve protected customer data access">
            <p>
              To read COD orders, approve <b>Protected customer data access</b> in
              your Partner Dashboard: your app → <b>API access</b> →
              <b> Protected customer data access</b> → request access. Order stats
              stay at zero until then.
            </p>
          </Banner>
        )}
        <Layout>
          <Layout.Section>
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
              <Card>
                <BlockStack gap="100">
                  <Text as="span" variant="bodyMd" tone="subdued">COD orders</Text>
                  <Text as="p" variant="heading2xl">{stats.count}</Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text as="span" variant="bodyMd" tone="subdued">COD revenue</Text>
                  <Text as="p" variant="heading2xl">
                    {stats.revenue.toFixed(2)} {stats.currency}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" variant="bodyMd" tone="subdued">Pending</Text>
                    {stats.pending > 0 && <Badge tone="attention">Action</Badge>}
                  </InlineStack>
                  <Text as="p" variant="heading2xl">{stats.pending}</Text>
                </BlockStack>
              </Card>
            </InlineGrid>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Setup checklist</Text>
                <BlockStack gap="300">
                  <ChecklistItem done={checklist.formEnabled}>
                    COD order form enabled
                  </ChecklistItem>
                  <ChecklistItem done={checklist.hasPixels}>
                    Marketing pixel connected (Facebook / TikTok / Google)
                  </ChecklistItem>
                  <ChecklistItem done={checklist.fraudOn}>
                    Fraud protection turned on (OTP or IP blocking)
                  </ChecklistItem>
                  <ChecklistItem done={checklist.hasUpsells}>
                    At least one upsell offer created
                  </ChecklistItem>
                </BlockStack>
                <InlineStack gap="300">
                  <Button url="/app/settings" variant="primary">Form settings</Button>
                  <Button url="/app/connections">Connections</Button>
                  <Button url="/app/upsells">Upsells</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Add the form to your store</Text>
                <List type="number">
                  <List.Item>Open your theme editor.</List.Item>
                  <List.Item>On a product template, choose <b>Add block → Apps → COD Order Form</b>.</List.Item>
                  <List.Item>Save. Customers can now order with Cash on Delivery.</List.Item>
                </List>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
