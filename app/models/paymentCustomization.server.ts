// Turns on the "COD payment method" function (extensions/cod-payment-method)
// for a shop.
//
// A Payment Customization function only runs at checkout once the shop has a
// payment customization pointing at it, so the app creates one the first time
// the merchant opens the app. With it, a cart that came from the COD button
// reaches checkout with Cash on Delivery as the payment method (App Store
// review 5.1.2). It is created once and never re-enabled behind the
// merchant's back: if they switch it off in Settings → Payments, it stays off.

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

export const COD_CUSTOMIZATION_TITLE = "Easy order COD: use Cash on Delivery";
const FUNCTION_HANDLE = "cod-payment-method";

// Per warm instance; the check itself is cheap and idempotent.
const ensured = new Set<string>();

export async function ensureCodPaymentCustomization(admin: AdminClient, shop: string): Promise<void> {
  if (ensured.has(shop)) return;
  try {
    const listed = await admin.graphql(
      `#graphql
      query CodPaymentCustomizations {
        paymentCustomizations(first: 50) { nodes { id title enabled } }
      }`,
    );
    const body: any = await listed.json();
    if (body?.errors?.length) throw new Error(body.errors.map((e: any) => e.message).join(" "));
    const exists = (body?.data?.paymentCustomizations?.nodes ?? []).some(
      (n: any) => n?.title === COD_CUSTOMIZATION_TITLE,
    );
    if (!exists) {
      const created = await admin.graphql(
        `#graphql
        mutation CodPaymentCustomizationCreate($input: PaymentCustomizationInput!) {
          paymentCustomizationCreate(paymentCustomization: $input) {
            paymentCustomization { id }
            userErrors { field message code }
          }
        }`,
        {
          variables: {
            input: { functionHandle: FUNCTION_HANDLE, title: COD_CUSTOMIZATION_TITLE, enabled: true },
          },
        },
      );
      const out: any = await created.json();
      const errors = [
        ...(out?.errors ?? []),
        ...(out?.data?.paymentCustomizationCreate?.userErrors ?? []),
      ];
      if (errors.length) throw new Error(errors.map((e: any) => e.message).join(" "));
    }
    ensured.add(shop);
  } catch (error) {
    // Never block the admin over this; it is retried on the next page load.
    console.error(`Easy order COD: payment customization for ${shop}:`, error);
  }
}

// ---------------------------------------------------------------------------
// COD rules — the "COD payment method" function reads these from a metafield
// on the payment customization ($app:cod-payment / config), so a change applies
// at checkout immediately, with nothing to store in the app's own database.
// ---------------------------------------------------------------------------

export type CodRules = {
  /** Carts from the COD button see only Cash on Delivery (else COD goes first). */
  codOnly: boolean;
  /** Postal codes where Cash on Delivery isn't offered; "1212*" = prefix. */
  blockedZips: string[];
  /** COD only from / up to these order totals (shop currency); null = no limit. */
  minTotal: number | null;
  maxTotal: number | null;
};

export const DEFAULT_COD_RULES: CodRules = { codOnly: true, blockedZips: [], minTotal: null, maxTotal: null };

async function findCustomization(admin: AdminClient): Promise<{ id: string; config: any } | null> {
  const res = await admin.graphql(
    `#graphql
    query CodPaymentCustomizationConfig {
      paymentCustomizations(first: 50) {
        nodes {
          id
          title
          metafield(namespace: "$app:cod-payment", key: "config") { jsonValue }
        }
      }
    }`,
  );
  const body: any = await res.json();
  const node = (body?.data?.paymentCustomizations?.nodes ?? []).find(
    (n: any) => n?.title === COD_CUSTOMIZATION_TITLE,
  );
  return node ? { id: node.id, config: node.metafield?.jsonValue ?? null } : null;
}

export async function getCodRules(admin: AdminClient): Promise<{ rules: CodRules; active: boolean }> {
  try {
    const found = await findCustomization(admin);
    if (!found) return { rules: DEFAULT_COD_RULES, active: false };
    const c = found.config || {};
    return {
      active: true,
      rules: {
        codOnly: c.codOnly !== false,
        blockedZips: Array.isArray(c.blockedZips) ? c.blockedZips.map(String) : [],
        minTotal: typeof c.minTotal === "number" && c.minTotal > 0 ? c.minTotal : null,
        maxTotal: typeof c.maxTotal === "number" && c.maxTotal > 0 ? c.maxTotal : null,
      },
    };
  } catch {
    return { rules: DEFAULT_COD_RULES, active: false };
  }
}

/** Returns an error message, or null when saved. */
export async function saveCodRules(admin: AdminClient, shop: string, rules: CodRules): Promise<string | null> {
  ensured.delete(shop);
  await ensureCodPaymentCustomization(admin, shop);
  const found = await findCustomization(admin);
  if (!found) {
    return "The COD payment customization isn't active yet. Check Settings → Payments → Payment customizations.";
  }
  const res = await admin.graphql(
    `#graphql
    mutation CodRulesSave($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: found.id,
            namespace: "$app:cod-payment",
            key: "config",
            type: "json",
            value: JSON.stringify(rules),
          },
        ],
      },
    },
  );
  const out: any = await res.json();
  const errors = [...(out?.errors ?? []), ...(out?.data?.metafieldsSet?.userErrors ?? [])];
  return errors.length ? errors.map((e: any) => e.message).join(" ") : null;
}
