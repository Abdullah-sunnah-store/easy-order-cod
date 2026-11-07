import { Prisma } from "@prisma/client";
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

/**
 * Records one COD order against this month's allowance — exactly once per
 * order. Returns false when this order was already recorded (Shopify delivered
 * the webhook again), in which case nothing else should be done for it.
 *
 * The ProcessedOrder insert and the counter move in one transaction, so a
 * failure leaves neither behind and Shopify's retry gets a clean second try.
 */
export async function recordCodOrder(
  shop: string,
  orderId: string,
  revenue: number,
  period: string = currentPeriod(),
): Promise<boolean> {
  try {
    await prisma.$transaction([
      prisma.processedOrder.create({ data: { shop, orderId } }),
      prisma.usageCounter.upsert({
        where: { shop_period: { shop, period } },
        create: { shop, period, count: 1, revenue },
        update: { count: { increment: 1 }, revenue: { increment: revenue } },
      }),
    ]);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false; // duplicate delivery
    }
    throw error;
  }

  // Keep the idempotency table small. 60 days is far beyond Shopify's 48-hour
  // retry window; doing it on ~2% of deliveries spreads the cost.
  if (Math.random() < 0.02) {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await prisma.processedOrder
      .deleteMany({ where: { createdAt: { lt: cutoff } } })
      .catch(() => undefined);
  }
  return true;
}

/** Counts an order that was tagged for review, for the Analytics page. */
export async function recordFlagged(
  shop: string,
  period: string = currentPeriod(),
): Promise<void> {
  await prisma.usageCounter.updateMany({
    where: { shop, period },
    data: { flagged: { increment: 1 } },
  });
}

/** The last `months` months, oldest first, with zero rows filled in. */
export async function getMonthlyHistory(shop: string, months = 6) {
  const now = new Date();
  const periods: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    periods.push(currentPeriod(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  const rows = await prisma.usageCounter.findMany({
    where: { shop, period: { in: periods } },
  });
  const byPeriod = new Map(rows.map((r) => [r.period, r]));
  return periods.map((period) => {
    const r = byPeriod.get(period);
    return {
      period,
      orders: r?.count ?? 0,
      revenue: r?.revenue ?? 0,
      flagged: r?.flagged ?? 0,
    };
  });
}
