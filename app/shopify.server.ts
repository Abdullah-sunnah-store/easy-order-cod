import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BILLING_PLANS, PLANS } from "./lib/plans";

// Re-exported for convenience; the source of truth lives in ./lib/plans.
export { PLANS };

// The app URL has to be an absolute https origin that matches application_url
// in shopify.app.production.toml, or OAuth redirects land nowhere and the
// embedded iframe renders a browser error instead of the app. Vercel exposes
// the project's stable production hostname to every deployment, so use that
// when SHOPIFY_APP_URL has not been set by hand.
const appUrl =
  process.env.SHOPIFY_APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "");

// Fail at boot with the name of what is missing. Left unchecked, an unset
// variable surfaces as an opaque 500 on every route - which is how this app
// failed App Store review the first time.
const required = {
  SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  SHOPIFY_APP_URL: appUrl,
};
const missing = Object.entries(required)
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missing.length) {
  throw new Error(
    `Missing required environment variable(s): ${missing.join(", ")}. ` +
      "Set them on the host (Vercel: Project -> Settings -> Environment " +
      "Variables) and redeploy; the app cannot serve a single request " +
      "without them.",
  );
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  // One entry per sellable subscription (monthly and yearly of each tier),
  // generated from the same list the Plans page renders.
  billing: Object.fromEntries(
    BILLING_PLANS.map((p) => [
      p.key,
      {
        lineItems: [
          {
            amount: p.amount,
            currencyCode: "USD",
            interval: p.cycle === "yearly" ? BillingInterval.Annual : BillingInterval.Every30Days,
          },
        ],
      },
    ]),
  ) as any,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
