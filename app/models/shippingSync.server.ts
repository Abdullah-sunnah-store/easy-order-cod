import type { ShipOption } from "../lib/shipping";
import { updateCodSettings } from "./codSettings.server";

// Reads the shop's own shipping zones (Settings → Shipping and delivery) and
// turns every flat rate into a selectable option on the COD form, so merchants
// don't have to re-type rates they already configured in Shopify.
//
// Carrier-calculated rates (DeliveryParticipant) are skipped on purpose: their
// price depends on a real cart and address quote, which the COD form has no way
// to obtain before the order exists.

const RATES_QUERY = `#graphql
  query CodDeliveryRates {
    deliveryProfiles(first: 10) {
      nodes {
        profileLocationGroups {
          locationGroupZones(first: 50) {
            nodes {
              zone { name }
              methodDefinitions(first: 50) {
                nodes {
                  name
                  active
                  rateProvider {
                    __typename
                    ... on DeliveryRateDefinition {
                      price { amount }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

/**
 * Flat rates from every delivery profile, deduped by name. Two zones can define
 * the same rate name at different prices ("Standard" 60 vs 120) — the zone name
 * is appended in that case so the customer can tell them apart.
 */
export async function fetchShopifyRates(
  admin: AdminClient,
): Promise<ShipOption[]> {
  const res = await admin.graphql(RATES_QUERY);
  const body: any = await res.json();
  if (body?.errors?.length) {
    throw new Error(body.errors[0]?.message || "Shipping rate query failed");
  }

  const found: Array<{ name: string; price: number; zone: string }> = [];
  for (const profile of body?.data?.deliveryProfiles?.nodes || []) {
    for (const group of profile?.profileLocationGroups || []) {
      for (const zoneNode of group?.locationGroupZones?.nodes || []) {
        const zone = String(zoneNode?.zone?.name || "").trim();
        for (const def of zoneNode?.methodDefinitions?.nodes || []) {
          if (def?.active === false) continue;
          const amount = def?.rateProvider?.price?.amount;
          if (amount == null) continue; // carrier-calculated — no fixed price
          const name = String(def?.name || "").trim();
          if (!name) continue;
          found.push({ name, price: Number(amount) || 0, zone });
        }
      }
    }
  }

  const byName = new Map<string, ShipOption>();
  for (const rate of found) {
    const key = rate.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { name: rate.name, price: rate.price });
      continue;
    }
    if (existing.price === rate.price) continue;
    // Same label, different price — qualify both with their zone.
    const zoned = rate.zone ? `${rate.name} (${rate.zone})` : rate.name;
    if (!byName.has(zoned.toLowerCase())) {
      byName.set(zoned.toLowerCase(), { name: zoned, price: rate.price });
    }
  }
  return [...byName.values()];
}

/** Fetch + persist, so the storefront keeps working if a later fetch fails. */
export async function syncShopifyRates(admin: AdminClient, shop: string) {
  const rates = await fetchShopifyRates(admin);
  const syncedAt = new Date();
  await updateCodSettings(shop, {
    shippingSynced: JSON.stringify(rates),
    shippingSyncedAt: syncedAt,
  });
  return { rates, syncedAt };
}

// Storefront auto-refresh cache. Every product-page view hits /apps/cod/settings,
// so without this a busy shop would re-query the Admin API on each one.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; rates: ShipOption[] }>();

/**
 * Rates for a storefront request. Serves the in-memory cache, then a live
 * fetch; on any failure the caller's stored rates are returned unchanged so a
 * transient API error never empties the form.
 */
export async function getLiveRates(
  admin: AdminClient,
  shop: string,
  stored: ShipOption[],
): Promise<ShipOption[]> {
  const hit = cache.get(shop);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rates;
  try {
    const rates = await fetchShopifyRates(admin);
    cache.set(shop, { at: Date.now(), rates });
    // Persist quietly so "Sync now" isn't the only thing that refreshes the
    // copy the admin page shows.
    updateCodSettings(shop, {
      shippingSynced: JSON.stringify(rates),
      shippingSyncedAt: new Date(),
    }).catch(() => {});
    return rates;
  } catch {
    return stored;
  }
}
