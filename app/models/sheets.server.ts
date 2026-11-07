// Google Sheets export.
//
// The merchant deploys a tiny Google Apps Script as a web app on their own
// sheet (the script is shown on the Connections page) and pastes its /exec URL
// here. Each COD order is POSTed to it as one JSON row. No Google OAuth, no
// Google credentials held by the app, and the data goes only to a sheet the
// merchant owns.
//
// The URL is restricted to Apps Script web apps so this can never be turned
// into a way to make the app's server call arbitrary hosts.

const APPS_SCRIPT_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;

export function isValidSheetsUrl(url: string): boolean {
  return APPS_SCRIPT_URL.test(url.trim());
}

export type SheetRow = {
  order: string;
  date: string;
  total: string;
  currency: string;
  items: string;
  customer: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  flags: string;
};

/** Builds the row from an orders/create payload (REST shape). */
export function rowFromOrder(payload: any, flags: string[]): SheetRow {
  const ship = payload?.shipping_address ?? payload?.billing_address ?? {};
  const customer = payload?.customer ?? {};
  const name =
    [ship.first_name, ship.last_name].filter(Boolean).join(" ") ||
    [customer.first_name, customer.last_name].filter(Boolean).join(" ");
  const items = (Array.isArray(payload?.line_items) ? payload.line_items : [])
    .map((li: any) => `${li?.title ?? "Item"}${li?.variant_title ? ` (${li.variant_title})` : ""} × ${li?.quantity ?? 1}`)
    .join(", ");

  return {
    order: String(payload?.name ?? ""),
    date: String(payload?.created_at ?? new Date().toISOString()),
    total: String(payload?.total_price ?? ""),
    currency: String(payload?.currency ?? ""),
    items,
    customer: name,
    phone: String(ship.phone || payload?.phone || customer.phone || ""),
    email: String(payload?.email || customer.email || ""),
    address: [ship.address1, ship.address2].filter(Boolean).join(", "),
    city: String(ship.city ?? ""),
    zip: String(ship.zip ?? ""),
    country: String(ship.country ?? ""),
    flags: flags.join(", "),
  };
}

/**
 * Sends one row. Never throws: a sheet that is down or misconfigured must not
 * fail the webhook (Shopify would retry, and give up after 5 s anyway).
 */
export async function sendToSheet(url: string, row: SheetRow, timeoutMs = 2500): Promise<boolean> {
  if (!isValidSheetsUrl(url)) return false;
  try {
    const response = await fetch(url.trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch (error: any) {
    console.error("COD: Google Sheets export failed:", error?.message || error);
    return false;
  }
}

/** The Apps Script the merchant pastes into Extensions → Apps Script. */
export const APPS_SCRIPT_SOURCE = `function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var cols = ["order","date","total","currency","items","customer","phone","email","address","city","zip","country","flags"];
  if (sheet.getLastRow() === 0) sheet.appendRow(cols);
  var row = JSON.parse(e.postData.contents);
  sheet.appendRow(cols.map(function (c) { return row[c] || ""; }));
  return ContentService.createTextOutput("ok");
}`;
