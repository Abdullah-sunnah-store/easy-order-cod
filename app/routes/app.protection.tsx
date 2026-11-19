import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  List,
  TextField,
  Text,
  Button,
  Checkbox,
  InlineGrid,
  Banner,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getCodSettings, updateCodSettings } from "../models/codSettings.server";
import { getActivePlan } from "../models/billing.server";
import { can, FEATURE_MIN_PLAN } from "../lib/plans";
import { UpgradeNotice } from "../components/UpgradeNotice";
import { CUSTOMER_LIMIT_TAG, POSTAL_TAG } from "../lib/reviewTags";
import { getCodRules, saveCodRules } from "../models/paymentCustomization.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getCodSettings(session.shop);
  const plan = await getActivePlan(admin);
  const cod = await getCodRules(admin);
  return {
    cod: {
      active: cod.active,
      codOnly: cod.rules.codOnly,
      blockedZips: cod.rules.blockedZips.join("\n"),
      minTotal: cod.rules.minTotal == null ? "" : String(cod.rules.minTotal),
      maxTotal: cod.rules.maxTotal == null ? "" : String(cod.rules.maxTotal),
    },
    settings: {
      blockedPostalCodes: settings.blockedPostalCodes,
      maxOrdersPerPhone: settings.maxOrdersPerPhone,
    },
    entitlements: { postalBlocking: can(plan, "postalBlocking") },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  // COD rules at checkout (all plans) — saved on the payment customization.
  if (form.get("intent") === "codRules") {
    const amount = (name: string) => {
      const n = parseFloat(String(form.get(name) || ""));
      return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
    };
    const error = await saveCodRules(admin, session.shop, {
      codOnly: form.get("codOnly") === "true",
      blockedZips: String(form.get("blockedZips") || "")
        .split(/[\n,]+/)
        .map((z) => z.trim())
        .filter(Boolean)
        .slice(0, 500),
      minTotal: amount("minTotal"),
      maxTotal: amount("maxTotal"),
    });
    return error ? { ok: false, error } : { ok: true };
  }

  const max = Math.max(0, Math.min(1000, parseInt(String(form.get("maxOrdersPerPhone") || "0"), 10) || 0));

  // Locked fields keep their stored value regardless of what was posted.
  const plan = await getActivePlan(admin);
  const existing = await getCodSettings(session.shop);
  const postal = can(plan, "postalBlocking");

  await updateCodSettings(session.shop, {
    blockedPostalCodes: postal
      ? String(form.get("blockedPostalCodes") || "").slice(0, 5000)
      : existing.blockedPostalCodes,
    // Column name kept to avoid a destructive migration; it now limits COD
    // orders per Shopify customer in 30 days.
    maxOrdersPerPhone: max,
  });
  return { ok: true };
};

export default function ProtectionPage() {
  const { settings, entitlements, cod: codLoaded } = useLoaderData<typeof loader>();
  const [cod, setCod] = useState(codLoaded);
  const codFetcher = useFetcher<typeof action>();
  const codSaving = codFetcher.state !== "idle";
  const codError = codFetcher.data && "error" in codFetcher.data ? String((codFetcher.data as any).error) : "";
  useEffect(() => {
    if (codFetcher.state === "idle" && codFetcher.data?.ok) shopify.toast.show("COD rules saved");
  }, [codFetcher.state, codFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveCod = () => {
    const fd = new FormData();
    fd.append("intent", "codRules");
    fd.append("codOnly", String(cod.codOnly));
    fd.append("blockedZips", cod.blockedZips);
    fd.append("minTotal", cod.minTotal);
    fd.append("maxTotal", cod.maxTotal);
    codFetcher.submit(fd, { method: "POST" });
  };
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
    (key: keyof typeof state) => (value: string) =>
      setState((prev) => ({ ...prev, [key]: value }));

  const save = () => {
    const fd = new FormData();
    fd.append("blockedPostalCodes", String(state.blockedPostalCodes));
    fd.append("maxOrdersPerPhone", String(state.maxOrdersPerPhone));
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
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Cash on Delivery at checkout</Text>
                  <Text as="p" tone="subdued">
                    Applied inside Shopify checkout by the app's payment
                    customization, so the rules hold for every order — not just
                    ones placed with the COD button.
                  </Text>
                </BlockStack>
                {!cod.active && (
                  <Banner tone="warning">
                    <Text as="p">
                      The payment customization isn't active yet. Add Cash on
                      Delivery under Settings → Payments → Manual payment methods,
                      then save here.
                    </Text>
                  </Banner>
                )}
                {codError && <Banner tone="critical"><Text as="p">{codError}</Text></Banner>}
                <Checkbox
                  label="Orders from the COD button see only Cash on Delivery"
                  helpText="Off: Cash on Delivery is listed first and the customer can still choose another method."
                  checked={cod.codOnly}
                  onChange={(v) => setCod((c) => ({ ...c, codOnly: v }))}
                />
                <TextField
                  label="Don't offer Cash on Delivery to these postal codes"
                  autoComplete="off"
                  multiline={3}
                  value={cod.blockedZips}
                  onChange={(v) => setCod((c) => ({ ...c, blockedZips: v }))}
                  helpText="Comma- or line-separated. End with * for a prefix (1212*). Customers there can still pay another way."
                />
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <TextField
                    label="Minimum order total for COD"
                    type="number"
                    min={0}
                    autoComplete="off"
                    value={cod.minTotal}
                    onChange={(v) => setCod((c) => ({ ...c, minTotal: v }))}
                    helpText="Empty = no minimum."
                  />
                  <TextField
                    label="Maximum order total for COD"
                    type="number"
                    min={0}
                    autoComplete="off"
                    value={cod.maxTotal}
                    onChange={(v) => setCod((c) => ({ ...c, maxTotal: v }))}
                    helpText="Empty = no maximum. Larger orders must be paid another way."
                  />
                </InlineGrid>
                <div>
                  <Button variant="primary" loading={codSaving} onClick={saveCod}>Save COD rules</Button>
                </div>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Review suspicious COD orders</Text>
                  <Text as="p" tone="subdued">
                    Customers enter their address and phone in Shopify checkout, so the
                    app can't stop an order before it's placed. Instead it tags matching
                    COD orders the moment they arrive, so you can call or cancel before
                    shipping. Filter your Orders list by the tag to see them.
                  </Text>
                </BlockStack>
                {!entitlements.postalBlocking && <UpgradeNotice required={FEATURE_MIN_PLAN.postalBlocking} />}
                <TextField
                  label="Postal / ZIP codes to review"
                  autoComplete="off"
                  multiline={3}
                  value={state.blockedPostalCodes}
                  onChange={set("blockedPostalCodes")}
                  disabled={!entitlements.postalBlocking}
                  helpText={`Comma- or line-separated. End with * to match a prefix (1212*). Matching orders get the tag ${POSTAL_TAG}.`}
                />
                <TextField
                  label="Max COD orders per customer in 30 days (0 = off)"
                  autoComplete="off"
                  type="number"
                  min={0}
                  value={String(state.maxOrdersPerPhone)}
                  onChange={set("maxOrdersPerPhone")}
                  helpText={`Orders beyond this get the tag ${CUSTOMER_LIMIT_TAG}. Customers are matched by their Shopify customer account (email or phone).`}
                />
                <div>
                  <Button variant="primary" loading={saving} onClick={save}>Save</Button>
                </div>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Delivery &amp; COD fees</Text>
                <Text as="p" tone="subdued">
                  Shipping rates, taxes and any cash-on-delivery surcharge are
                  charged by Shopify checkout, so they are configured in Shopify
                  rather than here.
                </Text>
                <List>
                  <List.Item>
                    Rates and free-shipping thresholds:{" "}
                    <Text as="span" fontWeight="semibold">Settings → Shipping and delivery</Text>
                  </List.Item>
                  <List.Item>
                    Offering cash on delivery:{" "}
                    <Text as="span" fontWeight="semibold">Settings → Payments → Manual payment methods → Cash on Delivery (COD)</Text>
                  </List.Item>
                  <List.Item>
                    A COD surcharge: add it as a shipping rate for the COD
                    delivery option, or as a Shopify discount/fee — the app
                    cannot add a charge to an order it does not create.
                  </List.Item>
                </List>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
