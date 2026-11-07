// Every piece of wording the storefront form shows, with its English default.
// The proxy builds the final strings as: these defaults → the merchant's
// English wording (Form settings) → the translation for the visitor's
// language (Templates & languages page). Client-safe.

export type TextKey =
  | "heading"
  | "button"
  | "buttonSub"
  | "submit"
  | "trust"
  | "qty"
  | "addTitle"
  | "note"
  | "subtotal"
  | "savings"
  | "save"
  | "taking"
  | "error"
  | "choose"
  | "hurry"
  | "added"
  | "special"
  | "dsTitle"
  | "dsYes"
  | "dsNo"
  | "dsApplied"
  | "recTitle";

export const TEXT_FIELDS: { key: TextKey; label: string; def: string; hint?: string }[] = [
  { key: "heading", label: "Form heading", def: "Order — Cash on Delivery" },
  { key: "button", label: "Product page button", def: "Cash on Delivery" },
  { key: "buttonSub", label: "Button subtitle", def: "" },
  { key: "submit", label: "Continue button", def: "Continue to checkout" },
  { key: "trust", label: "Trust line under the button", def: "" },
  { key: "qty", label: "Quantity label", def: "Quantity" },
  { key: "addTitle", label: "Add-ons heading", def: "Add to your order" },
  { key: "note", label: "Checkout note", def: "Shipping, taxes and payment are completed at checkout." },
  { key: "subtotal", label: "Subtotal label", def: "Items subtotal" },
  { key: "savings", label: "Savings label", def: "You save" },
  { key: "save", label: "Tier saving badge", def: "Save {p}%", hint: "{p} = percent" },
  { key: "taking", label: "Redirecting message", def: "Taking you to checkout…" },
  { key: "error", label: "Error message", def: "We couldn't start your checkout. Please try again." },
  { key: "choose", label: "Choose option message", def: "Please choose a product option first." },
  { key: "hurry", label: "Countdown prefix", def: "Hurry! Sale ends in" },
  { key: "added", label: "Generic add-on name", def: "Added item" },
  { key: "special", label: "Generic offer name", def: "Special offer" },
  { key: "dsTitle", label: "Downsell heading", def: "Wait! Take {p}% off your order", hint: "{p} = percent" },
  { key: "dsYes", label: "Downsell accept", def: "Yes, apply my discount" },
  { key: "dsNo", label: "Downsell decline", def: "No thanks" },
  { key: "dsApplied", label: "Downsell applied note", def: "{p}% off will be applied at checkout", hint: "{p} = percent" },
  { key: "recTitle", label: "Recommended add-on heading", def: "You may also like" },
];

export const DEFAULT_TEXT: Record<TextKey, string> = Object.fromEntries(
  TEXT_FIELDS.map((f) => [f.key, f.def]),
) as Record<TextKey, string>;

// Storefront languages a merchant can translate into. Matched against the
// visitor's Shopify locale ("fr", "pt-BR" → "pt-BR" then "pt").
export const LANGUAGES: { code: string; name: string }[] = [
  { code: "ar", name: "العربية (Arabic)" },
  { code: "bn", name: "বাংলা (Bangla)" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "hi", name: "हिन्दी (Hindi)" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "it", name: "Italiano" },
  { code: "ms", name: "Bahasa Melayu" },
  { code: "nl", name: "Nederlands" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "pt", name: "Português" },
  { code: "ro", name: "Română" },
  { code: "ru", name: "Русский" },
  { code: "tr", name: "Türkçe" },
  { code: "ur", name: "اردو (Urdu)" },
];

export type Translations = Record<string, Partial<Record<TextKey, string>>>;

export function parseTranslations(raw: string | null | undefined): Translations {
  try {
    const value = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Translations = {};
    for (const [code, strings] of Object.entries(value)) {
      if (!LANGUAGES.some((l) => l.code === code) || !strings || typeof strings !== "object") continue;
      out[code] = {};
      for (const field of TEXT_FIELDS) {
        const v = (strings as any)[field.key];
        if (typeof v === "string" && v.trim()) out[code][field.key] = v.slice(0, 200);
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Picks the visitor's translation: exact code, then the base language. */
export function translationFor(all: Translations, locale: string | null | undefined) {
  if (!locale) return {};
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === locale.toLowerCase());
  if (exact && all[exact.code]) return all[exact.code];
  const base = locale.split("-")[0].toLowerCase();
  return all[base] ?? {};
}

/** Right-to-left scripts flip the form's direction. */
export function isRtl(locale: string | null | undefined): boolean {
  return ["ar", "ur", "he", "fa"].includes(String(locale || "").split("-")[0].toLowerCase());
}
