# Easy order COD — hosting and release runbook

Read this before deploying or resubmitting for App Store review.

## Why this file exists

The app was rejected under App Store requirements 2.3.3 and 2.1.1. The reviewer
saw Chrome's *"server IP address could not be found"* inside the embedded
iframe. Neither citation was an application bug — the OAuth redirect worked
correctly and landed on a hostname where **nothing was running**:

| Hostname | Where it was configured | State at rejection |
| --- | --- | --- |
| `fever-jonathan-humidity-pubmed.trycloudflare.com` | `shopify.app.toml` | NXDOMAIN — a `shopify app dev` tunnel that had expired |
| `easy-order-cod.onrender.com` | `shopify.app.production.toml` | Resolves, but `x-render-routing: no-server` — the Render service did not exist |
| `easy-order-cod.fly.dev` | `fly.toml`, `render-postgres` branch | NXDOMAIN — the Fly app was gone |

A second, compounding defect: the branch Render was pointed at,
`render-postgres`, sat **four commits behind `master`** and would have shipped
the retired `2025-01` Admin API version and no explicit webhook HMAC
verification. Both are independent review failures.

The host is now **Vercel**: <https://easy-order-cod.vercel.app>. Its first
deployment answered `500 FUNCTION_INVOCATION_FAILED` on every route, for two
reasons that the rules below now prevent:

- the build had no Vercel adapter, so nothing packaged the Remix server bundle
  into a function Vercel could call (`vercelPreset()` in `vite.config.ts`);
- the environment variables were unset, so `app/shopify.server.ts` threw while
  the module was still loading — which takes down every route, `/healthz`
  included.

## The second rejection: requirement 1.1.2 (use Shopify checkout)

The app was rejected again, this time on a core requirement rather than a
hosting fault. The reviewer's finding:

> the theme app extension form of the application is requesting Information
> that should be filled out through Shopify checkout page

The storefront block collected a name, phone, email, address and city, let the
customer choose a shipping rate, and posted all of it to `/apps/cod/order`,
which called Admin `orderCreate`. That is both halves of what 1.1.2 forbids:
checkout-owned data collected offsite, and a transaction registered through the
API in connection with it.

The flow was rebuilt around Shopify checkout — see **How an order is placed** in
the README. What changed:

| Removed | Replaced by |
| --- | --- |
| Name, phone, email, address, city, notes fields | Shopify checkout |
| Shipping rate picker, city rules, rate sync (`read_shipping`) | Shopify checkout's own rates |
| COD fee and free-shipping lines on the form | Settings → Shipping and delivery |
| Offer discount percentages | Shopify → Discounts |
| `proxy.order.tsx` → Admin `orderCreate` | `/cart/add.js` → `/checkout` |
| Order counting at creation time | `orders/create` webhook |

### What must be true before resubmitting

1. **Scopes changed.** `read_shipping` is gone. Update `SCOPES` in Vercel →
   Settings → Environment Variables to `read_orders,write_orders,read_products,write_discounts`
   and redeploy, or the value the app boots with will not match the config it
   released. Installed shops are re-prompted through `app/scopes_update`.
2. **A new webhook subscription** (`orders/create`) ships with the release. It
   needs the protected customer data approval the app already holds.
3. **The test store needs cash on delivery enabled**: Settings → Payments →
   Manual payment methods → **Cash on Delivery (COD)**. Without it the reviewer
   reaches checkout and finds no COD option, which reads as a broken app.
4. **Walk the flow once on the storefront** before submitting: product page →
   COD button → modal → Continue to checkout → Shopify checkout shows the item,
   asks for the address, and offers Cash on Delivery. Then confirm the order
   appears on the app's Orders page carrying the merchant's tag.


## The webhook URLs were registered one segment too deep

The "Verifies webhooks with HMAC signatures" automated check kept failing even
though the verification code was correct. Probing
`https://easy-order-cod.vercel.app/webhooks/customers/data_request` by hand
returned exactly what the check wants — 401 for a bad signature, 200 for a good
one. Shopify was not probing that URL.

`.shopify/deploy-bundle/manifest.json`, written by the last `shopify app
deploy`, says what was actually registered:

```json
"customers_data_request_url": "https://easy-order-cod.vercel.app/app/webhooks/customers/data_request",
"uri": "https://easy-order-cod.vercel.app/app/webhooks/app/uninstalled"
```

Note the `/app`. The CLI turns a relative `uri` into an endpoint by
**concatenating** it onto `application_url`, not by resolving it as a URL. This
app's `application_url` is `https://easy-order-cod.vercel.app/app` — the
embedded UI lives under `/app` — so every relative `uri` shipped a segment too
deep, at a path the app answers with **404**. Shopify saw a 404 where a signed
401 belongs, and failed the check.

Two consequences, only one of them visible:

- the review check failed;
- `app/uninstalled` and `app/scopes_update` **never fired in production**, so
  sessions were never deleted when a shop uninstalled.

Most apps never meet this because their `application_url` is a bare origin.

**The fix:** every `uri` in `shopify.app.production.toml` is now an absolute
`https://easy-order-cod.vercel.app/webhooks/…` URL, and must stay that way.
`shopify.app.toml` keeps relative URIs on purpose — `shopify app dev` rewrites
its `application_url` to the tunnel root, which has no path, so they resolve
correctly there. That is one more reason never to deploy the dev config.

`npm run check:release` now resolves each `uri` the same way the CLI does,
rejects any that lands outside `/webhooks/*`, and POSTs an invalidly-signed
delivery to the compliance endpoint to confirm it answers 401.

**A released version keeps its old URLs until the next `shopify app deploy`,**
so `app/routes/app_.webhooks.*.tsx` alias the same handlers at
`/app/webhooks/*`. That makes the already-registered endpoints answer correctly
from a plain Vercel deploy, with no Shopify release — which is how the review
check was cleared. The trailing `_` in `app_.` opts the routes out of nesting
under `app.tsx`, so they stay resource routes and never hit
`authenticate.admin`. Keep them: they also catch any shop still delivering to
the old path.

## The invariants

1. **One deployable branch: `master`.** It is the Vercel project's Production
   Branch; every push to it redeploys. There is no separate database branch any
   more — Postgres is the Prisma provider in every environment, so there is one
   schema and one migration history.
2. **The released version comes from `shopify.app.production.toml`, never
   `shopify.app.toml`.** `npm run deploy` passes `--config production`
   explicitly, and that file carries `automatically_update_urls_on_dev = false`.
3. **`npm run deploy` will not release a broken app.** A `predeploy` hook runs
   `scripts/check-release-config.mjs`, which fails the deploy if any URL is a
   tunnel or non-HTTPS, if the proxy or OAuth callbacks are on a different
   origin from `application_url`, if the Admin API version disagrees between
   `shopify.app.production.toml`, the theme extension and `app/shopify.server.ts`,
   or if `https://<production host>/healthz` does not answer `200`. It reports
   any `x-vercel-error` it sees, which names the failure directly.
4. **Webhook `uri` values in the release config are absolute URLs.** A relative
   one is concatenated onto `application_url`, which ends in `/app`, and lands
   on a 404. The pre-flight resolves them the CLI's way and probes the
   compliance endpoint for a 401.
5. **Release against the production alias, never a deployment URL.**
   `easy-order-cod.vercel.app` always points at the current production
   deployment. The per-deployment `…-<hash>-<team>.vercel.app` URLs are
   throwaway and may sit behind Deployment Protection — a released version
   carrying one is another dead link.

## First-time setup

### 1. Database (Neon)

1. Create a project at <https://neon.tech> (the free tier is enough to start),
   or add Neon from the Vercel dashboard under **Storage**, which sets
   `DATABASE_URL` on the project for you.
2. Create **two branches**: `production` and `dev`. Development must never write
   to live merchant data.
3. Copy each branch's **pooled** connection string — the host containing
   `-pooler` — keeping `?sslmode=require`.
4. Put the `dev` one in your local `.env` (see `.env.example`).

### 2. Host (Vercel)

1. Vercel → **Add New → Project** → import this repository. The settings in
   `vercel.json` (framework, install and build commands) are read from the repo;
   leave the dashboard's Build & Development Settings on their defaults.
2. **Settings → Git → Production Branch: `master`.**
3. **Settings → Environment Variables** — add all four to *Production* (and to
   *Preview* if you use preview deployments). The app refuses to boot without
   them and says which one is missing:

   | Variable | Value |
   | --- | --- |
   | `SHOPIFY_API_KEY` | `7d6846fb9f944b6701f6cc35b77eab6f` (the `client_id`) |
   | `SHOPIFY_API_SECRET` | Partner Dashboard → your app → API credentials |
   | `SCOPES` | `read_orders,write_orders,read_products,write_discounts` |
   | `DATABASE_URL` | the Neon **production** pooled connection string |

   `SHOPIFY_APP_URL` is optional: unset, the app falls back to Vercel's
   `VERCEL_PROJECT_PRODUCTION_URL`, which is the production alias. Set it
   explicitly once a custom domain is in play.
4. Redeploy. `npm run vercel-build` runs `prisma migrate deploy` on the build
   machine, so the schema is created automatically — which also means a bad
   `DATABASE_URL` fails the build loudly instead of shipping a broken app.
5. Confirm the host is genuinely serving before going near Shopify:

   ```shell
   curl -i https://easy-order-cod.vercel.app/healthz    # expect: 200, body "ok"
   ```

   Anything else — especially `x-vercel-error: FUNCTION_INVOCATION_FAILED` —
   means the deployment is not serving. Open the deployment's **Runtime Logs**;
   a missing environment variable names itself there.

   If the project's production alias is not `easy-order-cod.vercel.app`
   (Vercel appends a suffix when the name is taken), correct all five URLs in
   `shopify.app.production.toml` to match before releasing.

### 3. Release to Shopify

```shell
npm run deploy      # runs the pre-flight, then `shopify app deploy --config production`
```

The pre-flight prints the origin it checked and refuses to continue if the host
is not answering. Then, in the Partner Dashboard, submit the fixes for review.

## Everyday development

```shell
npm run dev         # `shopify app dev --config shopify.app.toml`
```

`shopify app dev` rewrites `application_url`, `redirect_urls` and
`app_proxy.url` in whichever config is active — that is what put an expiring
tunnel into the app's URLs. `npm run dev` therefore pins `--config
shopify.app.toml`, and only that file is allowed to hold tunnel URLs. The churn
it causes there is expected; **do not commit it**, and never deploy that file.

When you finish a dev session, drop the dev preview so the store goes back to
the released version:

```shell
shopify app dev clean
```

Leaving a preview active means installers keep loading the tunnel URL long
after the tunnel is dead.

## Checks you can run any time

```shell
npm run check:release                       # full pre-flight, including liveness
node scripts/check-release-config.mjs --skip-live   # config only, no network
```

## Changing the schema

Because there is a single Postgres migration history, this is now ordinary:

```shell
npx prisma migrate dev --name describe_the_change
```

Commit the generated folder under `prisma/migrations/`. Vercel applies it on the
next deploy via `npm run vercel-build`. Never hand-edit an applied migration.

## Optional: a separate development app

Development and production currently share one `client_id`
(`7d6846fb9f944b6701f6cc35b77eab6f`), so a mistaken `shopify app deploy` from
the dev config would still be able to point the published app at a tunnel. The
pre-flight blocks that, but the airtight version is a second app in the Partner
Dashboard used only for development, with its own client id in
`shopify.app.toml`. Worth doing once the app is live.
