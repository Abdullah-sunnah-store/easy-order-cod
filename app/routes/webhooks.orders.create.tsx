import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook } from "../lib/webhook.server";
import { getCodSettings } from "../models/codSettings.server";
import { incrementMonthlyOrderCount } from "../models/usage.server";

// orders/create — how a COD order is recognised now that Shopify checkout, not
// this app, creates it.
//
// The storefront block stamps the cart with an attribute before handing the
// customer to checkout; Shopify carries cart attributes onto the order, so an
// order that came from the COD button arrives here carrying it. That is the
// only thing this handler looks at. Nothing from the payload — no name, no
// address, no phone, no email — is read or stored; the order id is used to add
// the merchant's tag and the shop is counted against its monthly allowance.
const CART_ATTRIBUTE = "_easy_order_cod";

type NoteAttribute = { name?: string; value?: string };

function cameFromCodButton(payload: any): boolean {
  const attributes: NoteAttribute[] = Array.isArray(payload?.note_attributes)
    ? payload.note_attributes
    : [];
  return attributes.some((a) => a?.name === CART_ATTRIBUTE);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop, topic } = await authenticateWebhook(request);

  if (!cameFromCodButton(payload)) {
    // Every order in the shop reaches this endpoint; only ours is our business.
    return new Response();
  }

  // Count it first. The tag is cosmetic, the allowance is not, and a tagging
  // failure must not hand the shop a free order.
  await incrementMonthlyOrderCount(shop);

  const orderId = payload?.admin_graphql_api_id;
  if (!admin || !orderId) {
    console.log(`Received ${topic} for ${shop} — COD order counted, not tagged.`);
    return new Response();
  }

  const settings = await getCodSettings(shop);
  const tag = (settings.orderTag || "COD").trim();
  if (!tag) return new Response();

  try {
    const response = await admin.graphql(
      `#graphql
      mutation TagCodOrder($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { field message }
        }
      }`,
      { variables: { id: orderId, tags: [tag] } },
    );
    const result: any = await response.json();
    const errors = result?.data?.tagsAdd?.userErrors ?? [];
    if (errors.length > 0) {
      console.error(
        `COD: could not tag ${orderId}:`,
        errors.map((e: any) => e.message).join(" "),
      );
    }
  } catch (e: any) {
    // An untagged order still exists and is still counted — it just won't show
    // on the app's Orders page until the merchant tags it themselves.
    console.error(`COD: tagging ${orderId} failed:`, e?.message || e);
  }

  return new Response();
};
