import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook } from "../lib/webhook.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticateWebhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
