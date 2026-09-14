import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook } from "../lib/webhook.server";
import { getCodSettings } from "../models/codSettings.server";
import { recordCodOrder } from "../models/usage.server";

// The app used to know about an order because it created one. Since App Store
// requirement 1.1.2 (Use Shopify checkout) it doesn't: Shopify creates the
// order at its own checkout, and this webhook is how we hear about it.
//
// COD carts are stamped with an "Order type" cart attribute by the storefront
// form, and Shopify carries cart attributes onto the order as note_attributes.
// That attribute is the only thing that tells a COD order apart from any other.
//
// Only the order's id, name and month are stored. No customer data: the Orders
// page re-reads live details from Shopify when the merchant opens it.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticateWebhook(request);

  const order = (payload ?? {}) as Record<string, any>;
  const attributes: Array<{ name?: string; value?: string }> = Array.isArray(
    order.note_attributes,
  )
    ? order.note_attributes
    : [];

  const settings = await getCodSettings(shop);
  const tag = (settings.orderTag || "COD").trim().toLowerCase();
  const isCod = attributes.some(
    (a) =>
      String(a?.name || "").trim().toLowerCase() === "order type" &&
      String(a?.value || "").trim().toLowerCase() === tag,
  );

  // Every order in the shop reaches this endpoint, so most deliveries are not
  // ours. Acknowledge them and move on — a non-2xx would make Shopify retry.
  if (!isCod) return new Response();

  const orderId = String(order.admin_graphql_api_id || order.id || "");
  if (!orderId) {
    console.warn(`COD: ${topic} for ${shop} had no order id`);
    return new Response();
  }

  // Shopify retries a delivery it thinks failed, so this has to be idempotent —
  // recordCodOrder keys on (shop, orderId) and ignores a repeat.
  await recordCodOrder(shop, orderId, String(order.name || ""));

  return new Response();
};
