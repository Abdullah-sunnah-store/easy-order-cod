import prisma from "../db.server";

/** Current billing month as "YYYY-MM" in UTC. */
export function currentPeriod(now: Date = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

/** COD orders this shop has taken in the current month. */
export async function getMonthlyOrderCount(
  shop: string,
  period: string = currentPeriod(),
): Promise<number> {
  const row = await prisma.usageCounter.findUnique({
    where: { shop_period: { shop, period } },
  });
  return row?.count ?? 0;
}

/**
 * Records one COD order seen on the orders/create webhook.
 *
 * Shopify creates the order now, not the app, so the count is observed rather
 * than incremented at the moment of writing. Shopify retries deliveries, so the
 * CodOrder row is what makes this idempotent: the monthly counter only moves
 * when the order is one we haven't seen before.
 */
export async function recordCodOrder(
  shop: string,
  orderId: string,
  name: string,
  period: string = currentPeriod(),
): Promise<void> {
  try {
    await prisma.codOrder.create({ data: { shop, orderId, name, period } });
  } catch {
    // Unique violation on (shop, orderId) — a retried delivery. The counter
    // must not move again.
    return;
  }
  await prisma.usageCounter.upsert({
    where: { shop_period: { shop, period } },
    create: { shop, period, count: 1 },
    update: { count: { increment: 1 } },
  });
}

/**
 * The COD orders this shop has taken, most recent first. Ids only — the Orders
 * page hydrates the details from Shopify so nothing personal is kept here.
 */
export async function listCodOrderIds(
  shop: string,
  limit = 50,
): Promise<string[]> {
  const rows = await prisma.codOrder.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { orderId: true },
  });
  return rows.map((r) => r.orderId);
}
