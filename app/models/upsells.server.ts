import prisma from "../db.server";
import {
  createBundleDiscount,
  deleteAutomaticDiscounts,
  setAutomaticDiscountsActive,
} from "./discounts.server";

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

export async function listUpsells(shop: string) {
  return prisma.upsell.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

export type UpsellInput = {
  title: string;
  type: string;
  offerKind?: string;
  offerProductId?: string;
  offerProductTitle?: string;
  offerVariantId?: string;
  offerHandle?: string;
  offerImage?: string;
  offerPrice?: string;
  offerProductCount?: number;
  discountPercent?: number;
  minQuantity?: number;
  enabled?: boolean;
  triggerProductIds?: string[];
  triggerTitles?: string[];
};

/**
 * Saves an offer. A discounted offer first gets its Shopify buy-X-get-Y
 * discount; if Shopify refuses, nothing is saved, so the form never promises a
 * price checkout won't honour.
 */
export async function createUpsell(admin: AdminClient, shop: string, data: UpsellInput) {
  const { triggerProductIds = [], triggerTitles = [], ...rest } = data;
  const percent = Math.min(100, Math.max(0, Math.round(data.discountPercent || 0)));
  let discountId = "";
  if (percent > 0) {
    discountId = await createBundleDiscount(admin, {
      title: data.title,
      percent,
      triggerProductIds,
      offer: {
        kind: data.offerKind || "product",
        productId: data.offerProductId || "",
        variantId: data.offerVariantId || "",
      },
    });
  }
  try {
    return await prisma.upsell.create({
      data: {
        shop,
        ...rest,
        discountPercent: percent,
        discountId,
        triggerProductIds: JSON.stringify(triggerProductIds),
        triggerTitles: JSON.stringify(triggerTitles),
      },
    });
  } catch (error) {
    await deleteAutomaticDiscounts(admin, [discountId]);
    throw error;
  }
}

export async function deleteUpsell(admin: AdminClient, shop: string, id: string) {
  // Scoped to the shop so one store can't remove another's offers.
  const offer = await prisma.upsell.findFirst({ where: { id, shop } });
  if (!offer) return;
  await deleteAutomaticDiscounts(admin, [offer.discountId]);
  await prisma.upsell.deleteMany({ where: { id, shop } });
}

export async function toggleUpsell(admin: AdminClient, shop: string, id: string, enabled: boolean) {
  const offer = await prisma.upsell.findFirst({ where: { id, shop } });
  if (!offer) return;
  await setAutomaticDiscountsActive(admin, [offer.discountId], enabled);
  await prisma.upsell.updateMany({ where: { id, shop }, data: { enabled } });
}
