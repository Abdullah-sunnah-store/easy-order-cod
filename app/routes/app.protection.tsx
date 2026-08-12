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
  Text,
  Button,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getCodSettings, updateCodSettings } from "../models/codSettings.server";
import { getActivePlan } from "../models/billing.server";
import { can, FEATURE_MIN_PLAN } from "../lib/plans";
import { UpgradeNotice } from "../components/UpgradeNotice";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getCodSettings(session.shop);
  const plan = await getActivePlan(admin);
  return {
    settings,
    entitlements: { otp: can(plan, "otp"), ipBlocking: can(plan, "ipBlocking") },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const num = (k: string) => parseFloat(String(form.get(k) || "0")) || 0;
  const int = (k: string) => parseInt(String(form.get(k) || "0"), 10) || 0;

  // Locked fields keep their stored value regardless of what was posted.
  const plan = await getActivePlan(admin);
  const existing = await getCodSettings(session.shop);
  const otp = can(plan, "otp");
  const ipBlocking = can(plan, "ipBlocking");

  await updateCodSettings(session.shop, {
    otpEnabled: otp ? form.get("otpEnabled") === "true" : existing.otpEnabled,
    phoneConfirmation: form.get("phoneConfirmation") === "true",
    ipBlockingEnabled: ipBlocking
      ? form.get("ipBlockingEnabled") === "true"
      : existing.ipBlockingEnabled,
    blockedIps: ipBlocking ? String(form.get("blockedIps") || "") : existing.blockedIps,
    blockedPostalCodes: ipBlocking
      ? String(form.get("blockedPostalCodes") || "")
      : existing.blockedPostalCodes,
    maxOrdersPerPhone: int("maxOrdersPerPhone"),
    codFee: num("codFee"),
    shippingRate: num("shippingRate"),
    freeShippingThreshold: num("freeShippingThreshold"),
  });
  return { ok: true };
};

export default function ProtectionPage() {
  const { settings, entitlements } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [state, setState] = useState(settings);
  const saving =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Saved");
  }, [fetcher.data, shopify]);

  const set =
    (key: keyof typeof state) => (value: string | boolean) =>
      setState((prev) => ({ ...prev, [key]: value }));

  const save = () => {
    const fd = new FormData();
    [
      "otpEnabled",
      "phoneConfirmation",
      "ipBlockingEnabled",
      "blockedIps",
      "blockedPostalCodes",
      "maxOrdersPerPhone",
      "codFee",
      "shippingRate",
      "freeShippingThreshold",
    ].forEach((k) => fd.append(k, String((state as any)[k])));
    fetcher.submit(fd, { method: "POST" });
  };

  return (
    <Page>
      <TitleBar title="Fraud & delivery">
        <button variant="primary" onClick={save}>Save</button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Fraud prevention</Text>
                {!entitlements.otp && <UpgradeNotice required={FEATURE_MIN_PLAN.otp} />}
                <Checkbox
                  label="Require OTP verification (SMS/WhatsApp) before an order is placed"
                  helpText="Reduces fake COD orders. Requires an SMS/WhatsApp provider on the Connections page."
                  checked={state.otpEnabled}
                  onChange={set("otpEnabled")}
                  disabled={!entitlements.otp}
                />
                <Checkbox
                  label="Ask customers to confirm their phone number"
                  checked={state.phoneConfirmation}
                  onChange={set("phoneConfirmation")}
                />
                {!entitlements.ipBlocking && <UpgradeNotice required={FEATURE_MIN_PLAN.ipBlocking} />}
                <Checkbox
                  label="Enable IP blocking"
                  checked={state.ipBlockingEnabled}
                  onChange={set("ipBlockingEnabled")}
                  disabled={!entitlements.ipBlocking}
                />
                <TextField
                  label="Blocked IP addresses"
                  autoComplete="off"
                  multiline={3}
                  value={state.blockedIps}
                  onChange={set("blockedIps")}
                  disabled={!entitlements.ipBlocking || !state.ipBlockingEnabled}
                  helpText="One IP per line."
                />
                <TextField
                  label="Blocked postal / ZIP codes"
                  autoComplete="off"
                  multiline={2}
                  value={state.blockedPostalCodes}
                  onChange={set("blockedPostalCodes")}
                  disabled={!entitlements.ipBlocking}
                  helpText="Comma-separated. Orders to these codes are rejected."
                />
                <TextField
                  label="Max orders per phone number (0 = unlimited)"
                  autoComplete="off"
                  type="number"
                  value={String(state.maxOrdersPerPhone)}
                  onChange={set("maxOrdersPerPhone")}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Delivery &amp; COD fees</Text>
                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                  <TextField label="COD fee" type="number" autoComplete="off" prefix="$" value={String(state.codFee)} onChange={set("codFee")} />
                  <TextField label="Shipping rate" type="number" autoComplete="off" prefix="$" value={String(state.shippingRate)} onChange={set("shippingRate")} />
                  <TextField label="Free shipping over" type="number" autoComplete="off" prefix="$" value={String(state.freeShippingThreshold)} onChange={set("freeShippingThreshold")} helpText="0 = never" />
                </InlineGrid>
                <div>
                  <Button variant="primary" loading={saving} onClick={save}>Save</Button>
                </div>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
