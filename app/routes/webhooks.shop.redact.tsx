import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR compliance webhook: shop/redact.
// Fires 48h after a shop uninstalls — erase all of this shop's stored data.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} for ${shop} — erasing all shop data.`);

  await Promise.all([
    db.session.deleteMany({ where: { shop } }),
    db.codSettings.deleteMany({ where: { shop } }),
    db.connections.deleteMany({ where: { shop } }),
    db.upsell.deleteMany({ where: { shop } }),
  ]);

  return new Response();
};
