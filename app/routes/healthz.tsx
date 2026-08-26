// Unauthenticated liveness probe for the host.
// Every other route requires a Shopify session, so none of them can be used as
// a probe: they redirect or 401. `npm run check:release` hits this before it
// will release, because a released version pointing at a host that is not
// serving is exactly what failed App Store review.
export const loader = () => new Response("ok", { status: 200 });
