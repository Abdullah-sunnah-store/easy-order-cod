import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook } from "../lib/webhook.server";
import { getCodSettings } from "../models/codSettings.server";
import { getConnections } from "../models/connections.server";
import { getActivePlan } from "../models/billing.server";
import { recordCodOrder, recordFlagged } from "../models/usage.server";
import { rowFromOrder, sendToSheet } from "../models/sheets.server";
import {
  CUSTOMER_LIMIT_TAG,
  POSTAL_TAG,
  isBlockedPostal,
  parsePostalList,
  recentCodOrdersForCustomer,
} from "../models/fraud.server";
import { can } from "../lib/plans";

// orders/create — how a COD order is recognised now that Shopify checkout, not
// this app, creates it.
//
// The storefront block stamps the cart with an attribute before handing the
// customer to checkout; Shopify carries cart attributes onto the order, so an
// order that came from the COD button arrives here carrying it. For those
// orders only, the handler:
//   1. records it once (repeat deliveries of the same webhook are ignored),
//   2. checks the merchant's review rules (blocked postal code, repeat
//      customer) — read from the payload, never stored,
//   3. adds the merchant's tag plus any review tags in one call,
//   4. sends a row to the merchant's Google Sheet if they turned that on.
//
// Shopify gives up after 5 s, so every outside call is bounded and none of
// them can fail the delivery once the order is counted.
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

  const orderId = String(payload?.admin_graphql_api_id ?? payload?.id ?? "");
  if (!orderId) return new Response();

  // Count it first. The tag is cosmetic, the allowance is not, and a tagging
  // failure must not hand the shop a free order.
  const revenue = parseFloat(payload?.total_price ?? "0") || 0;
  const isNew = await recordCodOrder(shop, orderId, revenue);
  if (!isNew) {
    console.log(`Received ${topic} for ${shop} — ${orderId} already handled.`);
    return new Response();
  }

  if (!admin) {
    console.log(`Received ${topic} for ${shop} — COD order counted, no session to tag it.`);
    return new Response();
  }

  const [settings, connections, plan] = await Promise.all([
    getCodSettings(shop),
    getConnections(shop),
    getActivePlan(admin),
  ]);
  const tag = (settings.orderTag || "COD").trim();

  // --- Review rules -------------------------------------------------------
  const flags: string[] = [];

  if (can(plan, "postalBlocking")) {
    const zip = payload?.shipping_address?.zip ?? payload?.billing_address?.zip;
    if (isBlockedPostal(zip, parsePostalList(settings.blockedPostalCodes))) {
      flags.push(POSTAL_TAG);
    }
  }

  const max = settings.maxOrdersPerPhone; // stored name kept; now "per customer"
  const customerId = payload?.customer?.id;
  const repeatCheck =
    max > 0 && customerId && tag
      ? recentCodOrdersForCustomer(admin, customerId, tag)
      : Promise.resolve(0);

  const sheetsOn =
    can(plan, "sheets") && connections.googleSheetsEnabled && connections.googleSheetUrl;

  const recent = await repeatCheck;
  // The lookup sees orders already carrying the tag, so this one is not yet
  // included: more than `max - 1` earlier orders means this one is over.
  if (max > 0 && recent >= max) flags.push(CUSTOMER_LIMIT_TAG);

  const tags = [tag, ...flags].filter(Boolean);

  const tagging = tags.length
    ? admin
        .graphql(
          `#graphql
          mutation TagCodOrder($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              userErrors { field message }
            }
          }`,
          { variables: { id: orderId, tags } },
        )
        .then((r) => r.json())
        .then((result: any) => {
          const errors = result?.data?.tagsAdd?.userErrors ?? [];
          if (errors.length > 0) {
            console.error(`COD: could not tag ${orderId}:`, errors.map((e: any) => e.message).join(" "));
          }
        })
        .catch((e: any) => {
          // An untagged order still exists and is still counted — it just won't
          // show on the app's Orders page until the merchant tags it.
          console.error(`COD: tagging ${orderId} failed:`, e?.message || e);
        })
    : Promise.resolve();

  const exporting = sheetsOn
    ? sendToSheet(connections.googleSheetUrl, rowFromOrder(payload, flags))
    : Promise.resolve(false);

  await Promise.all([
    tagging,
    exporting,
    flags.length ? recordFlagged(shop).catch(() => undefined) : Promise.resolve(),
  ]);

  return new Response();
};
