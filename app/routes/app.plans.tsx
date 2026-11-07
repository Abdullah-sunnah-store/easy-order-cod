import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  InlineStack,
  Text,
  Button,
  ButtonGroup,
  Badge,
  Banner,
  List,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  BILLING_PLANS,
  FREE_PLAN,
  PLAN_FEATURES,
  PLAN_LIMITS,
  PLAN_ORDER,
  billingPlan,
  formatLimit,
  type BillingCycle,
  type PlanName,
} from "../lib/plans";
import { BILLING_TEST, forgetCachedPlan, getActiveSubscription } from "../models/billing.server";
import { getMonthlyOrderCount } from "../models/usage.server";

const TAGLINES: Record<PlanName, string> = {
  Free: "Get started",
  Basic: "For growing stores",
  Advanced: "For scaling stores",
  Unlimited: "No limits",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Landing here is also where Shopify returns after a plan change, so make
  // the storefront re-read the plan instead of serving a cached one.
  forgetCachedPlan(session.shop);
  const { plan, cycle, key } = await getActiveSubscription(admin);
  const used = await getMonthlyOrderCount(session.shop);
  return { active: plan, cycle, activeKey: key, used, limit: PLAN_LIMITS[plan].orders, isTest: BILLING_TEST };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  forgetCachedPlan(session.shop);
  const form = await request.formData();
  const key = String(form.get("plan"));

  if (key === FREE_PLAN) {
    const { appSubscriptions } = await billing.check({
      plans: BILLING_PLANS.map((p) => p.key) as never[],
      isTest: BILLING_TEST,
    });
    for (const sub of appSubscriptions ?? []) {
      await billing.cancel({ subscriptionId: sub.id, isTest: BILLING_TEST, prorate: true });
    }
    return redirect("/app/plans");
  }

  if (!billingPlan(key)) return { error: "Unknown plan." };
  // Shopify's approval screen replaces the current subscription on approval.
  await billing.request({ plan: key as never, isTest: BILLING_TEST });
  return null;
};

export default function PlansPage() {
  const { active, cycle, activeKey, used, limit, isTest } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const [view, setView] = useState<BillingCycle>(cycle ?? "monthly");
  const nearLimit = limit >= 0 && used >= limit * 0.8;

  const choose = (plan: string) => fetcher.submit({ plan }, { method: "POST" });

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
              {nearLimit && " When the limit is reached the COD button is hidden on your store until next month — upgrade to keep it showing."}
            </Text>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <InlineStack align="center">
            <ButtonGroup variant="segmented">
              <Button pressed={view === "monthly"} onClick={() => setView("monthly")}>Monthly</Button>
              <Button pressed={view === "yearly"} onClick={() => setView("yearly")}>Yearly — save 25%</Button>
            </ButtonGroup>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
            {PLAN_ORDER.map((tier) => {
              const offer = BILLING_PLANS.find((p) => p.tier === tier && p.cycle === view);
              const key = tier === FREE_PLAN ? FREE_PLAN : offer!.key;
              const isCurrent = tier === FREE_PLAN ? active === FREE_PLAN : activeKey === key;
              const monthlyEquivalent =
                offer && view === "yearly" ? `$${(offer.amount / 12).toFixed(2)}/mo billed yearly` : "";
              return (
                <Card key={tier}>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h2" variant="headingLg">{tier}</Text>
                        {isCurrent && <Badge tone="success">Active</Badge>}
                      </InlineStack>
                      <Text as="span" tone="subdued" variant="bodyMd">{TAGLINES[tier]}</Text>
                    </BlockStack>
                    <Box>
                      <Text as="span" variant="heading2xl">{offer ? offer.price : "$0"}</Text>
                      <Text as="span" tone="subdued" variant="bodyMd">
                        {offer ? (view === "yearly" ? " / year" : " / month") : ""}
                      </Text>
                      {monthlyEquivalent && (
                        <Text as="p" tone="subdued" variant="bodySm">{monthlyEquivalent}</Text>
                      )}
                    </Box>
                    <Badge tone="info">{`${formatLimit(PLAN_LIMITS[tier].orders)} orders / month`}</Badge>
                    <List>
                      {PLAN_FEATURES[tier].map((f) => (
                        <List.Item key={f}>{f}</List.Item>
                      ))}
                    </List>
                    <Button
                      variant={isCurrent ? "secondary" : "primary"}
                      disabled={isCurrent || busy}
                      loading={busy}
                      onClick={() => choose(key)}
                    >
                      {isCurrent ? "Current plan" : tier === FREE_PLAN ? "Downgrade" : "Choose plan"}
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
              : "Charges are billed through Shopify and appear on your regular Shopify invoice. Switching plans replaces your current subscription."}
          </Text>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
