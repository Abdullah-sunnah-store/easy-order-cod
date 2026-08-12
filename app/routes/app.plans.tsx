import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  Text,
  Button,
  Badge,
  Banner,
  List,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { PLANS, FREE_PLAN, PLAN_LIMITS, formatLimit } from "../lib/plans";
import { BILLING_TEST, getActivePlan } from "../models/billing.server";
import { getMonthlyOrderCount } from "../models/usage.server";

const PLAN_INFO = [
  {
    name: FREE_PLAN,
    price: "$0",
    tagline: "Get started",
    limit: `${formatLimit(PLAN_LIMITS.Free.orders)} orders / month`,
    features: ["COD order form", "Orders dashboard", "1 upsell offer", "Community support"],
  },
  {
    name: PLANS.BASIC,
    price: "$9.95",
    tagline: "For growing stores",
    limit: `${formatLimit(PLAN_LIMITS.Basic.orders)} orders / month`,
    features: ["Everything in Free", "Marketing pixels", "Google Sheets export", "OTP fraud protection", "Unlimited upsells"],
  },
  {
    name: PLANS.ADVANCED,
    price: "$24.95",
    tagline: "For scaling stores",
    limit: `${formatLimit(PLAN_LIMITS.Advanced.orders)} orders / month`,
    features: ["Everything in Basic", "SMS & WhatsApp", "IP & postal blocking", "Priority support", "Advanced analytics"],
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const active = await getActivePlan(admin);
  const used = await getMonthlyOrderCount(session.shop);
  return { active, used, limit: PLAN_LIMITS[active].orders, isTest: BILLING_TEST };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const form = await request.formData();
  const plan = String(form.get("plan"));

  if (plan === FREE_PLAN) {
    const { appSubscriptions } = await billing.check({
      plans: [PLANS.BASIC, PLANS.ADVANCED] as never[],
      isTest: BILLING_TEST,
    });
    for (const sub of appSubscriptions ?? []) {
      await billing.cancel({ subscriptionId: sub.id, isTest: BILLING_TEST, prorate: true });
    }
    return redirect("/app/plans");
  }

  // Paid plan → redirect the merchant to Shopify's approval screen.
  await billing.request({
    plan: plan as never,
    isTest: BILLING_TEST,
  });
  return null;
};

export default function PlansPage() {
  const { active, used, limit, isTest } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const nearLimit = limit >= 0 && used >= limit * 0.8;

  const choose = (plan: string) =>
    fetcher.submit({ plan }, { method: "POST" });

  return (
    <Page>
      <TitleBar title="Plans" />
      <Layout>
        <Layout.Section>
          <Banner tone={nearLimit ? "warning" : "info"}>
            <Text as="p" variant="bodyMd">
              {limit < 0
                ? `${used.toLocaleString("en-US")} COD orders this month — unlimited on your plan.`
                : `${used.toLocaleString("en-US")} of ${formatLimit(limit)} COD orders used this month.`}
              {nearLimit && " Upgrade to keep accepting orders once the limit is reached."}
            </Text>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            {PLAN_INFO.map((p) => {
              const isCurrent = active === p.name;
              return (
                <Card key={p.name}>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <InlineGridHeader name={p.name} isCurrent={isCurrent} />
                      <Text as="span" tone="subdued" variant="bodyMd">{p.tagline}</Text>
                    </BlockStack>
                    <Box>
                      <Text as="span" variant="heading2xl">{p.price}</Text>
                      <Text as="span" tone="subdued" variant="bodyMd">{p.name === FREE_PLAN ? "" : " / month"}</Text>
                    </Box>
                    <Badge tone="info">{p.limit}</Badge>
                    <List>
                      {p.features.map((f) => (
                        <List.Item key={f}>{f}</List.Item>
                      ))}
                    </List>
                    <Button
                      variant={isCurrent ? "secondary" : "primary"}
                      disabled={isCurrent || busy}
                      loading={busy}
                      onClick={() => choose(p.name)}
                    >
                      {isCurrent ? "Current plan" : p.name === FREE_PLAN ? "Downgrade" : "Choose plan"}
                    </Button>
                  </BlockStack>
                </Card>
              );
            })}
          </InlineGrid>
        </Layout.Section>
        <Layout.Section>
          <Text as="p" tone="subdued" variant="bodyMd">
            {isTest
              ? "Charges are billed through Shopify. Test mode is on while your app is in development — you won't be charged for real."
              : "Charges are billed through Shopify and appear on your regular Shopify invoice."}
          </Text>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function InlineGridHeader({ name, isCurrent }: { name: string; isCurrent: boolean }) {
  return (
    <BlockStack gap="100">
      <Text as="h2" variant="headingLg">{name}</Text>
      {isCurrent && <Badge tone="success">Active</Badge>}
    </BlockStack>
  );
}
