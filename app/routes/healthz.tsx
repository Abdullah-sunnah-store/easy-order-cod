// Unauthenticated liveness probe for the host (Render health checks).
// Every other route requires a Shopify session, so none of them can be used:
// they redirect or 401 and the platform reads that as a failed deploy.
export const loader = () => new Response("ok", { status: 200 });
