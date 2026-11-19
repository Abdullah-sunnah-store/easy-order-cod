import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";
import { embeddedAppUrl, isEmbeddedRequest } from "../../lib/embedded.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Loaded inside the Shopify admin without `shop`: recover it from `host`, and
  // never offer the shop-domain form in the admin (App Store requirement 4.5.4).
  const resume = embeddedAppUrl(request);
  if (resume) throw redirect(resume);

  return { showForm: Boolean(login) && !isEmbeddedRequest(request) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Easy order COD</h1>
        <p className={styles.text}>
          A cash-on-delivery button for your product pages that sends customers
          straight to Shopify checkout with Cash on Delivery selected.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>A COD button on your product pages</strong>. Customers pick
            a quantity and any add-ons, then finish in Shopify checkout, which
            collects their address and uses Cash on Delivery as the payment.
          </li>
          <li>
            <strong>Offers checkout honours</strong>. Quantity offers, bundles
            and add-ons are real Shopify discounts, so the price in the form is
            the price at checkout.
          </li>
          <li>
            <strong>Review risky COD orders</strong>. Orders from postal codes
            you list, or from customers over your order limit, are tagged so you
            can confirm them before shipping.
          </li>
        </ul>
      </div>
    </div>
  );
}
