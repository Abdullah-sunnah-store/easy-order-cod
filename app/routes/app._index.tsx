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
import { listQuantityOffers } from "../models/quantityOffers.server";
import { getActivePlan } from "../models/billing.server";
import { getMonthlyOrderCount } from "../models/usage.server";
import { can, orderLimit, formatLimit } from "../lib/plans";
import { getCodRules } from "../models/paymentCustomization.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getCodSettings(session.shop);
  const connections = await getConnections(session.shop);
  const upsells = await listUpsells(session.shop);
  const quantityOffers = await listQuantityOffers(session.shop);
  const plan = await getActivePlan(admin);
  const limit = orderLimit(plan);
  const used = await getMonthlyOrderCount(session.shop);
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
      connections.googleTagId ||
      connections.snapPixelId ||
      connections.pinterestTagId,
  );

  // COD at checkout (payment customization) and one-click theme setup links.
  const cod = await getCodRules(admin).catch(() => ({ active: false }));
  const apiKey = process.env.SHOPIFY_API_KEY?.trim() || "";
  const editor = `https://${session.shop}/admin/themes/current/editor`;

  return {
    setupLinks: {
      // Opens the theme editor on a product page with the COD block added.
      addBlock: `${editor}?template=product&addAppBlockId=${apiKey}/cod_form&target=mainSection`,
      // Opens App embeds with Easy order COD switched on (pixels + cart button).
      activateEmbed: `${editor}?context=apps&activateAppId=${apiKey}/cod_embed`,
    },
    stats: { count, revenue, currency, pending },
    ordersBlocked,
    usage: { used, limit, overLimit: limit >= 0 && used >= limit },
    checklist: {
      codCheckout: cod.active,
      formEnabled: settings.enabled,
      hasPixels,
      hasUpsells: upsells.length > 0,
      hasQuantityOffers: quantityOffers.length > 0,
      fraudOn:
        settings.maxOrdersPerPhone > 0 ||
        (can(plan, "postalBlocking") && settings.blockedPostalCodes.trim() !== ""),
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
  const { stats, checklist, ordersBlocked, usage, setupLinks } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Easy order COD" />
      <BlockStack gap="500">
        {usage.overLimit && (
          <Banner
            tone="critical"
            title="Your COD button is hidden on your store"
            action={{ content: "Upgrade plan", url: "/app/plans" }}
          >
            <p>
              You've used all {formatLimit(usage.limit)} COD orders included in your plan
              this month, so customers no longer see the button. It comes back on the
              1st (UTC), or right away if you upgrade.
            </p>
          </Banner>
        )}
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
                  <ChecklistItem done={checklist.codCheckout}>
                    Cash on Delivery selected at checkout (needs Cash on Delivery under Settings → Payments)
                  </ChecklistItem>
                  <ChecklistItem done={checklist.formEnabled}>
                    COD order form enabled
                  </ChecklistItem>
                  <ChecklistItem done={checklist.hasPixels}>
                    Marketing pixel connected (and the app embed turned on in your theme)
                  </ChecklistItem>
                  <ChecklistItem done={checklist.fraudOn}>
                    Review rules set (repeat customers or postal codes)
                  </ChecklistItem>
                  <ChecklistItem done={checklist.hasQuantityOffers}>
                    Quantity offer created (Buy 2, save 10%…)
                  </ChecklistItem>
                  <ChecklistItem done={checklist.hasUpsells}>
                    At least one upsell offer created
                  </ChecklistItem>
                </BlockStack>
                <InlineStack gap="300">
                  <Button url="/app/settings" variant="primary">Form settings</Button>
                  <Button url="/app/connections">Connections</Button>
                  <Button url="/app/offers">Quantity offers</Button>
                  <Button url="/app/upsells">Upsells</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Add the form to your store</Text>
                <Text as="p" tone="subdued">
                  Two clicks: each button opens your theme editor with the step
                  already done — just press Save there.
                </Text>
                <BlockStack gap="200">
                  <Button url={setupLinks.addBlock} target="_blank" variant="primary">
                    1. Add the COD button to product pages
                  </Button>
                  <Button url={setupLinks.activateEmbed} target="_blank">
                    2. Turn on cart button &amp; pixels
                  </Button>
                </BlockStack>
                <List type="number">
                  <List.Item>Or by hand: on a product template choose <b>Add block → Apps → COD Order Form</b>.</List.Item>
                  <List.Item><b>App embeds → Easy order COD</b> → turn on (cart COD button and pixels).</List.Item>
                  <List.Item>Add <b>Cash on Delivery (COD)</b> in Settings → Payments → Manual payment methods.</List.Item>
                </List>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
