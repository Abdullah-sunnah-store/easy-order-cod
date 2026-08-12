import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

// Returns the shop's settings, creating a default row on first access.
export async function getCodSettings(shop: string) {
  const existing = await prisma.codSettings.findUnique({ where: { shop } });
  if (existing) return existing;
  return prisma.codSettings.create({ data: { shop } });
}

// Upsert a partial set of fields (each admin page saves only its own section).
export async function updateCodSettings(
  shop: string,
  data: Prisma.CodSettingsUpdateInput,
) {
  return prisma.codSettings.upsert({
    where: { shop },
    update: data,
    create: { shop, ...(data as Omit<Prisma.CodSettingsCreateInput, "shop">) },
  });
}
