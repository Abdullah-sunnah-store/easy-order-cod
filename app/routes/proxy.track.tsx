import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { recordFunnel } from "../models/funnel.server";

// Funnel beacon from the storefront block, via the app proxy (/apps/cod/track).
// One request per product page view at most: { v: 1, o: 0|1, c: 0|1 } =
// button shown, form opened, sent to checkout. Counts only; nothing about the
// visitor is read or stored. Always answers 204 so a beacon never retries.
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (!session) return new Response(null, { status: 204 });
    const text = (await request.text()).slice(0, 200);
    let steps: Record<string, unknown> = {};
    try {
      steps = JSON.parse(text || "{}");
    } catch {
      /* ignore junk */
    }
    await recordFunnel(session.shop, steps);
  } catch (error) {
    if (error instanceof Response) return new Response(null, { status: 204 });
    console.error("COD track:", error);
  }
  return new Response(null, { status: 204 });
};

export const loader = () => new Response(null, { status: 405 });
