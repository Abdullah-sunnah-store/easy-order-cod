// Product-specific pixels (Advanced plan): extra pixel IDs that load only on
// chosen product pages, on top of the shop-wide ones from Connections.

export const PIXEL_PLATFORMS = ["facebook", "tiktok", "google", "snapchat", "pinterest"] as const;
export type PixelPlatform = (typeof PIXEL_PLATFORMS)[number];
export type ProductPixel = { platform: PixelPlatform; id: string; productIds: string[]; productTitles: string[] };

export function parseProductPixels(raw: string | null | undefined): ProductPixel[] {
  try {
    const list = JSON.parse(raw || "[]");
    if (!Array.isArray(list)) return [];
    return list
      .map((p: any) => ({
        platform: PIXEL_PLATFORMS.includes(p?.platform) ? p.platform : null,
        id: String(p?.id ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64),
        productIds: Array.isArray(p?.productIds)
          ? p.productIds.filter((x: unknown) => typeof x === "string" && x.startsWith("gid://shopify/Product/")).slice(0, 100)
          : [],
        productTitles: Array.isArray(p?.productTitles) ? p.productTitles.map(String).slice(0, 100) : [],
      }))
      .filter((p): p is ProductPixel => Boolean(p.platform && p.id && p.productIds.length))
      .slice(0, 50);
  } catch {
    return [];
  }
}

/** The extra pixels for one product page, as { platform, id }. */
export function pixelsForProduct(raw: string, productGid: string | null) {
  if (!productGid) return [];
  return parseProductPixels(raw)
    .filter((p) => p.productIds.includes(productGid))
    .map((p) => ({ platform: p.platform, id: p.id }));
}
