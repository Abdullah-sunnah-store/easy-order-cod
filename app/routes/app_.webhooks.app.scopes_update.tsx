// Alias for /app/webhooks/app/scopes_update — the same handler as
// /webhooks/app/scopes_update, reachable at the path Shopify actually registered.
//
// The CLI builds a webhook endpoint by concatenating a relative `uri` onto
// application_url, which here is ".../app". Every released version therefore
// pointed Shopify at /app/webhooks/*, where the app served 404 — failing the
// "Verifies webhooks with HMAC signatures" review check and silently stopping
// app/uninstalled from ever firing. shopify.app.production.toml now uses
// absolute URLs, but a released version keeps its old ones until the next
// `shopify app deploy`, and this file keeps those deliveries working.
//
// The trailing underscore in `app_.` opts out of nesting under app.tsx, so
// this is a plain resource route and never touches `authenticate.admin`.
export { action } from "./webhooks.app.scopes_update";
