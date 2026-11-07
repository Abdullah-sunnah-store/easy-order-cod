import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  InlineStack,
  Text,
  Button,
  Badge,
  Select,
  TextField,
  Banner,
  Box,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getActivePlan } from "../models/billing.server";
import { getCodSettings, updateCodSettings } from "../models/codSettings.server";
import { can, FEATURE_MIN_PLAN } from "../lib/plans";
import { UpgradeNotice } from "../components/UpgradeNotice";
import { TEMPLATES } from "../lib/templates";
import {
  LANGUAGES,
  TEXT_FIELDS,
  parseTranslations,
  type TextKey,
} from "../lib/storefrontText";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getActivePlan(admin);
  const settings = await getCodSettings(session.shop);
  return {
    templateId: settings.templateId,
    translations: parseTranslations(settings.translations),
    canTemplates: can(plan, "templates"),
    canLanguages: can(plan, "languages"),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const plan = await getActivePlan(admin);
  const settings = await getCodSettings(session.shop);

  if (intent === "template") {
    if (!can(plan, "templates")) return { ok: false, error: `Templates are on the ${FEATURE_MIN_PLAN.templates} plan.` };
    const template = TEMPLATES.find((t) => t.id === String(form.get("id")));
    if (!template) return { ok: false, error: "Unknown template." };
    let builder: Record<string, unknown> = {};
    try {
      builder = JSON.parse(settings.builderConfig || "{}");
    } catch {
      /* start fresh */
    }
    await updateCodSettings(session.shop, {
      builderConfig: JSON.stringify({ ...builder, ...template.builder }),
      templateId: template.id,
    });
    return { ok: true, message: `"${template.name}" applied — fine-tune it in Form settings.` };
  }

  if (intent === "translations") {
    if (!can(plan, "languages")) return { ok: false, error: `Languages are on the ${FEATURE_MIN_PLAN.languages} plan.` };
    const code = String(form.get("code") || "");
    if (!LANGUAGES.some((l) => l.code === code)) return { ok: false, error: "Choose a language." };
    let strings: Record<string, string> = {};
    try {
      strings = JSON.parse(String(form.get("strings") || "{}"));
    } catch {
      return { ok: false, error: "The translation could not be read." };
    }
    const all = parseTranslations(settings.translations);
    all[code] = strings as any;
    // parseTranslations again drops empty and unknown keys.
    const cleaned = parseTranslations(JSON.stringify(all));
    if (!Object.keys(cleaned[code] ?? {}).length) delete cleaned[code];
    await updateCodSettings(session.shop, { translations: JSON.stringify(cleaned) });
    return { ok: true, message: "Translation saved" };
  }

  return { ok: false, error: "Unknown action." };
};

export default function DesignPage() {
  const { templateId, translations, canTemplates, canLanguages } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";
  const data = fetcher.data as any;

  const [code, setCode] = useState(Object.keys(translations)[0] || "fr");
  const [strings, setStrings] = useState<Partial<Record<TextKey, string>>>(translations[code] ?? {});
  useEffect(() => setStrings(translations[code] ?? {}), [code, translations]);

  useEffect(() => {
    if (data?.ok && data.message) shopify.toast.show(data.message);
  }, [data, shopify]);

  const submit = (fields: Record<string, string>) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    fetcher.submit(fd, { method: "POST" });
  };

  const translated = useMemo(() => new Set(Object.keys(translations)), [translations]);

  return (
    <Page>
      <TitleBar title="Templates & languages" />
      <Layout>
        {data && !data.ok && data.error && (
          <Layout.Section>
            <Banner tone="critical">{data.error}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Form templates</Text>
            {!canTemplates && <UpgradeNotice required={FEATURE_MIN_PLAN.templates} />}
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              {TEMPLATES.map((t) => {
                const b = t.builder as Record<string, any>;
                return (
                  <Card key={t.id}>
                    <BlockStack gap="300">
                      <div
                        style={{
                          background: "#e5e7eb",
                          borderRadius: 10,
                          padding: 14,
                        }}
                      >
                        <div
                          style={{
                            background: b.modalBg,
                            color: b.modalTextColor,
                            borderRadius: Math.min(Number(b.modalRadius), 18),
                            padding: 12,
                            display: "grid",
                            gap: 8,
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 13, textAlign: b.headingAlign }}>Order — Cash on Delivery</div>
                          <div style={{ height: 24, borderRadius: Math.min(Number(b.inputRadius), 12), border: `1px solid ${b.inputBorderColor}`, background: b.inputBg }} />
                          <div
                            style={{
                              background: b.buttonBg,
                              color: b.buttonTextColor,
                              borderRadius: Math.min(Number(b.buttonRadius), 20),
                              border: b.buttonBg === "#ffffff" ? "1px solid #111" : "none",
                              padding: "7px 10px",
                              textAlign: "center",
                              fontSize: 12,
                              fontWeight: b.buttonBold ? 700 : 400,
                            }}
                          >
                            Cash on Delivery
                          </div>
                        </div>
                      </div>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">{t.name}</Text>
                        {templateId === t.id && <Badge tone="success">Applied</Badge>}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">{t.description}</Text>
                      <Button disabled={!canTemplates || busy} onClick={() => submit({ intent: "template", id: t.id })}>
                        Apply
                      </Button>
                    </BlockStack>
                  </Card>
                );
              })}
            </InlineGrid>
            <Text as="p" variant="bodySm" tone="subdued">
              Applying changes colours, corners, icon and animation. Your wording stays.
            </Text>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Languages</Text>
                <Text as="p" tone="subdued">
                  The form shows in the visitor's storefront language when you've translated
                  it, and in your Form settings wording otherwise. Leave a field empty to use
                  the English text. Arabic and Urdu switch the form to right-to-left.
                </Text>
              </BlockStack>
              {!canLanguages && <UpgradeNotice required={FEATURE_MIN_PLAN.languages} />}
              <Select
                label="Language"
                options={LANGUAGES.map((l) => ({
                  label: `${l.name}${translated.has(l.code) ? " ✓" : ""}`,
                  value: l.code,
                }))}
                value={code}
                onChange={setCode}
                disabled={!canLanguages}
              />
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                {TEXT_FIELDS.map((f) => (
                  <TextField
                    key={f.key}
                    label={f.label}
                    autoComplete="off"
                    value={strings[f.key] ?? ""}
                    placeholder={f.def || "—"}
                    helpText={f.hint}
                    onChange={(v) => setStrings((prev) => ({ ...prev, [f.key]: v }))}
                    disabled={!canLanguages}
                  />
                ))}
              </InlineGrid>
              <Box>
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!canLanguages}
                  onClick={() => submit({ intent: "translations", code, strings: JSON.stringify(strings) })}
                >
                  Save translation
                </Button>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
