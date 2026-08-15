// Renders an amount with the shop's own money_format, so admin pages match the
// storefront exactly.
//
// Mirrors the money() formatter in extensions/cod-form/assets/cod-form.js.

/** Group digits: 1234567.8 -> "1,234,567.80" with the requested separators. */
function group(n: number, decimals: number, thousands: string, decimal: string) {
  const parts = Math.abs(n).toFixed(decimals).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return (n < 0 ? "-" : "") + (decimals ? parts.join(decimal) : parts[0]);
}

/** `symbol` overrides the shop format when the merchant set one in the app. */
export function formatMoney(
  amount: number,
  moneyFormat: string,
  symbol: string,
): string {
  if (symbol) return symbol + group(amount, 2, ",", ".");
  if (!moneyFormat) return "$" + group(amount, 2, ",", ".");
  return moneyFormat.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, token: string) => {
    switch (token) {
      case "amount_no_decimals": return group(amount, 0, ",", ".");
      case "amount_with_comma_separator": return group(amount, 2, ".", ",");
      case "amount_no_decimals_with_comma_separator": return group(amount, 0, ".", ",");
      case "amount_with_apostrophe_separator": return group(amount, 2, "'", ".");
      case "amount_no_decimals_with_space_separator": return group(amount, 0, " ", ",");
      case "amount_with_space_separator": return group(amount, 2, " ", ",");
      default: return group(amount, 2, ",", ".");
    }
  });
}

/**
 * The shop's money_format, for admin loaders. Falls back to a plain "$" so a
 * failed query never breaks the page.
 */
export async function getMoneyFormat(admin: {
  graphql: (q: string) => Promise<Response>;
}): Promise<string> {
  // Shopify's money_format placeholder syntax, not a JS template literal.
  // eslint-disable-next-line no-template-curly-in-string
  const fallback = "${{amount}}";
  try {
    const r = await admin.graphql(
      `#graphql
      query ShopMoneyFormat { shop { currencyFormats { moneyFormat } } }`,
    );
    const j: any = await r.json();
    return j?.data?.shop?.currencyFormats?.moneyFormat || fallback;
  } catch {
    return fallback;
  }
}
