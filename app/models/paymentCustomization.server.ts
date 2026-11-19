// Turns on the "COD payment method" function (extensions/cod-payment-method)
// for a shop.
//
// A Payment Customization function only runs at checkout once the shop has a
// payment customization pointing at it, so the app creates one the first time
// the merchant opens the app. With it, a cart that came from the COD button
// reaches checkout with Cash on Delivery as the payment method (App Store
// review 5.1.2). It is created once and never re-enabled behind the
// merchant's back: if they switch it off in Settings → Payments, it stays off.

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

export const COD_CUSTOMIZATION_TITLE = "Easy order COD: use Cash on Delivery";
const FUNCTION_HANDLE = "cod-payment-method";

// Per warm instance; the check itself is cheap and idempotent.
const ensured = new Set<string>();

export async function ensureCodPaymentCustomization(admin: AdminClient, shop: string): Promise<void> {
  if (ensured.has(shop)) return;
  try {
    const listed = await admin.graphql(
      `#graphql
      query CodPaymentCustomizations {
        paymentCustomizations(first: 50) { nodes { id title enabled } }
      }`,
    );
    const body: any = await listed.json();
    if (body?.errors?.length) throw new Error(body.errors.map((e: any) => e.message).join(" "));
    const exists = (body?.data?.paymentCustomizations?.nodes ?? []).some(
      (n: any) => n?.title === COD_CUSTOMIZATION_TITLE,
    );
    if (!exists) {
      const created = await admin.graphql(
        `#graphql
        mutation CodPaymentCustomizationCreate($input: PaymentCustomizationInput!) {
          paymentCustomizationCreate(paymentCustomization: $input) {
            paymentCustomization { id }
            userErrors { field message code }
          }
        }`,
        {
          variables: {
            input: { functionHandle: FUNCTION_HANDLE, title: COD_CUSTOMIZATION_TITLE, enabled: true },
          },
        },
      );
      const out: any = await created.json();
      const errors = [
        ...(out?.errors ?? []),
        ...(out?.data?.paymentCustomizationCreate?.userErrors ?? []),
      ];
      if (errors.length) throw new Error(errors.map((e: any) => e.message).join(" "));
    }
    ensured.add(shop);
  } catch (error) {
    // Never block the admin over this; it is retried on the next page load.
    console.error(`Easy order COD: payment customization for ${shop}:`, error);
  }
}
