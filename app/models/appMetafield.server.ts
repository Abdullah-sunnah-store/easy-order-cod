// App-owned shop metafields ($app:cod). Only this app can write them; the
// thank-you-offer checkout extension declares and reads them.

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

export const APP_NAMESPACE = "$app:cod";

export async function setShopAppMetafield(admin: AdminClient, key: string, value: unknown) {
  const shopRes = await admin.graphql(`#graphql
    query CodShopId { shop { id } }`);
  const shopId = (await shopRes.json() as any)?.data?.shop?.id;
  if (!shopId) throw new Error("Could not read the shop id.");

  const res = await admin.graphql(
    `#graphql
    mutation CodSetAppMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          { ownerId: shopId, namespace: APP_NAMESPACE, key, type: "json", value: JSON.stringify(value) },
        ],
      },
    },
  );
  const body: any = await res.json();
  const errors = body?.data?.metafieldsSet?.userErrors ?? [];
  if (body?.errors?.length || errors.length) {
    throw new Error(
      [...(body?.errors ?? []), ...errors].map((e: any) => e.message).join(" ") || "Could not save the offer.",
    );
  }
}
