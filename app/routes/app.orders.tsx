import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  Banner,
  EmptyState,
  Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getCodSettings } from "../models/codSettings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getCodSettings(session.shop);
  const tag = settings.orderTag || "COD";

  try {
    const response = await admin.graphql(
      `#graphql
      query CodOrders($query: String!) {
        orders(first: 50, sortKey: CREATED_AT, reverse: true, query: $query) {
          edges {
            node {
              id
              name
              createdAt
              displayFinancialStatus
              displayFulfillmentStatus
              totalPriceSet { shopMoney { amount currencyCode } }
              email
              phone
              shippingAddress { name phone address1 city }
              lineItems(first: 5) { edges { node { title quantity } } }
            }
          }
        }
      }`,
      { variables: { query: `tag:${tag}` } },
    );
    const json = await response.json();
    const gqlErrors = (json as any).errors;
    if (gqlErrors) {
      // Only an access denial means "approve protected customer data" — every
      // other failure used to be mislabelled as that and the real cause lost.
      const message = (Array.isArray(gqlErrors) ? gqlErrors : [gqlErrors])
        .map((e: any) => e?.message ?? String(e))
        .join(" ");
      console.error("COD orders query failed:", message);
      const denied = /access denied|not approved|protected customer/i.test(message);
      return {
        orders: [],
        tag,
        ordersBlocked: denied,
        error: denied ? null : message,
      };
    }
    const orders = (json.data?.orders?.edges ?? []).map((e: any) => e.node);
    return { orders, tag, ordersBlocked: false, error: null };
  } catch (e: any) {
    const message = e?.message || "Could not load orders.";
    console.error("COD orders query threw:", message);
    return { orders: [], tag, ordersBlocked: false, error: message };
  }
};

function financialTone(status: string) {
  if (status === "PAID") return "success" as const;
  if (status === "PENDING") return "attention" as const;
  if (status === "REFUNDED" || status === "VOIDED") return "critical" as const;
  return undefined;
}

export default function OrdersPage() {
  const { orders, tag, ordersBlocked, error } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="COD orders" />
      <Layout>
        {ordersBlocked && (
          <Layout.Section>
            <Banner tone="warning" title="Approve protected customer data access">
              <p>
                Orders can't be read until you approve <b>Protected customer data
                access</b> in your Partner Dashboard: your app → <b>API access</b> →
                <b> Protected customer data access</b>.
              </p>
            </Banner>
          </Layout.Section>
        )}
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Couldn't load orders">
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card padding="0">
            {orders.length === 0 ? (
              <EmptyState
                heading="No COD orders yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Orders placed through the storefront COD form (tagged{" "}
                  <b>{tag}</b>) will appear here.
                </p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "order", plural: "orders" }}
                itemCount={orders.length}
                selectable={false}
                headings={[
                  { title: "Order" },
                  { title: "Date" },
                  { title: "Customer" },
                  { title: "Phone" },
                  { title: "City" },
                  { title: "Items" },
                  { title: "Total" },
                  { title: "Payment" },
                ]}
              >
                {orders.map((o: any, index: number) => {
                  const id = o.id.replace("gid://shopify/Order/", "");
                  const items = (o.lineItems?.edges ?? [])
                    .map((e: any) => `${e.node.quantity}× ${e.node.title}`)
                    .join(", ");
                  const money = o.totalPriceSet?.shopMoney;
                  return (
                    <IndexTable.Row id={o.id} key={o.id} position={index}>
                      <IndexTable.Cell>
                        <Link url={`shopify:admin/orders/${id}`} target="_blank">
                          <Text as="span" fontWeight="bold">
                            {o.name}
                          </Text>
                        </Link>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {new Date(o.createdAt).toLocaleDateString()}
                      </IndexTable.Cell>
                      {/* Fall back to the order's own contact fields: Shopify
                          keeps those even when it discards the address. */}
                      <IndexTable.Cell>
                        {o.shippingAddress?.name || o.email || "—"}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {o.shippingAddress?.phone || o.phone || "—"}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {o.shippingAddress?.city || "—"}
                      </IndexTable.Cell>
                      <IndexTable.Cell>{items || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>
                        {money
                          ? `${money.amount} ${money.currencyCode}`
                          : "—"}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={financialTone(o.displayFinancialStatus)}>
                          {o.displayFinancialStatus ?? "—"}
                        </Badge>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
