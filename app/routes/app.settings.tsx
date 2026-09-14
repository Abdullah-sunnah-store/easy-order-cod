import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineGrid,
  InlineStack,
  TextField,
  Checkbox,
  Select,
  RangeSlider,
  Tabs,
  Text,
  Button,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getCodSettings, updateCodSettings } from "../models/codSettings.server";
import { syncShopifyRates } from "../models/shippingSync.server";
import { formatMoney, getMoneyFormat } from "../lib/money";
import type { ShipMode, ShipOption, ShipRule } from "../lib/shipping";
import {
  DEFAULT_FALLBACK_LABEL,
  isRateHidden,
  parseJsonArray,
  qualifiesForFreeShipping,
  resolveShippingOptions,
} from "../lib/shipping";

// ---- Builder appearance config (stored as JSON in CodSettings.builderConfig) ----
// Everything here is forwarded verbatim to the storefront by proxy.settings.tsx
// and applied by extensions/cod-form/assets/cod-form.js.
type Builder = {
  formType: "popup" | "embedded";

  // Buy button (the one on the product page)
  buttonText: string;
  buttonSubtitle: string;
  buttonBg: string;
  buttonTextColor: string;
  buttonHoverBg: string;
  buttonTextSize: number;
  buttonBold: boolean;
  buttonRadius: number;
  buttonPaddingY: number;
  buttonFullWidth: boolean;
  buttonIcon: "none" | "cart" | "bolt" | "truck" | "shield";
  buttonAnimation: "none" | "pulse" | "shine";
  stickyMobile: boolean;

  // Modal shell
  accentColor: string;
  modalRadius: number;
  modalWidth: number;
  modalBg: string;
  modalTextColor: string;
  overlayOpacity: number;
  overlayBlur: number;
  headingAlign: "left" | "center";
  headingSize: number;

  // Form fields
  fieldLayout: "inline" | "stacked";
  inputRadius: number;
  inputBorderColor: string;
  inputBg: string;
  inputPaddingY: number;
  showRequiredMarks: boolean;

  // Submit button (inside the modal)
  submitText: string;
  submitBg: string;
  submitTextColor: string;
  submitShowTotal: boolean;

  // Typography
  fontFamily: "theme" | "system" | "serif" | "rounded";
  baseFontSize: number;

  // Summary & trust
  showProductImage: boolean;
  trustBadge: string;
};

const DEFAULT_BUILDER: Builder = {
  formType: "popup",

  buttonText: "Cash on Delivery",
  buttonSubtitle: "",
  buttonBg: "#111111",
  buttonTextColor: "#ffffff",
  buttonHoverBg: "#333333",
  buttonTextSize: 16,
  buttonBold: true,
  buttonRadius: 999,
  buttonPaddingY: 14,
  buttonFullWidth: true,
  buttonIcon: "none",
  buttonAnimation: "none",
  stickyMobile: false,

  accentColor: "#e02424",
  modalRadius: 14,
  modalWidth: 460,
  modalBg: "#ffffff",
  modalTextColor: "#1a1a1a",
  overlayOpacity: 45,
  overlayBlur: 0,
  headingAlign: "center",
  headingSize: 19,

  fieldLayout: "inline",
  inputRadius: 8,
  inputBorderColor: "#d0d0d0",
  inputBg: "#ffffff",
  inputPaddingY: 10,
  showRequiredMarks: true,

  submitText: "Order Now (Cash on Delivery)",
  submitBg: "#111111",
  submitTextColor: "#ffffff",
  submitShowTotal: true,

  fontFamily: "theme",
  baseFontSize: 16,

  showProductImage: true,
  trustBadge: "",
};

const FONT_STACKS: Record<Builder["fontFamily"], string> = {
  theme: "inherit",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif",
};

// Same glyphs the storefront script injects, so the preview matches 1:1.
const ICONS: Record<Exclude<Builder["buttonIcon"], "none">, string> = {
  cart: "M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM3 3h2l2.7 11.4A2 2 0 0 0 9.6 16h7.9a2 2 0 0 0 2-1.6L21 7H6",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
  truck: "M3 6h11v9H3V6Zm11 3h4l3 3v3h-7V9ZM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  shield: "M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4Z",
};

export type { ShipOption, ShipRule } from "../lib/shipping";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const s = await getCodSettings(session.shop);
  let builder: Builder = DEFAULT_BUILDER;
  try {
    builder = { ...DEFAULT_BUILDER, ...JSON.parse(s.builderConfig || "{}") };
  } catch {
    /* keep defaults */
  }
  const shipping = parseJsonArray<ShipOption>(s.shippingOptions);
  const synced = parseJsonArray<ShipOption>(s.shippingSynced);
  const hiddenRates = parseJsonArray<string>(s.shippingHiddenRates);
  const rules = parseJsonArray<ShipRule>(s.shippingRules);

  // The shop's own money format, so the preview renders totals exactly as the
  // storefront will.
  const moneyFormat = await getMoneyFormat(admin);

  return {
    settings: s,
    builder,
    shipping,
    synced,
    hiddenRates,
    rules,
    syncedAt: s.shippingSyncedAt ? s.shippingSyncedAt.toISOString() : null,
    moneyFormat,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  // "Sync now" — pull the shop's own shipping zones instead of saving the form.
  if (form.get("intent") === "sync") {
    try {
      const { rates, syncedAt } = await syncShopifyRates(admin, session.shop);
      return {
        ok: true as const,
        synced: rates,
        syncedAt: syncedAt.toISOString(),
      };
    } catch (e: any) {
      return {
        ok: false as const,
        // Most often a missing read_shipping grant on an install that predates it.
        syncError:
          String(e?.message || "").includes("access denied") ||
          String(e?.message || "").includes("scope")
            ? "This app needs permission to read your shipping settings. Reinstall or reopen the app to approve it, then sync again."
            : "Couldn't read your Shopify shipping rates. Please try again.",
      };
    }
  }

  const asBool = (n: string) => form.get(n) === "true";
  const asNum = (n: string) => Math.max(0, Number(form.get(n)) || 0);
  await updateCodSettings(session.shop, {
    enabled: asBool("enabled"),
    headingText: String(form.get("headingText") || ""),
    successMessage: String(form.get("successMessage") || ""),
    orderTag: String(form.get("orderTag") || "COD"),
    showName: asBool("showName"),
    showEmail: asBool("showEmail"),
    showPhone: asBool("showPhone"),
    showAddress: asBool("showAddress"),
    showCity: asBool("showCity"),
    showQuantity: asBool("showQuantity"),
    showNotes: asBool("showNotes"),
    dialCodes: String(form.get("dialCodes") || ""),
    builderConfig: String(form.get("builderConfig") || "{}"),
    // Moved here from the theme block's schema — the theme editor no longer
    // exposes any of these.
    currencySymbol: String(form.get("currencySymbol") || ""),
    countdownMinutes: Math.max(
      0,
      parseInt(String(form.get("countdownMinutes") || "0"), 10) || 0,
    ),
    shippingOptions: String(form.get("shippingOptions") || "[]"),
    shippingMode: String(form.get("shippingMode") || "manual"),
    shippingAutoSync: asBool("shippingAutoSync"),
    shippingHiddenRates: String(form.get("shippingHiddenRates") || "[]"),
    shippingRulesEnabled: asBool("shippingRulesEnabled"),
    shippingRules: String(form.get("shippingRules") || "[]"),
    shippingFallbackPrice: asNum("shippingFallbackPrice"),
    shippingFallbackLabel: String(
      form.get("shippingFallbackLabel") || DEFAULT_FALLBACK_LABEL,
    ),
    // Also editable on Fraud & delivery — same column, whichever page saves last.
    freeShippingThreshold: asNum("freeShippingThreshold"),
  });
  return { ok: true as const };
};

/* Small color control: swatch + hex input */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
      <InlineStack gap="200" blockAlign="center">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 34, height: 34, border: "1px solid #ccc", borderRadius: 8, padding: 0, background: "none", cursor: "pointer" }}
          aria-label={label}
        />
        <div style={{ flex: 1 }}>
          <TextField label="" labelHidden autoComplete="off" value={value} onChange={onChange} />
        </div>
      </InlineStack>
    </BlockStack>
  );
}

/* Section heading used inside each tab panel */
function SectionTitle({ title, help }: { title: string; help?: string }) {
  return (
    <BlockStack gap="050">
      <Text as="h3" variant="headingSm">{title}</Text>
      {help && <Text as="p" variant="bodySm" tone="subdued">{help}</Text>}
    </BlockStack>
  );
}

export default function FormBuilder() {
  const {
    settings,
    builder,
    shipping,
    synced,
    hiddenRates,
    rules,
    syncedAt,
    moneyFormat,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  // Separate fetcher so a rate sync doesn't fire the "Saved" toast.
  const syncFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [ship, setShip] = useState<ShipOption[]>(shipping);
  const [shipMode, setShipMode] = useState<ShipMode>(
    (settings.shippingMode as ShipMode) || "manual",
  );
  const [autoSync, setAutoSync] = useState(settings.shippingAutoSync);
  const [syncedRates, setSyncedRates] = useState<ShipOption[]>(synced);
  const [hidden, setHidden] = useState<string[]>(hiddenRates);
  const [syncedStamp, setSyncedStamp] = useState<string | null>(syncedAt);
  const [rulesOn, setRulesOn] = useState(settings.shippingRulesEnabled);
  const [shipRules, setShipRules] = useState<ShipRule[]>(rules);
  const [fallback, setFallback] = useState({
    price: settings.shippingFallbackPrice,
    label: settings.shippingFallbackLabel || DEFAULT_FALLBACK_LABEL,
  });
  const [freeOver, setFreeOver] = useState(settings.freeShippingThreshold);
  // Sample city used only by the preview, to show what a customer would see.
  const [previewCity, setPreviewCity] = useState("");
  const [content, setContent] = useState({
    enabled: settings.enabled,
    headingText: settings.headingText,
    successMessage: settings.successMessage,
    orderTag: settings.orderTag,
    currencySymbol: settings.currencySymbol,
    countdownMinutes: settings.countdownMinutes,
    showName: settings.showName,
    showEmail: settings.showEmail,
    showPhone: settings.showPhone,
    showAddress: settings.showAddress,
    showCity: settings.showCity,
    showQuantity: settings.showQuantity,
    showNotes: settings.showNotes,
    dialCodes: (settings as any).dialCodes ?? "",
  });
  const [b, setB] = useState<Builder>(builder);
  const [tab, setTab] = useState(0);

  const saving =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const syncing = ["loading", "submitting"].includes(syncFetcher.state);

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Saved");
  }, [fetcher.data, shopify]);

  // Fold a finished sync into local state so the list updates without a reload.
  useEffect(() => {
    const d = syncFetcher.data;
    if (!d) return;
    if (d.ok && "synced" in d && d.synced) {
      setSyncedRates(d.synced);
      setSyncedStamp(d.syncedAt ?? null);
      shopify.toast.show(
        d.synced.length
          ? `Synced ${d.synced.length} rate${d.synced.length === 1 ? "" : "s"} from Shopify`
          : "No flat shipping rates found in your Shopify shipping zones",
      );
    } else if (!d.ok && "syncError" in d && d.syncError) {
      shopify.toast.show(d.syncError, { isError: true });
    }
  }, [syncFetcher.data, shopify]);

  const setC = (k: keyof typeof content) => (v: string | boolean) =>
    setContent((p) => ({ ...p, [k]: v }));
  const setBuild = (k: keyof Builder) => (v: any) => setB((p) => ({ ...p, [k]: v }));

  const save = () => {
    const fd = new FormData();
    Object.entries(content).forEach(([k, v]) => fd.append(k, String(v)));
    fd.append("builderConfig", JSON.stringify(b));
    // Drop unnamed rows so a blank line never renders as a shipping choice.
    fd.append(
      "shippingOptions",
      JSON.stringify(
        ship
          .filter((o) => o.name.trim() !== "")
          .map((o) => ({ name: o.name.trim(), price: Number(o.price) || 0 })),
      ),
    );
    fd.append("shippingMode", shipMode);
    fd.append("shippingAutoSync", String(autoSync));
    fd.append("shippingHiddenRates", JSON.stringify(hidden));
    fd.append("shippingRulesEnabled", String(rulesOn));
    // A rule with no cities can never match — drop it rather than store a row
    // that silently does nothing.
    fd.append(
      "shippingRules",
      JSON.stringify(
        shipRules
          .filter((r) => r.cities.trim() !== "")
          .map((r) => ({
            cities: r.cities.trim(),
            price: Number(r.price) || 0,
            label: r.label.trim() || DEFAULT_FALLBACK_LABEL,
          })),
      ),
    );
    fd.append("shippingFallbackPrice", String(Number(fallback.price) || 0));
    fd.append("shippingFallbackLabel", fallback.label.trim() || DEFAULT_FALLBACK_LABEL);
    fd.append("freeShippingThreshold", String(Number(freeOver) || 0));
    fetcher.submit(fd, { method: "POST" });
  };

  const syncNow = () =>
    syncFetcher.submit({ intent: "sync" }, { method: "POST" });

  const setShipAt = (i: number, patch: Partial<ShipOption>) =>
    setShip((prev) => prev.map((o, n) => (n === i ? { ...o, ...patch } : o)));

  // Ticked = shown, so switching a rate on removes it from the hidden list.
  const toggleRate = (name: string, show: boolean) =>
    setHidden((prev) => {
      const without = prev.filter(
        (h) => h.trim().toLowerCase() !== name.trim().toLowerCase(),
      );
      return show ? without : [...without, name];
    });

  const setRuleAt = (i: number, patch: Partial<ShipRule>) =>
    setShipRules((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  // What a customer would actually see, given the mode, the rules and the city
  // typed into the preview box.
  const previewOptions = resolveShippingOptions(
    {
      mode: shipMode,
      manual: ship,
      synced: syncedRates,
      hiddenRates: hidden,
      rulesEnabled: rulesOn,
      rules: shipRules,
      fallbackPrice: Number(fallback.price) || 0,
      fallbackLabel: fallback.label,
      freeShippingThreshold: Number(freeOver) || 0,
    },
    previewCity,
  );

  const reset = () => setB(DEFAULT_BUILDER);

  const tabs = [
    { id: "layout", content: "Layout" },
    { id: "button", content: "Buy button" },
    { id: "modal", content: "Modal" },
    { id: "fields", content: "Fields" },
    { id: "shipping", content: "Shipping" },
    { id: "content", content: "Content" },
  ];

  return (
    <Page>
      <TitleBar title="Form builder">
        <button variant="primary" onClick={save}>Save</button>
        <button onClick={reset}>Reset to defaults</button>
      </TitleBar>
      <InlineGrid columns={{ xs: 1, lg: ["twoThirds", "oneThird"] }} gap="500">
        {/* LEFT — controls */}
        <BlockStack gap="400">
          <Card padding="0">
            <Tabs tabs={tabs} selected={tab} onSelect={setTab} fitted>
              <Box padding="400">
                {tab === 0 && (
                  <BlockStack gap="400">
                    <SectionTitle
                      title="Form type"
                      help="Pop-up opens when the customer clicks the button. Embedded shows the form inline on the product page — no click needed."
                    />
                    <InlineStack gap="300">
                      {(["popup", "embedded"] as const).map((t) => (
                        <Button key={t} pressed={b.formType === t} onClick={() => setBuild("formType")(t)}>
                          {t === "popup" ? "Pop-up form" : "Embedded form"}
                        </Button>
                      ))}
                    </InlineStack>

                    <Divider />
                    <SectionTitle title="Typography" help="Applies to the whole form on the storefront." />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <Select
                        label="Font family"
                        options={[
                          { label: "Use theme font", value: "theme" },
                          { label: "System sans-serif", value: "system" },
                          { label: "Serif", value: "serif" },
                          { label: "Rounded", value: "rounded" },
                        ]}
                        value={b.fontFamily}
                        onChange={setBuild("fontFamily")}
                      />
                      <div>
                        <RangeSlider
                          label={`Base font size — ${b.baseFontSize}px`}
                          min={12}
                          max={20}
                          value={b.baseFontSize}
                          onChange={(v) => setBuild("baseFontSize")(v as number)}
                          output
                        />
                      </div>
                    </InlineGrid>

                    <Divider />
                    <SectionTitle title="Mobile" />
                    <Checkbox
                      label="Sticky button on mobile"
                      helpText="Pins the buy button to the bottom of the screen on phones so it's always reachable."
                      checked={b.stickyMobile}
                      onChange={setBuild("stickyMobile")}
                    />
                  </BlockStack>
                )}

                {tab === 1 && (
                  <BlockStack gap="400">
                    <SectionTitle title="Text" />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <TextField label="Button text" autoComplete="off" value={b.buttonText} onChange={setBuild("buttonText")} />
                      <TextField label="Button subtitle" autoComplete="off" value={b.buttonSubtitle} onChange={setBuild("buttonSubtitle")} placeholder="Optional" />
                    </InlineGrid>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <Select
                        label="Icon"
                        options={[
                          { label: "None", value: "none" },
                          { label: "Shopping cart", value: "cart" },
                          { label: "Lightning bolt", value: "bolt" },
                          { label: "Delivery truck", value: "truck" },
                          { label: "Shield", value: "shield" },
                        ]}
                        value={b.buttonIcon}
                        onChange={setBuild("buttonIcon")}
                      />
                      <Select
                        label="Animation"
                        options={[
                          { label: "None", value: "none" },
                          { label: "Pulse", value: "pulse" },
                          { label: "Shine sweep", value: "shine" },
                        ]}
                        value={b.buttonAnimation}
                        onChange={setBuild("buttonAnimation")}
                      />
                    </InlineGrid>

                    <Divider />
                    <SectionTitle title="Colors" />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <ColorField label="Background color" value={b.buttonBg} onChange={setBuild("buttonBg")} />
                      <ColorField label="Text color" value={b.buttonTextColor} onChange={setBuild("buttonTextColor")} />
                      <ColorField label="Hover background" value={b.buttonHoverBg} onChange={setBuild("buttonHoverBg")} />
                    </InlineGrid>

                    <Divider />
                    <SectionTitle title="Size & shape" />
                    <RangeSlider label={`Text size — ${b.buttonTextSize}px`} min={12} max={24} value={b.buttonTextSize} onChange={(v) => setBuild("buttonTextSize")(v as number)} output />
                    <RangeSlider label={`Vertical padding — ${b.buttonPaddingY}px`} min={6} max={24} value={b.buttonPaddingY} onChange={(v) => setBuild("buttonPaddingY")(v as number)} output />
                    <RangeSlider label={`Corner radius — ${b.buttonRadius}px`} min={0} max={999} step={1} value={b.buttonRadius} onChange={(v) => setBuild("buttonRadius")(v as number)} output />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="200">
                      <Checkbox label="Bold text" checked={b.buttonBold} onChange={setBuild("buttonBold")} />
                      <Checkbox label="Full width" checked={b.buttonFullWidth} onChange={setBuild("buttonFullWidth")} />
                    </InlineGrid>
                  </BlockStack>
                )}

                {tab === 2 && (
                  <BlockStack gap="400">
                    <SectionTitle title="Colors" />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <ColorField label="Accent (required *, timer, radios)" value={b.accentColor} onChange={setBuild("accentColor")} />
                      <ColorField label="Modal background" value={b.modalBg} onChange={setBuild("modalBg")} />
                      <ColorField label="Modal text color" value={b.modalTextColor} onChange={setBuild("modalTextColor")} />
                    </InlineGrid>

                    <Divider />
                    <SectionTitle title="Shape & size" />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <div>
                        <RangeSlider label={`Corner radius — ${b.modalRadius}px`} min={0} max={28} value={b.modalRadius} onChange={(v) => setBuild("modalRadius")(v as number)} output />
                      </div>
                      <div>
                        <RangeSlider label={`Width — ${b.modalWidth}px`} min={340} max={640} step={10} value={b.modalWidth} onChange={(v) => setBuild("modalWidth")(v as number)} output />
                      </div>
                    </InlineGrid>

                    <Divider />
                    <SectionTitle title="Heading" />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <Select
                        label="Alignment"
                        options={[
                          { label: "Centered", value: "center" },
                          { label: "Left", value: "left" },
                        ]}
                        value={b.headingAlign}
                        onChange={setBuild("headingAlign")}
                      />
                      <div>
                        <RangeSlider label={`Heading size — ${b.headingSize}px`} min={14} max={28} value={b.headingSize} onChange={(v) => setBuild("headingSize")(v as number)} output />
                      </div>
                    </InlineGrid>

                    <Divider />
                    <SectionTitle title="Backdrop" help="Only applies to the pop-up form." />
                    <RangeSlider label={`Dimming — ${b.overlayOpacity}%`} min={0} max={90} value={b.overlayOpacity} onChange={(v) => setBuild("overlayOpacity")(v as number)} output />
                    <RangeSlider label={`Blur — ${b.overlayBlur}px`} min={0} max={12} value={b.overlayBlur} onChange={(v) => setBuild("overlayBlur")(v as number)} output />
                  </BlockStack>
                )}

                {tab === 3 && (
                  <BlockStack gap="400">
                    <SectionTitle title="Visible fields" help="Name, phone and address are always required to create the order." />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="200">
                      <Checkbox label="Full name" checked={content.showName} onChange={setC("showName")} />
                      <Checkbox label="Email" checked={content.showEmail} onChange={setC("showEmail")} />
                      <Checkbox label="Phone" checked={content.showPhone} onChange={setC("showPhone")} />
                      <Checkbox label="Address" checked={content.showAddress} onChange={setC("showAddress")} />
                      <Checkbox label="City" checked={content.showCity} onChange={setC("showCity")} />
                      <Checkbox label="Quantity" checked={content.showQuantity} onChange={setC("showQuantity")} />
                      <Checkbox label="Order notes" checked={content.showNotes} onChange={setC("showNotes")} />
                    </InlineGrid>

                    {content.showPhone && (
                      <TextField
                        label="Phone country codes"
                        autoComplete="off"
                        value={content.dialCodes}
                        onChange={setC("dialCodes")}
                        helpText="Shown as a dropdown beside the phone field. Comma-separated; the first one is preselected. Customers can type a local number like 01709504746 and it is sent as +8801709504746. Leave empty to hide the dropdown."
                      />
                    )}

                    <Divider />
                    <SectionTitle title="Field style" />
                    <Select
                      label="Label layout"
                      options={[
                        { label: "Label beside input", value: "inline" },
                        { label: "Label above input", value: "stacked" },
                      ]}
                      value={b.fieldLayout}
                      onChange={setBuild("fieldLayout")}
                    />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <ColorField label="Input border color" value={b.inputBorderColor} onChange={setBuild("inputBorderColor")} />
                      <ColorField label="Input background" value={b.inputBg} onChange={setBuild("inputBg")} />
                    </InlineGrid>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <div>
                        <RangeSlider label={`Input radius — ${b.inputRadius}px`} min={0} max={20} value={b.inputRadius} onChange={(v) => setBuild("inputRadius")(v as number)} output />
                      </div>
                      <div>
                        <RangeSlider label={`Input height — ${b.inputPaddingY}px`} min={6} max={18} value={b.inputPaddingY} onChange={(v) => setBuild("inputPaddingY")(v as number)} output />
                      </div>
                    </InlineGrid>
                    <Checkbox label="Show * on required fields" checked={b.showRequiredMarks} onChange={setBuild("showRequiredMarks")} />

                    <Divider />
                    <SectionTitle title="Submit button" help="The confirm button inside the form." />
                    <TextField label="Submit button text" autoComplete="off" value={b.submitText} onChange={setBuild("submitText")} />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <ColorField label="Background" value={b.submitBg} onChange={setBuild("submitBg")} />
                      <ColorField label="Text color" value={b.submitTextColor} onChange={setBuild("submitTextColor")} />
                    </InlineGrid>
                    <Checkbox label="Show order total on the button" checked={b.submitShowTotal} onChange={setBuild("submitShowTotal")} />
                  </BlockStack>
                )}

                {tab === 4 && (
                  <BlockStack gap="400">
                    <SectionTitle
                      title="Where rates come from"
                      help="Auto-sync reads the rates you already set up in Shopify → Settings → Shipping and delivery. Custom rates are the ones you type below. Pick “Both” to offer them together."
                    />
                    <InlineStack gap="300">
                      {(
                        [
                          ["manual", "Custom rates"],
                          ["auto", "Auto-sync from Shopify"],
                          ["both", "Both"],
                        ] as const
                      ).map(([mode, label]) => (
                        <Button
                          key={mode}
                          pressed={shipMode === mode}
                          onClick={() => setShipMode(mode)}
                        >
                          {label}
                        </Button>
                      ))}
                    </InlineStack>

                    {(shipMode === "auto" || shipMode === "both") && (
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <BlockStack gap="300">
                          <InlineStack gap="300" blockAlign="center">
                            <Button onClick={syncNow} loading={syncing}>
                              Sync now
                            </Button>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {syncedStamp
                                ? `Last synced ${new Date(syncedStamp).toLocaleString()}`
                                : "Not synced yet"}
                            </Text>
                          </InlineStack>

                          {syncedRates.length === 0 ? (
                            <Text as="p" variant="bodySm" tone="subdued">
                              No synced rates yet. Press “Sync now” to pull the flat
                              rates from your Shopify shipping zones. Carrier-calculated
                              rates can't be synced — they need a real checkout to price.
                            </Text>
                          ) : (
                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm" tone="subdued">
                                Untick a rate to keep it off the COD form — useful
                                for rates you don't deliver cash on delivery.
                              </Text>
                              {syncedRates.map((r, i) => {
                                const shown = !isRateHidden(r.name, hidden);
                                return (
                                  <InlineStack
                                    key={`${r.name}-${i}`}
                                    align="space-between"
                                    blockAlign="center"
                                    wrap={false}
                                  >
                                    <Checkbox
                                      label={r.name}
                                      checked={shown}
                                      onChange={(on) => toggleRate(r.name, on)}
                                    />
                                    <Text
                                      as="span"
                                      variant="bodySm"
                                      fontWeight="semibold"
                                      tone={shown ? undefined : "subdued"}
                                    >
                                      {formatMoney(
                                        Number(r.price) || 0,
                                        moneyFormat,
                                        content.currencySymbol,
                                      )}
                                    </Text>
                                  </InlineStack>
                                );
                              })}
                            </BlockStack>
                          )}

                          <Checkbox
                            label="Keep rates up to date automatically"
                            helpText="Re-reads your Shopify shipping zones while the storefront form loads (cached for 10 minutes), so a rate you change in Shopify shows up without pressing Sync."
                            checked={autoSync}
                            onChange={setAutoSync}
                          />
                        </BlockStack>
                      </Box>
                    )}

                    {(shipMode === "manual" || shipMode === "both") && (
                      <>
                        <Divider />
                        <SectionTitle
                          title="Custom rates"
                          help="Shown as selectable rates on the form. Leave empty to hide the section entirely."
                        />
                        {ship.length === 0 && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            No custom rates yet.
                          </Text>
                        )}
                        {ship.map((o, i) => (
                          <InlineStack key={i} gap="300" blockAlign="end" wrap={false}>
                            <div style={{ flex: 2 }}>
                              <TextField
                                label={`Option ${i + 1} name`}
                                autoComplete="off"
                                value={o.name}
                                onChange={(v) => setShipAt(i, { name: v })}
                                placeholder="e.g. Inside city"
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="Price"
                                type="number"
                                autoComplete="off"
                                value={String(o.price)}
                                onChange={(v) => setShipAt(i, { price: Number(v) || 0 })}
                              />
                            </div>
                            <Button
                              tone="critical"
                              variant="tertiary"
                              onClick={() => setShip((p) => p.filter((_, n) => n !== i))}
                            >
                              Remove
                            </Button>
                          </InlineStack>
                        ))}
                        <div>
                          <Button onClick={() => setShip((p) => [...p, { name: "", price: 0 }])}>
                            Add shipping option
                          </Button>
                        </div>
                      </>
                    )}

                    <Divider />
                    <SectionTitle
                      title="Dynamic rate by city"
                      help="Prices the delivery from the city the customer types. The first matching rule wins; anything unmatched pays the fallback. The rate updates live as they type."
                    />
                    <Checkbox
                      label="Charge shipping based on the customer's city"
                      checked={rulesOn}
                      onChange={setRulesOn}
                      helpText={
                        content.showCity
                          ? undefined
                          : "The City field is switched off in the Fields tab — turn it on, or every customer pays the fallback rate."
                      }
                    />
                    {rulesOn && (
                      <BlockStack gap="300">
                        {shipRules.map((r, i) => (
                          <InlineStack key={i} gap="300" blockAlign="end" wrap={false}>
                            <div style={{ flex: 3 }}>
                              <TextField
                                label={`Rule ${i + 1} — cities`}
                                autoComplete="off"
                                value={r.cities}
                                onChange={(v) => setRuleAt(i, { cities: v })}
                                placeholder="Dhaka, Gazipur, Narayanganj"
                                helpText={i === 0 ? "Comma-separated. Matching ignores case and punctuation." : undefined}
                              />
                            </div>
                            <div style={{ flex: 2 }}>
                              <TextField
                                label="Label"
                                autoComplete="off"
                                value={r.label}
                                onChange={(v) => setRuleAt(i, { label: v })}
                                placeholder="Inside city"
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="Price"
                                type="number"
                                autoComplete="off"
                                value={String(r.price)}
                                onChange={(v) => setRuleAt(i, { price: Number(v) || 0 })}
                              />
                            </div>
                            <Button
                              tone="critical"
                              variant="tertiary"
                              onClick={() => setShipRules((p) => p.filter((_, n) => n !== i))}
                            >
                              Remove
                            </Button>
                          </InlineStack>
                        ))}
                        <div>
                          <Button
                            onClick={() =>
                              setShipRules((p) => [
                                ...p,
                                { cities: "", price: 0, label: "" },
                              ])
                            }
                          >
                            Add city rule
                          </Button>
                        </div>
                        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                          <TextField
                            label="Fallback label"
                            autoComplete="off"
                            value={fallback.label}
                            onChange={(v) => setFallback((p) => ({ ...p, label: v }))}
                            placeholder={DEFAULT_FALLBACK_LABEL}
                            helpText="Used when the typed city matches no rule."
                          />
                          <TextField
                            label="Fallback price"
                            type="number"
                            autoComplete="off"
                            value={String(fallback.price)}
                            onChange={(v) => setFallback((p) => ({ ...p, price: Number(v) || 0 }))}
                          />
                        </InlineGrid>
                      </BlockStack>
                    )}

                    <Divider />
                    <SectionTitle title="Free shipping" />
                    <TextField
                      label="Free shipping over"
                      type="number"
                      autoComplete="off"
                      value={String(freeOver)}
                      onChange={(v) => setFreeOver(Number(v) || 0)}
                      helpText="Once the order subtotal reaches this, shipping is charged as 0 whichever rate is picked. 0 turns it off. Also editable on the Fraud & delivery page."
                    />

                    <Divider />
                    <SectionTitle title="Currency & urgency" />
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <TextField
                        label="Currency symbol"
                        autoComplete="off"
                        value={content.currencySymbol}
                        onChange={setC("currencySymbol")}
                        placeholder="Auto"
                        helpText="Leave empty to use your store's own currency format."
                      />
                      <TextField
                        label="Countdown timer (minutes)"
                        type="number"
                        autoComplete="off"
                        value={String(content.countdownMinutes)}
                        onChange={setC("countdownMinutes")}
                        helpText="0 turns the timer off."
                      />
                    </InlineGrid>
                    <Text as="p" variant="bodySm" tone="subdued">
                      The COD fee charged on every order is set on the Fraud &amp; delivery page.
                    </Text>
                  </BlockStack>
                )}

                {tab === 5 && (
                  <BlockStack gap="400">
                    <Checkbox label="Enable the COD form on the storefront" checked={content.enabled} onChange={setC("enabled")} />
                    <TextField label="Heading" autoComplete="off" value={content.headingText} onChange={setC("headingText")} />
                    <TextField label="Success message" autoComplete="off" multiline={2} value={content.successMessage} onChange={setC("successMessage")} />
                    <TextField label="Order tag" autoComplete="off" value={content.orderTag} onChange={setC("orderTag")} helpText="Added to every COD order." />

                    <Divider />
                    <SectionTitle title="Summary & trust" />
                    <Checkbox label="Show product image in the summary" checked={b.showProductImage} onChange={setBuild("showProductImage")} />
                    <TextField
                      label="Trust badge"
                      autoComplete="off"
                      value={b.trustBadge}
                      onChange={setBuild("trustBadge")}
                      placeholder="e.g. 100% secure — pay when you receive"
                      helpText="Shown under the submit button. Leave empty to hide."
                    />
                  </BlockStack>
                )}
              </Box>
            </Tabs>
          </Card>

          <InlineStack gap="300">
            <Button variant="primary" loading={saving} onClick={save}>Save</Button>
            <Button onClick={reset}>Reset to defaults</Button>
          </InlineStack>
        </BlockStack>

        {/* RIGHT — live preview */}
        <div style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <BlockStack gap="200">
            <Text as="h2" variant="headingSm" alignment="center" tone="subdued">Live preview</Text>
            {rulesOn && (
              <TextField
                label="Preview a city"
                autoComplete="off"
                value={previewCity}
                onChange={setPreviewCity}
                placeholder="e.g. Dhaka"
                helpText="Only affects this preview — shows which rule a customer's city would hit."
              />
            )}
            <LivePreview
              content={content}
              b={b}
              ship={previewOptions}
              codFee={settings.codFee}
              freeOver={Number(freeOver) || 0}
              moneyFormat={moneyFormat}
            />
          </BlockStack>
        </div>
      </InlineGrid>
    </Page>
  );
}

function LivePreview({
  content,
  b,
  ship,
  codFee,
  freeOver,
  moneyFormat,
}: {
  content: any;
  b: Builder;
  ship: ShipOption[];
  codFee: number;
  freeOver: number;
  moneyFormat: string;
}) {
  const font = FONT_STACKS[b.fontFamily] === "inherit" ? "system-ui, sans-serif" : FONT_STACKS[b.fontFamily];
  const stacked = b.fieldLayout === "stacked";

  // Same arithmetic the storefront does, against a sample product price.
  const m = (n: number) => formatMoney(n, moneyFormat, content.currencySymbol);
  const rows = ship.filter((o) => o.name.trim() !== "");
  const sample = 22;
  const free = qualifiesForFreeShipping(sample, freeOver);
  const shipCost = free ? 0 : rows.length > 0 ? Number(rows[0].price) || 0 : 0;
  const total = sample + shipCost + (Number(codFee) || 0);

  const field = (label: string, req?: boolean) => (
    <div
      style={
        stacked
          ? { marginBottom: 8 }
          : { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }
      }
    >
      <div
        style={{
          fontSize: "0.82em",
          fontWeight: 600,
          marginBottom: stacked ? 3 : 0,
          width: stacked ? "auto" : "5.5em",
          flexShrink: 0,
        }}
      >
        {label} {req && b.showRequiredMarks && <span style={{ color: b.accentColor }}>*</span>}
      </div>
      <div
        style={{
          flex: 1,
          height: b.inputPaddingY * 2 + 14,
          border: `1px solid ${b.inputBorderColor}`,
          borderRadius: b.inputRadius,
          background: b.inputBg,
        }}
      />
    </div>
  );

  const icon =
    b.buttonIcon !== "none" ? (
      <svg
        viewBox="0 0 24 24"
        width="1.05em"
        height="1.05em"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <path d={ICONS[b.buttonIcon]} />
      </svg>
    ) : null;

  // The pop-up preview shows the backdrop; embedded sits flat on the page.
  const backdrop =
    b.formType === "popup"
      ? `rgba(0,0,0,${(b.overlayOpacity / 100).toFixed(2)})`
      : "#e9ebee";

  return (
    <div style={{ background: backdrop, borderRadius: 16, padding: 16, transition: "background .15s" }}>
      <div
        style={{
          background: b.modalBg,
          borderRadius: b.modalRadius,
          boxShadow: b.formType === "popup" ? "0 12px 40px rgba(0,0,0,.18)" : "0 1px 3px rgba(0,0,0,.1)",
          padding: 18,
          fontFamily: font,
          fontSize: b.baseFontSize,
          color: b.modalTextColor,
        }}
      >
        <div
          style={{
            textAlign: b.headingAlign,
            fontWeight: 700,
            fontSize: b.headingSize,
            marginBottom: 12,
            position: "relative",
            paddingRight: 16,
          }}
        >
          {content.headingText || "Order — Cash on Delivery"}
          {b.formType === "popup" && (
            <span style={{ position: "absolute", right: 0, top: -2, color: "#888" }}>×</span>
          )}
        </div>

        {content.showName && field("Name", true)}
        {content.showPhone && field("Phone", true)}
        {content.showEmail && field("Email")}
        {content.showAddress && field("Address", true)}
        {content.showCity && field("City")}
        {content.showQuantity && field("Quantity")}
        {content.showNotes && field("Note")}

        {rows.length > 0 && (
          <>
            <div style={{ fontWeight: 700, fontSize: "0.85em", margin: "10px 0 6px" }}>Shipping options</div>
            {rows.map((o, i) => (
              <div
                key={`${o.name}-${i}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  border: `1px solid ${b.inputBorderColor}`,
                  borderRadius: b.inputRadius,
                  padding: "7px 9px",
                  marginBottom: 5,
                  fontSize: "0.85em",
                }}
              >
                <span>
                  <input type="radio" readOnly checked={i === 0} style={{ accentColor: b.accentColor }} /> {o.name}
                </span>
                <b>{free ? "FREE" : m(Number(o.price) || 0)}</b>
              </div>
            ))}
          </>
        )}

        <div style={{ borderTop: "1px solid #eee", marginTop: 8, paddingTop: 8, fontSize: "0.85em" }}>
          {b.showProductImage && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 34, height: 34, borderRadius: 6, background: "#dcdcdc", flexShrink: 0 }} />
              <span>Sample product</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><b>{m(sample)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Shipping</span><b>{free ? "FREE" : m(shipCost)}</b></div>
          {Number(codFee) > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>COD fee</span><b>{m(Number(codFee))}</b></div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, borderTop: "1px solid #eee", marginTop: 4, paddingTop: 4 }}><span>Total</span><b>{m(total)}</b></div>
        </div>

        <button
          style={{
            width: "100%",
            marginTop: 12,
            padding: `${b.buttonPaddingY}px 12px`,
            border: "none",
            borderRadius: b.buttonRadius,
            background: b.submitBg,
            color: b.submitTextColor,
            fontSize: b.buttonTextSize,
            fontWeight: b.buttonBold ? 700 : 500,
            cursor: "pointer",
            lineHeight: 1.2,
          }}
        >
          {b.submitText || "Order Now"}
          {b.submitShowTotal ? ` — ${m(total)}` : ""}
        </button>

        {b.trustBadge ? (
          <div style={{ textAlign: "center", fontSize: "0.75em", opacity: 0.7, marginTop: 8 }}>
            {b.trustBadge}
          </div>
        ) : null}
      </div>

      {/* The product-page buy button — only relevant for the pop-up form. */}
      {b.formType === "popup" && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: "#5c5f62", textAlign: "center", marginBottom: 6 }}>
            Buy button on the product page
          </div>
          <div style={{ display: "flex", justifyContent: b.buttonFullWidth ? "stretch" : "center" }}>
            <button
              style={{
                width: b.buttonFullWidth ? "100%" : "auto",
                padding: `${b.buttonPaddingY}px 20px`,
                border: "none",
                borderRadius: b.buttonRadius,
                background: b.buttonBg,
                color: b.buttonTextColor,
                fontSize: b.buttonTextSize,
                fontWeight: b.buttonBold ? 700 : 500,
                fontFamily: font,
                cursor: "pointer",
                lineHeight: 1.2,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {icon}
              <span>
                {b.buttonText || "Order Now"}
                {b.buttonSubtitle ? (
                  <div style={{ fontSize: Math.max(10, b.buttonTextSize - 4), fontWeight: 400, opacity: 0.85 }}>
                    {b.buttonSubtitle}
                  </div>
                ) : null}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
