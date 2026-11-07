import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  Text,
  DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getActivePlan } from "../models/billing.server";
import { getMonthlyHistory } from "../models/usage.server";
import { can, FEATURE_MIN_PLAN } from "../lib/plans";
import { UpgradeNotice } from "../components/UpgradeNotice";

// COD analytics (Advanced plan): orders, revenue, average order value and
// review-flagged orders per month. Built from the counters the orders/create
// webhook keeps, so it holds no customer data and needs no extra API calls.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getActivePlan(admin);
  const allowed = can(plan, "analytics");

  let currency = "";
  if (allowed) {
    try {
      const response = await admin.graphql(`#graphql
        query CodShopCurrency { shop { currencyCode } }`);
      const body: any = await response.json();
      currency = body?.data?.shop?.currencyCode ?? "";
    } catch {
      /* show amounts without a code */
    }
  }

  return {
    allowed,
    currency,
    months: allowed ? await getMonthlyHistory(session.shop, 6) : [],
  };
};

function monthLabel(period: string) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function AnalyticsPage() {
  const { allowed, currency, months } = useLoaderData<typeof loader>();
  const money = (n: number) =>
    `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;

  const totals = months.reduce(
    (t, m) => ({ orders: t.orders + m.orders, revenue: t.revenue + m.revenue, flagged: t.flagged + m.flagged }),
    { orders: 0, revenue: 0, flagged: 0 },
  );
  const current = months[months.length - 1];

  return (
    <Page>
      <TitleBar title="Analytics" />
      <Layout>
        {!allowed ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">COD analytics</Text>
                <Text as="p" tone="subdued">
                  Monthly COD orders, revenue, average order value and orders flagged for review.
                </Text>
                <UpgradeNotice required={FEATURE_MIN_PLAN.analytics} />
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : (
          <>
            <Layout.Section>
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                <Card>
                  <BlockStack gap="100">
                    <Text as="span" tone="subdued">COD orders this month</Text>
                    <Text as="p" variant="heading2xl">{current?.orders ?? 0}</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <Text as="span" tone="subdued">COD revenue this month</Text>
                    <Text as="p" variant="heading2xl">{money(current?.revenue ?? 0)}</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <Text as="span" tone="subdued">Flagged for review this month</Text>
                    <Text as="p" variant="heading2xl">{current?.flagged ?? 0}</Text>
                  </BlockStack>
                </Card>
              </InlineGrid>
            </Layout.Section>
            <Layout.Section>
              <Card padding="0">
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                  headings={["Month", "COD orders", "Revenue", "Avg. order value", "Flagged"]}
                  rows={months
                    .slice()
                    .reverse()
                    .map((m) => [
                      monthLabel(m.period),
                      m.orders,
                      money(m.revenue),
                      m.orders ? money(m.revenue / m.orders) : "—",
                      m.flagged,
                    ])}
                  totals={["", totals.orders, money(totals.revenue), totals.orders ? money(totals.revenue / totals.orders) : "—", totals.flagged]}
                  showTotalsInFooter
                />
              </Card>
            </Layout.Section>
            <Layout.Section>
              <Text as="p" variant="bodySm" tone="subdued">
                Counted when Shopify reports each order from the COD button (UTC months).
                Revenue tracking started with this version, so earlier months show orders only.
              </Text>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
