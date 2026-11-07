import { MAX_TIERS } from "../lib/offers";
import prisma from "../db.server";
import {
  createTierDiscounts,
  deleteAutomaticDiscounts,
  parseIds,
  setAutomaticDiscountsActive,
  type Tier,
} from "./discounts.server";

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

export { MAX_TIERS };

/** Cleans what the admin form posted: 2–4 tiers, ascending, sane numbers. */
export function normaliseTiers(raw: unknown): Tier[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<number>();
  return list
    .map((t: any) => ({
      qty: Math.floor(Number(t?.qty) || 0),
      percent: Math.round(Math.min(90, Math.max(0, Number(t?.percent) || 0))),
      label: String(t?.label ?? "").slice(0, 60),
      badge: String(t?.badge ?? "").slice(0, 30),
    }))
    // A one-unit tier is the "just one" option; it never carries a discount.
    .map((t) => (t.qty === 1 ? { ...t, percent: 0 } : t))
    .filter((t) => t.qty >= 1 && t.qty <= 100 && !seen.has(t.qty) && seen.add(t.qty))
    .sort((a, b) => a.qty - b.qty)
    .slice(0, MAX_TIERS);
}

export function parseTiers(raw: string | null | undefined): Tier[] {
  try {
    return normaliseTiers(JSON.parse(raw || "[]"));
  } catch {
    return [];
  }
}

export async function listQuantityOffers(shop: string) {
  return prisma.quantityOffer.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });
}

export async function createQuantityOffer(
  admin: AdminClient,
  shop: string,
  input: { title: string; productIds: string[]; productTitles: string[]; tiers: Tier[] },
) {
  const discountIds = await createTierDiscounts(admin, input.title, input.productIds, input.tiers);
  try {
    return await prisma.quantityOffer.create({
      data: {
        shop,
        title: input.title,
        productIds: JSON.stringify(input.productIds),
        productTitles: JSON.stringify(input.productTitles),
        tiers: JSON.stringify(input.tiers),
        discountIds: JSON.stringify(discountIds),
      },
    });
  } catch (error) {
    await deleteAutomaticDiscounts(admin, discountIds);
    throw error;
  }
}

export async function deleteQuantityOffer(admin: AdminClient, shop: string, id: string) {
  const offer = await prisma.quantityOffer.findFirst({ where: { id, shop } });
  if (!offer) return;
  await deleteAutomaticDiscounts(admin, parseIds(offer.discountIds));
  await prisma.quantityOffer.deleteMany({ where: { id, shop } });
}

export async function toggleQuantityOffer(admin: AdminClient, shop: string, id: string, enabled: boolean) {
  const offer = await prisma.quantityOffer.findFirst({ where: { id, shop } });
  if (!offer) return;
  await setAutomaticDiscountsActive(admin, parseIds(offer.discountIds), enabled);
  await prisma.quantityOffer.updateMany({ where: { id, shop }, data: { enabled } });
}

/**
 * The tiers to show on one product page: the first enabled offer that names
 * this product, else the first "all products" offer. Always starts with a
 * plain one-unit option so the customer can still buy a single item.
 */
export async function tiersForProduct(shop: string, productGid: string | null) {
  const offers = (await listQuantityOffers(shop)).filter((o) => o.enabled);
  const specific = productGid
    ? offers.find((o) => parseIds(o.productIds).includes(productGid))
    : undefined;
  const general = offers.find((o) => parseIds(o.productIds).length === 0);
  const offer = specific ?? general;
  if (!offer) return [];
  const tiers = parseTiers(offer.tiers);
  if (!tiers.length) return [];
  return tiers[0].qty === 1 ? tiers : [{ qty: 1, percent: 0, label: "", badge: "" }, ...tiers];
}
