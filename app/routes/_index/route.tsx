import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Easy order COD</h1>
        <p className={styles.text}>
          Sell cash on delivery without checkout. Add a one-step order form to
          any product page and turn browsers into confirmed COD orders.
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
            <strong>A COD form on your product pages</strong>. Add the form as a
            theme block, choose which fields appear, and take the customer's
            name, phone, city and address without sending them to checkout.
          </li>
          <li>
            <strong>Delivery charges that fit your rates</strong>. Enter your own
            shipping options, sync the rates already set on your store, or charge
            by the city the customer types in.
          </li>
          <li>
            <strong>Fewer fake orders</strong>. Block abusive IPs and postal
            codes, cap how many orders one phone number can place, and add phone
            confirmation before an order is created.
          </li>
        </ul>
      </div>
    </div>
  );
}
