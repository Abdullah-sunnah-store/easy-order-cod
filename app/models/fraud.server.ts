// Review flags for COD orders.
//
// The app never sees a customer before the order exists — Shopify checkout
// collects the address and phone — so it cannot stop an order. What it can do
// is mark a suspicious one the moment it arrives, so the merchant checks it
// before shipping. Flags are added as order tags; nothing is cancelled.

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

export { POSTAL_TAG, CUSTOMER_LIMIT_TAG } from "../lib/reviewTags";

function normalisePostal(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Parses the merchant's list: comma- or newline-separated, case- and
 * space-insensitive. A trailing * matches a prefix ("1212*" → 12120, 1212AB…).
 */
export function parsePostalList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => normalisePostal(s.trim()))
    .filter(Boolean);
}

export function isBlockedPostal(zip: string | null | undefined, list: string[]): boolean {
  if (!zip || list.length === 0) return false;
  const code = normalisePostal(zip);
  return list.some((entry) =>
    entry.endsWith("*") ? code.startsWith(entry.slice(0, -1)) : code === entry,
  );
}

/**
 * How many COD orders (by tag) this customer placed in the last 30 days,
 * including the one just created. Returns 0 when it cannot tell — a lookup
 * failure must never flag an order.
 */
export async function recentCodOrdersForCustomer(
  admin: AdminClient,
  customerId: string | number,
  tag: string,
): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const safeTag = tag.replace(/["\\]/g, "");
  try {
    const response = await admin.graphql(
      `#graphql
      query CodRepeatCustomer($query: String!) {
        orders(first: 50, query: $query) { nodes { id } }
      }`,
      {
        variables: {
          query: `customer_id:${Number(customerId)} AND tag:"${safeTag}" AND created_at:>=${since}`,
        },
      },
    );
    const body: any = await response.json();
    return body?.data?.orders?.nodes?.length ?? 0;
  } catch {
    return 0;
  }
}
