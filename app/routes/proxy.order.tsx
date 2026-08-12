import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCodSettings } from "../models/codSettings.server";
import { getActivePlan } from "../models/billing.server";
import { getMonthlyOrderCount, incrementMonthlyOrderCount } from "../models/usage.server";
import { orderLimit } from "../lib/plans";

// App proxy requests are GET-able too; we only accept POST for creating orders.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return json({ ok: true, message: "COD order endpoint. POST to create an order." });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Verifies the Shopify app-proxy signature and gives us an Admin API client.
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin || !session) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getCodSettings(session.shop);
  if (!settings.enabled) {
    return json({ ok: false, error: "COD ordering is disabled." }, { status: 403 });
  }

  const body = await request.formData();
  const variantId = String(body.get("variantId") || "");
  const quantity = Math.max(1, parseInt(String(body.get("quantity") || "1"), 10) || 1);
  const name = String(body.get("name") || "").trim();
  const email = String(body.get("email") || "").trim();
  const phone = String(body.get("phone") || "").trim();
  const address1 = String(body.get("address") || "").trim();
  const city = String(body.get("city") || "").trim();
  const notes = String(body.get("notes") || "").trim();
  const shippingTitle = String(body.get("shippingTitle") || "").trim();
  const shippingPrice = parseFloat(String(body.get("shippingPrice") || "0")) || 0;
  const codFee = parseFloat(String(body.get("codFee") || "0")) || 0;

  if (!variantId) {
    return json({ ok: false, error: "Missing product." }, { status: 400 });
  }
  if (settings.showPhone && !phone) {
    return json({ ok: false, error: "Phone number is required." }, { status: 400 });
  }

  // Enforce the plan's monthly order allowance. Checked before the order is
  // created so the merchant is never charged for an order we then reject.
  const plan = await getActivePlan(admin);
  const limit = orderLimit(plan);
  if (limit >= 0) {
    const used = await getMonthlyOrderCount(session.shop);
    if (used >= limit) {
      return json(
        {
          ok: false,
          error:
            "This store has reached its monthly order limit. Please contact the store owner.",
        },
        { status: 429 },
      );
    }
  }

  const [firstName, ...rest] = name.split(" ");
  const lastName = rest.join(" ");

  const gid = variantId.startsWith("gid://")
    ? variantId
    : `gid://shopify/ProductVariant/${variantId}`;

  try {
    // Shop currency is required for shipping/fee money values. The shop's own
    // country is used as the address country below.
    // NOTE: `#graphql` must be on its own line — inline it comments out the query.
    const shopResp = await admin.graphql(
      `#graphql
      query ShopCurrency { shop { currencyCode billingAddress { countryCodeV2 } } }`,
    );
    const shopJson = await shopResp.json();
    const currencyCode = shopJson.data?.shop?.currencyCode || "USD";
    // Shopify silently DISCARDS a MailingAddressInput it can't resolve to a real
    // place — no userErrors, order still created, address simply absent. An
    // address with no country is the common way to trip this, so stamp the
    // shop's own country on it. The COD form is single-country by design.
    const countryCode = shopJson.data?.shop?.billingAddress?.countryCodeV2 || "";

    const shippingAddress: Record<string, string> = {};
    if (firstName) shippingAddress.firstName = firstName;
    if (lastName) shippingAddress.lastName = lastName;
    if (address1) shippingAddress.address1 = address1;
    if (city) shippingAddress.city = city;
    if (phone) shippingAddress.phone = phone;
    if (countryCode) shippingAddress.countryCode = countryCode;
    // MoneyBagInput requires BOTH shopMoney and presentmentMoney.
    const money = (amount: string) => ({
      shopMoney: { amount, currencyCode },
      presentmentMoney: { amount, currencyCode },
    });

    const lineItems: Record<string, unknown>[] = [{ variantId: gid, quantity }];
    if (codFee > 0) {
      lineItems.push({
        title: "Cash on Delivery fee",
        quantity: 1,
        priceSet: money(codFee.toFixed(2)),
      });
    }

    const orderInput: Record<string, unknown> = {
      lineItems,
      financialStatus: "PENDING",
      tags: [settings.orderTag || "COD"],
    };
    // The note carries the customer's words and nothing else — the COD tag and
    // the "Easy order COD" channel already identify where the order came from.
    if (notes) orderInput.note = notes;
    if (email) orderInput.email = email;
    if (phone) orderInput.phone = phone;
    // Require a real destination — a "shipping address" holding only a phone
    // number is what Shopify throws away, leaving "No shipping address
    // provided" and an order marked "Shipping not required".
    if (address1 || city) {
      orderInput.shippingAddress = shippingAddress;
      orderInput.billingAddress = shippingAddress;
    }
    if (shippingPrice > 0 || shippingTitle) {
      orderInput.shippingLines = [
        { title: shippingTitle || "Shipping", priceSet: money(shippingPrice.toFixed(2)) },
      ];
    }

    const response = await admin.graphql(
      `#graphql
      mutation CreateCodOrder($order: OrderCreateOrderInput!) {
        orderCreate(order: $order) {
          userErrors { field message }
          order { id name shippingAddress { address1 } }
        }
      }`,
      { variables: { order: orderInput } },
    );

    const result = await response.json();
    const payload = result.data?.orderCreate;
    const userErrors = payload?.userErrors ?? [];

    if (userErrors.length > 0) {
      return json({
        ok: false,
        error: userErrors.map((e: any) => e.message).join(" "),
      });
    }

    // Shopify reports no error when it drops an address, so compare what came
    // back against what we sent — otherwise this fails silently again.
    if (orderInput.shippingAddress && !payload?.order?.shippingAddress?.address1) {
      console.warn(
        "COD: Shopify discarded the shipping address for",
        payload?.order?.name,
        JSON.stringify(orderInput.shippingAddress),
      );
    }

    // Count it only once the order actually exists.
    await incrementMonthlyOrderCount(session.shop);

    return json({
      ok: true,
      order: { id: payload?.order?.id, name: payload?.order?.name },
      message: settings.successMessage,
    });
  } catch (e: any) {
    // Surface the real GraphQL error instead of a silent 500.
    const gql = e?.body?.errors || e?.graphQLErrors || [];
    const msg =
      Array.isArray(gql) && gql.length
        ? gql.map((x: any) => x.message).join(" ")
        : e?.message || "Could not create the order.";
    console.error("COD orderCreate failed:", JSON.stringify(e?.body ?? e?.graphQLErrors ?? msg));
    return json({ ok: false, error: msg });
  }
};
