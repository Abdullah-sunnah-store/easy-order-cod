// Shipping rate resolution shared by the admin preview, the app proxy and the
// order route.
//
// IMPORTANT: extensions/cod-form/assets/cod-form.js repeats normalizeCity /
// matchRule / resolveShippingOptions in ES5 so the storefront can re-price the
// form as the customer types their city without a round-trip. Change both.

export type ShipOption = {
  name: string;
  price: number;
  /** Set on the rate produced by the city rules, so the UI can label it. */
  dynamic?: boolean;
};

export type ShipRule = {
  /** Comma-separated city names, e.g. "Dhaka, Gazipur, Narayanganj". */
  cities: string;
  price: number;
  label: string;
};

export type ShipMode = "manual" | "auto" | "both";

export type ShippingConfig = {
  mode: ShipMode;
  manual: ShipOption[];
  synced: ShipOption[];
  /** Names of synced rates the merchant switched off. */
  hiddenRates: string[];
  rulesEnabled: boolean;
  rules: ShipRule[];
  fallbackPrice: number;
  fallbackLabel: string;
  freeShippingThreshold: number;
};

export const DEFAULT_FALLBACK_LABEL = "Delivery charge";

/** Lower-cases and collapses punctuation so "Dhaka-1207" ≈ "dhaka 1207". */
export function normalizeCity(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^0-9a-zÀ-￿]+/gi, " ")
    .trim();
}

/**
 * A rule matches when the typed city contains one of its names, or a name
 * contains the typed city — so "Dhaka" matches "dhaka north" and "Dhak" alike.
 */
export function ruleMatchesCity(rule: ShipRule, city: string): boolean {
  const typed = normalizeCity(city);
  if (!typed) return false;
  return String(rule?.cities || "")
    .split(",")
    .map(normalizeCity)
    .filter(Boolean)
    .some((name) => typed.indexOf(name) >= 0 || name.indexOf(typed) >= 0);
}

/** The city-driven rate: first matching rule, else the fallback. */
export function dynamicRate(
  rules: ShipRule[],
  fallbackPrice: number,
  fallbackLabel: string,
  city: string,
): ShipOption {
  const hit = (rules || []).find((r) => ruleMatchesCity(r, city));
  if (hit) {
    return {
      name: String(hit.label || "").trim() || DEFAULT_FALLBACK_LABEL,
      price: Number(hit.price) || 0,
      dynamic: true,
    };
  }
  return {
    name: String(fallbackLabel || "").trim() || DEFAULT_FALLBACK_LABEL,
    price: Number(fallbackPrice) || 0,
    dynamic: true,
  };
}

/**
 * A synced rate is switched off when its name is on the hidden list. Compared
 * case-insensitively so the list survives a rename that only changes casing.
 */
export function isRateHidden(name: string, hidden: string[]): boolean {
  const key = String(name || "").trim().toLowerCase();
  return (hidden || []).some((h) => String(h || "").trim().toLowerCase() === key);
}

/** Drops unnamed rows and coerces prices to numbers. */
export function cleanOptions(options: unknown): ShipOption[] {
  if (!Array.isArray(options)) return [];
  return options
    .filter((o: any) => o && String(o.name || "").trim() !== "")
    .map((o: any) => ({
      name: String(o.name).trim(),
      price: Number(o.price) || 0,
      ...(o.dynamic ? { dynamic: true as const } : {}),
    }));
}

/**
 * The full list of rates to show, in display order. The dynamic (city) rate
 * leads when it is on — it is the one that follows what the customer typed —
 * followed by the manual and/or synced rates depending on the mode.
 */
export function resolveShippingOptions(
  cfg: ShippingConfig,
  city = "",
): ShipOption[] {
  const out: ShipOption[] = [];
  if (cfg.rulesEnabled) {
    out.push(
      dynamicRate(cfg.rules, cfg.fallbackPrice, cfg.fallbackLabel, city),
    );
  }
  if (cfg.mode === "manual" || cfg.mode === "both") {
    out.push(...cleanOptions(cfg.manual));
  }
  if (cfg.mode === "auto" || cfg.mode === "both") {
    out.push(
      ...cleanOptions(cfg.synced).filter(
        (o) => !isRateHidden(o.name, cfg.hiddenRates),
      ),
    );
  }
  // Same name twice (a synced rate that duplicates a manual one) would render
  // as two identical radios — keep the first.
  const seen = new Set<string>();
  return out.filter((o) => {
    const key = o.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Whether the order's subtotal has earned free shipping. 0 = never. */
export function qualifiesForFreeShipping(
  subtotal: number,
  threshold: number,
): boolean {
  const t = Number(threshold) || 0;
  return t > 0 && subtotal >= t;
}

/** Tolerant JSON parse for the columns that hold arrays. */
export function parseJsonArray<T>(raw: unknown, fallback: T[] = []): T[] {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}
