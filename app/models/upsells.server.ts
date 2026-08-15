import prisma from "../db.server";

export async function listUpsells(shop: string) {
  return prisma.upsell.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

export async function createUpsell(
  shop: string,
  data: {
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
  },
) {
  return prisma.upsell.create({ data: { shop, ...data } });
}

export async function deleteUpsell(shop: string, id: string) {
  // Scope delete to the shop so one store can't remove another's offers.
  return prisma.upsell.deleteMany({ where: { id, shop } });
}

export async function toggleUpsell(shop: string, id: string, enabled: boolean) {
  return prisma.upsell.updateMany({ where: { id, shop }, data: { enabled } });
}
