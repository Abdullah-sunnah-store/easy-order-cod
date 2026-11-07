// Types the global `shopify` object for this target (the Shopify CLI would
// generate the same file).
import "@shopify/ui-extensions";

//@ts-ignore
declare module "./src/ThankYou.tsx" {
  const shopify: import("@shopify/ui-extensions/purchase.thank-you.block.render").Api;
  const globalThis: { shopify: typeof shopify };
}
