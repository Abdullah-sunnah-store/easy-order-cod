import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  TextField,
  Checkbox,
  Select,
  Text,
  Button,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnections, updateConnections } from "../models/connections.server";
import { getActivePlan } from "../models/billing.server";
import { can, FEATURE_MIN_PLAN } from "../lib/plans";
import { UpgradeNotice } from "../components/UpgradeNotice";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const connections = await getConnections(session.shop);
  const plan = await getActivePlan(admin);
  return {
    connections,
    entitlements: {
      pixels: can(plan, "pixels"),
      sheets: can(plan, "sheets"),
      sms: can(plan, "sms"),
      whatsapp: can(plan, "whatsapp"),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const str = (k: string) => String(form.get(k) || "");

  // Re-check entitlements server-side: a disabled input in the UI is a hint,
  // not a control. Locked fields keep whatever the shop already had.
  const plan = await getActivePlan(admin);
  const existing = await getConnections(session.shop);
  const keep = <T,>(allowed: boolean, next: T, current: T) => (allowed ? next : current);

  const pixels = can(plan, "pixels");
  const sheets = can(plan, "sheets");
  const sms = can(plan, "sms");
  const whatsapp = can(plan, "whatsapp");

  await updateConnections(session.shop, {
    fbPixelId: keep(pixels, str("fbPixelId"), existing.fbPixelId),
    tiktokPixelId: keep(pixels, str("tiktokPixelId"), existing.tiktokPixelId),
    googleTagId: keep(pixels, str("googleTagId"), existing.googleTagId),
    snapPixelId: keep(pixels, str("snapPixelId"), existing.snapPixelId),
    pinterestTagId: keep(pixels, str("pinterestTagId"), existing.pinterestTagId),
    googleSheetsEnabled: keep(sheets, form.get("googleSheetsEnabled") === "true", existing.googleSheetsEnabled),
    googleSheetUrl: keep(sheets, str("googleSheetUrl"), existing.googleSheetUrl),
    smsProvider: keep(sms, str("smsProvider") || "none", existing.smsProvider),
    smsApiKey: keep(sms, str("smsApiKey"), existing.smsApiKey),
    smsSenderId: keep(sms, str("smsSenderId"), existing.smsSenderId),
    whatsappEnabled: keep(whatsapp, form.get("whatsappEnabled") === "true", existing.whatsappEnabled),
    whatsappPhone: keep(whatsapp, str("whatsappPhone"), existing.whatsappPhone),
  });
  return { ok: true };
};

export default function ConnectionsPage() {
  const { connections, entitlements } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [state, setState] = useState(connections);
  const saving =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Connections saved");
  }, [fetcher.data, shopify]);

  const set = (key: keyof typeof state) => (value: string | boolean) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const save = () => {
    const fd = new FormData();
    Object.entries(state).forEach(([k, v]) => {
      if (k === "shop" || k === "updatedAt") return;
      fd.append(k, String(v));
    });
    fetcher.submit(fd, { method: "POST" });
  };

  return (
    <Page>
      <TitleBar title="Connections">
        <button variant="primary" onClick={save}>Save</button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Marketing pixels</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Track COD conversions on your ad platforms. Paste each pixel/tag ID.
                  </Text>
                </BlockStack>
                {!entitlements.pixels && <UpgradeNotice required={FEATURE_MIN_PLAN.pixels} />}
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <TextField label="Facebook Pixel ID" autoComplete="off" value={state.fbPixelId} onChange={set("fbPixelId")} disabled={!entitlements.pixels} />
                  <TextField label="TikTok Pixel ID" autoComplete="off" value={state.tiktokPixelId} onChange={set("tiktokPixelId")} disabled={!entitlements.pixels} />
                  <TextField label="Google Tag ID" autoComplete="off" value={state.googleTagId} onChange={set("googleTagId")} disabled={!entitlements.pixels} />
                  <TextField label="Snapchat Pixel ID" autoComplete="off" value={state.snapPixelId} onChange={set("snapPixelId")} disabled={!entitlements.pixels} />
                  <TextField label="Pinterest Tag ID" autoComplete="off" value={state.pinterestTagId} onChange={set("pinterestTagId")} disabled={!entitlements.pixels} />
                </InlineGrid>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Google Sheets export</Text>
                {!entitlements.sheets && <UpgradeNotice required={FEATURE_MIN_PLAN.sheets} />}
                <Checkbox
                  label="Auto-export every COD order to a Google Sheet"
                  checked={state.googleSheetsEnabled}
                  onChange={set("googleSheetsEnabled")}
                  disabled={!entitlements.sheets}
                />
                <TextField
                  label="Google Sheet URL"
                  autoComplete="off"
                  value={state.googleSheetUrl}
                  onChange={set("googleSheetUrl")}
                  disabled={!entitlements.sheets || !state.googleSheetsEnabled}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">SMS &amp; WhatsApp</Text>
                {!entitlements.sms && <UpgradeNotice required={FEATURE_MIN_PLAN.sms} />}
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <Select
                    label="SMS provider"
                    options={[
                      { label: "None", value: "none" },
                      { label: "Twilio", value: "twilio" },
                      { label: "Vonage", value: "vonage" },
                      { label: "MessageBird", value: "messagebird" },
                    ]}
                    value={state.smsProvider}
                    onChange={set("smsProvider")}
                    disabled={!entitlements.sms}
                  />
                  <TextField label="SMS sender ID" autoComplete="off" value={state.smsSenderId} onChange={set("smsSenderId")} disabled={!entitlements.sms} />
                </InlineGrid>
                <TextField
                  label="SMS API key"
                  autoComplete="off"
                  type="password"
                  value={state.smsApiKey}
                  onChange={set("smsApiKey")}
                  disabled={!entitlements.sms || state.smsProvider === "none"}
                />
                <Checkbox
                  label="Send order confirmations over WhatsApp"
                  checked={state.whatsappEnabled}
                  onChange={set("whatsappEnabled")}
                  disabled={!entitlements.whatsapp}
                />
                <TextField
                  label="WhatsApp business number"
                  autoComplete="off"
                  value={state.whatsappPhone}
                  onChange={set("whatsappPhone")}
                  disabled={!entitlements.whatsapp || !state.whatsappEnabled}
                  placeholder="+1 555 000 0000"
                />
                <div>
                  <Button variant="primary" loading={saving} onClick={save}>Save connections</Button>
                </div>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
