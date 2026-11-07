// Client-safe offer constants shared by admin pages and server models.
export const MAX_TIERS = 4;

// Upsell presets on the Upsells page. Discounts (when set) are Shopify
// buy-X-get-Y discounts, so every preset is just an add-on product with an
// optional price cut that checkout applies.
export const UPSELL_TYPES: { value: string; label: string; hint: string }[] = [
  { value: "bump", label: "Order bump", hint: "A tickable add-on in the form." },
  { value: "bundle", label: "Bundle (frequently bought together)", hint: "Pairs with the chosen products, usually at a discount." },
  { value: "free_gift", label: "Free gift", hint: "100% off when bought with the chosen products." },
  { value: "protection", label: "Shipping protection", hint: "Your own protection product as an add-on." },
  { value: "gift_wrap", label: "Gift wrap", hint: "Your own gift-wrap product as an add-on." },
  { value: "cross_sell", label: "Cross-sell", hint: "A related product suggestion." },
];
