import { createHmac, timingSafeEqual } from "node:crypto";
import { authenticate } from "../shopify.server";

// Webhook authentication, following Shopify's documented HMAC verification:
// https://shopify.dev/docs/apps/build/webhooks/verify-deliveries#hmac-verification
//
// The rules that matter there:
//   • HMAC-SHA256 the RAW request body, keyed with the app's client secret
//   • the X-Shopify-Hmac-Sha256 header is base64 — decode before comparing
//   • compare with a timing-safe equality check, never ===
//   • reject any delivery whose signatures don't match (400 or 401)
//   • acknowledge a good delivery with 200; anything outside 2xx counts as an
//     error, and Shopify gives up after a 5s request timeout
//
// authenticate.webhook() already does all of this. The explicit pass below runs
// first as defence in depth: it fails closed if the library's behaviour ever
// changes, and it makes the verification auditable in our own code rather than
// buried in a dependency.

/**
 * Constant-time comparison of the computed digest against the header value.
 * Returns false for a missing header, an unset secret, or any length mismatch —
 * timingSafeEqual throws when the buffers differ in length.
 */
function hmacMatches(rawBody: string, headerValue: string | null): boolean {
  if (!headerValue) return false;
  const secret = process.env.SHOPIFY_API_SECRET || "";
  if (!secret) return false;

  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(headerValue, "base64");
  } catch {
    return false;
  }
  if (provided.length !== computed.length) return false;
  return timingSafeEqual(computed, provided);
}

/**
 * Verifies a webhook delivery and returns the parsed Shopify context.
 *
 * Throws a 401 Response for anything that isn't a genuine, correctly signed
 * delivery — an unsigned probe included. (The library alone answers 400 when the
 * Shopify headers are absent; the docs permit either, but 401 is the more
 * accurate description of an unauthenticated request.)
 */
export async function authenticateWebhook(request: Request) {
  // clone() so the body stays unread for authenticate.webhook below — reading
  // the original would leave it with an empty stream.
  const rawBody = await request.clone().text();
  const header = request.headers.get("x-shopify-hmac-sha256");

  if (!hmacMatches(rawBody, header)) {
    console.warn(
      "COD: rejected webhook with an invalid signature",
      JSON.stringify({
        path: new URL(request.url).pathname,
        topic: request.headers.get("x-shopify-topic"),
        shop: request.headers.get("x-shopify-shop-domain"),
        hmac: header ? "present-but-invalid" : "absent",
      }),
    );
    throw new Response("Unauthorized", { status: 401 });
  }

  try {
    return await authenticate.webhook(request);
  } catch (error) {
    // Keep the status honest if the library rejects it for its own reasons.
    if (error instanceof Response && error.status === 400) {
      throw new Response("Unauthorized", { status: 401 });
    }
    throw error;
  }
}
