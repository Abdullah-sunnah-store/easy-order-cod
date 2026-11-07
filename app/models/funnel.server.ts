import prisma from "../db.server";

function day(d: Date = new Date()) {
  return d.toISOString().slice(0, 10);
}

/**
 * Adds one page view's worth of funnel steps. The storefront sends at most one
 * beacon per page, so each flag is 0 or 1 — never trust a bigger number.
 */
export async function recordFunnel(shop: string, steps: { v?: unknown; o?: unknown; c?: unknown }) {
  const views = steps.v ? 1 : 0;
  const opens = steps.o ? 1 : 0;
  const checkouts = steps.c ? 1 : 0;
  if (!views && !opens && !checkouts) return;
  const today = day();
  await prisma.funnelStat.upsert({
    where: { shop_day: { shop, day: today } },
    create: { shop, day: today, views, opens, checkouts },
    update: {
      views: { increment: views },
      opens: { increment: opens },
      checkouts: { increment: checkouts },
    },
  });
}

/** Daily funnel for the last `days` days (oldest first) plus COD orders per day. */
export async function getFunnel(shop: string, days = 30) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const keys: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    keys.push(day(d));
  }

  const [stats, orders] = await Promise.all([
    prisma.funnelStat.findMany({ where: { shop, day: { gte: keys[0] } } }),
    // ProcessedOrder keeps 60 days of COD order ids — enough for a 30-day view.
    prisma.processedOrder.findMany({
      where: { shop, createdAt: { gte: start } },
      select: { createdAt: true },
    }),
  ]);

  const byDay = new Map(stats.map((s) => [s.day, s]));
  const ordersByDay = new Map<string, number>();
  for (const o of orders) {
    const k = day(o.createdAt);
    ordersByDay.set(k, (ordersByDay.get(k) ?? 0) + 1);
  }

  return keys.map((k) => ({
    day: k,
    views: byDay.get(k)?.views ?? 0,
    opens: byDay.get(k)?.opens ?? 0,
    checkouts: byDay.get(k)?.checkouts ?? 0,
    orders: ordersByDay.get(k) ?? 0,
  }));
}
