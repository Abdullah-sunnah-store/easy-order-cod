import { appendFileSync } from "node:fs";
import { authenticate } from "../shopify.server";

/**
 * Wrapper around authenticate.webhook that answers 401 for every request it
 * cannot verify as a genuine Shopify webhook.
 *
 * authenticate.webhook distinguishes two failures: a present-but-wrong HMAC
 * gives 401, while missing Shopify headers give 400. Shopify's App Store check
 * ("Verifies webhooks with HMAC signatures") posts an unsigned request and
 * reads anything other than 401 as "this app does not verify signatures", so a
 * 400 fails the check even though the verification itself is correct.
 *
 * Collapsing both to 401 is also the more accurate answer: an unsigned request
 * is unauthenticated, not malformed.
 */
// TEMPORARY diagnostic: records every webhook request so the exact shape of
// Shopify's automated check can be inspected. Remove once the check passes.
const PROBE_LOG =
  "C:/Users/User/AppData/Local/Temp/claude/C--Users-User-Downloads-store-app/28996d4a-17ad-41c5-b03d-1a8a3c53204a/scratchpad/webhook-probe.log";

function probe(request: Request, outcome: string) {
  try {
    const h = request.headers;
    const line =
      JSON.stringify({
        at: new Date().toISOString(),
        method: request.method,
        url: new URL(request.url).pathname,
        outcome,
        topic: h.get("x-shopify-topic"),
        shop: h.get("x-shopify-shop-domain"),
        hmac: h.get("x-shopify-hmac-sha256") ? "present" : "ABSENT",
        apiVersion: h.get("x-shopify-api-version"),
        webhookId: h.get("x-shopify-webhook-id"),
        ua: h.get("user-agent"),
        ct: h.get("content-type"),
      }) + "\n";
    appendFileSync(PROBE_LOG, line);
  } catch {
    /* diagnostics must never break a webhook */
  }
}

export async function authenticateWebhook(request: Request) {
  try {
    const result = await authenticate.webhook(request);
    probe(request, "200 authenticated");
    return result;
  } catch (error) {
    if (error instanceof Response && error.status === 400) {
      probe(request, "400->401 (no/!bad headers)");
      throw new Response("Unauthorized", { status: 401 });
    }
    probe(request, error instanceof Response ? `${error.status}` : "threw");
    throw error;
  }
}
