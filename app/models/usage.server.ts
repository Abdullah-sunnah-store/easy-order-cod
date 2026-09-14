import prisma from "../db.server";

/** Current billing month as "YYYY-MM" in UTC. */
export function currentPeriod(now: Date = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

/** COD orders this shop has created in the current month. */
export async function getMonthlyOrderCount(
  shop: string,
  period: string = currentPeriod(),
): Promise<number> {
  const row = await prisma.usageCounter.findUnique({
    where: { shop_period: { shop, period } },
  });
  return row?.count ?? 0;
}

/** Record one COD order against this month's allowance. */
export async function incrementMonthlyOrderCount(
  shop: string,
  period: string = currentPeriod(),
): Promise<void> {
  await prisma.usageCounter.upsert({
    where: { shop_period: { shop, period } },
    create: { shop, period, count: 1 },
    update: { count: { increment: 1 } },
  });
}
