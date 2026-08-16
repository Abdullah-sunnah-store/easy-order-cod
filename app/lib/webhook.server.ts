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
export async function authenticateWebhook(request: Request) {
  try {
    return await authenticate.webhook(request);
  } catch (error) {
    if (error instanceof Response && error.status === 400) {
      throw new Response("Unauthorized", { status: 401 });
    }
    throw error;
  }
}
