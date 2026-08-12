import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

export async function getConnections(shop: string) {
  const existing = await prisma.connections.findUnique({ where: { shop } });
  if (existing) return existing;
  return prisma.connections.create({ data: { shop } });
}

export async function updateConnections(
  shop: string,
  data: Prisma.ConnectionsUpdateInput,
) {
  return prisma.connections.upsert({
    where: { shop },
    update: data,
    create: { shop, ...(data as Omit<Prisma.ConnectionsCreateInput, "shop">) },
  });
}
