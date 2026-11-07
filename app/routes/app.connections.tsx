import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  InlineStack,
  TextField,
  Checkbox,
  Text,
  Button,
  Banner,
  List,
  Box,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnections, updateConnections } from "../models/connections.server";
import { getActivePlan } from "../models/billing.server";
import { APPS_SCRIPT_SOURCE, isValidSheetsUrl, sendToSheet } from "../models/sheets.server";
import { can, FEATURE_MIN_PLAN } from "../lib/plans";
import { UpgradeNotice } from "../components/UpgradeNotice";

// Pixel IDs are pasted by the merchant and echoed into storefront script URLs,
// so only plain ID characters are kept.
const cleanId = (value: string) => value.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const connections = await getConnections(session.shop);
  const plan = await getActivePlan(admin);
  return {
    connections: {
      fbPixelId: connections.fbPixelId,
      tiktokPixelId: connections.tiktokPixelId,
      googleTagId: connections.googleTagId,
      snapPixelId: connections.snapPixelId,
      pinterestTagId: connections.pinterestTagId,
      googleSheetsEnabled: connections.googleSheetsEnabled,
      googleSheetUrl: connections.googleSheetUrl,
    },
    entitlements: {
      pixels: can(plan, "pixels"),
      sheets: can(plan, "sheets"),
    },
    appsScript: APPS_SCRIPT_SOURCE,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const str = (k: string) => String(form.get(k) || "").trim();

  // Re-check entitlements server-side: a disabled input in the UI is a hint,
  // not a control. Locked fields keep whatever the shop already had.
  const plan = await getActivePlan(admin);
  const existing = await getConnections(session.shop);
  const keep = <T,>(allowed: boolean, next: T, current: T) => (allowed ? next : current);
  const pixels = can(plan, "pixels");
  const sheets = can(plan, "sheets");

  const sheetsEnabled = form.get("googleSheetsEnabled") === "true";
  const sheetUrl = str("googleSheetUrl");
  if (sheets && sheetsEnabled && !isValidSheetsUrl(sheetUrl)) {
    return {
      ok: false,
      error:
        "That isn't an Apps Script web app URL. It should look like https://script.google.com/macros/s/…/exec — follow the steps below to get it.",
    };
  }

  if (str("intent") === "testSheet") {
    if (!sheets || !isValidSheetsUrl(sheetUrl)) {
      return { ok: false, error: "Add a valid Apps Script URL first." };
    }
    const sent = await sendToSheet(sheetUrl, {
      order: "#TEST",
      date: new Date().toISOString(),
      total: "0.00",
      currency: "",
      items: "Test row from Easy order COD",
      customer: "",
      phone: "",
      email: "",
      address: "",
      city: "",
      zip: "",
      country: "",
      flags: "",
    }, 8000);
    return sent
      ? { ok: true, message: "Test row sent — check your sheet." }
      : {
          ok: false,
          error:
            "The sheet didn't accept the test row. Check the script is deployed as a web app with access set to \"Anyone\".",
        };
  }

  await updateConnections(session.shop, {
    fbPixelId: keep(pixels, cleanId(str("fbPixelId")), existing.fbPixelId),
    tiktokPixelId: keep(pixels, cleanId(str("tiktokPixelId")), existing.tiktokPixelId),
    googleTagId: keep(pixels, cleanId(str("googleTagId")), existing.googleTagId),
    snapPixelId: keep(pixels, cleanId(str("snapPixelId")), existing.snapPixelId),
    pinterestTagId: keep(pixels, cleanId(str("pinterestTagId")), existing.pinterestTagId),
    googleSheetsEnabled: keep(sheets, sheetsEnabled, existing.googleSheetsEnabled),
    googleSheetUrl: keep(sheets, sheetUrl, existing.googleSheetUrl),
  });
  return { ok: true, message: "Connections saved" };
};

export default function ConnectionsPage() {
  const { connections, entitlements, appsScript } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [state, setState] = useState(connections);
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && !fetcher.data.ok ? (fetcher.data as any).error : "";

  useEffect(() => {
    const data = fetcher.data as any;
    if (data?.ok && data.message) shopify.toast.show(data.message);
  }, [fetcher.data, shopify]);

  const set = (key: keyof typeof state) => (value: string | boolean) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const submit = (intent: "save" | "testSheet") => {
    const fd = new FormData();
    Object.entries(state).forEach(([k, v]) => fd.append(k, String(v)));
    fd.append("intent", intent);
    fetcher.submit(fd, { method: "POST" });
  };

  return (
    <Page>
      <TitleBar title="Connections">
        <button variant="primary" onClick={() => submit("save")}>Save</button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {error && <Banner tone="critical">{error}</Banner>}

            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Marketing pixels</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Loaded on every storefront page (PageView) and told when a customer
                    uses the COD button (InitiateCheckout / begin_checkout).
                  </Text>
                </BlockStack>
                {!entitlements.pixels && <UpgradeNotice required={FEATURE_MIN_PLAN.pixels} />}
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <TextField label="Facebook Pixel ID" autoComplete="off" value={state.fbPixelId} onChange={set("fbPixelId")} disabled={!entitlements.pixels} />
                  <TextField label="TikTok Pixel ID" autoComplete="off" value={state.tiktokPixelId} onChange={set("tiktokPixelId")} disabled={!entitlements.pixels} />
                  <TextField label="Google Tag ID" autoComplete="off" value={state.googleTagId} onChange={set("googleTagId")} disabled={!entitlements.pixels} placeholder="G-XXXXXXX or AW-XXXXXXX" />
                  <TextField label="Snapchat Pixel ID" autoComplete="off" value={state.snapPixelId} onChange={set("snapPixelId")} disabled={!entitlements.pixels} />
                  <TextField label="Pinterest Tag ID" autoComplete="off" value={state.pinterestTagId} onChange={set("pinterestTagId")} disabled={!entitlements.pixels} />
                </InlineGrid>
                <Banner tone="info">
                  <p>
                    Turn on the app embed so the pixels load: <b>Online Store → Themes → Customize →
                    App embeds → Easy order COD</b>. Purchases happen inside Shopify checkout,
                    which this app can't see — report those with your Facebook &amp; Instagram,
                    Google or TikTok sales channel app.
                  </p>
                </Banner>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Google Sheets export</Text>
                {!entitlements.sheets && <UpgradeNotice required={FEATURE_MIN_PLAN.sheets} />}
                <Checkbox
                  label="Add a row to my Google Sheet for every COD order"
                  checked={state.googleSheetsEnabled}
                  onChange={set("googleSheetsEnabled")}
                  disabled={!entitlements.sheets}
                />
                <TextField
                  label="Apps Script web app URL"
                  autoComplete="off"
                  value={state.googleSheetUrl}
                  onChange={set("googleSheetUrl")}
                  disabled={!entitlements.sheets || !state.googleSheetsEnabled}
                  placeholder="https://script.google.com/macros/s/…/exec"
                />
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">Setup (2 minutes)</Text>
                  <List type="number">
                    <List.Item>Open your Google Sheet → <b>Extensions → Apps Script</b>.</List.Item>
                    <List.Item>Replace the code with the script below and save.</List.Item>
                    <List.Item><b>Deploy → New deployment → Web app</b>. Execute as <b>Me</b>, access <b>Anyone</b>.</List.Item>
                    <List.Item>Copy the web app URL (ends in <code>/exec</code>), paste it above and save.</List.Item>
                  </List>
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>{appsScript}</pre>
                  </Box>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Each row holds the order number, total, items and the customer's name,
                    phone, email and address, sent only to your sheet.
                  </Text>
                </BlockStack>
                <InlineStack gap="200">
                  <Button variant="primary" loading={busy} onClick={() => submit("save")}>Save connections</Button>
                  <Button
                    disabled={!entitlements.sheets || !state.googleSheetsEnabled || busy}
                    onClick={() => submit("testSheet")}
                  >
                    Send test row
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
