// Minifies the theme app extension's storefront script.
//
// Shopify's theme check (AssetSizeAppBlockJavaScript) caps an app block's
// JavaScript at 10,000 bytes. The readable source lives in extensions-src/;
// the file in extensions/cod-form/assets/ is generated — edit the source, not it.
import { build } from "esbuild";
import { statSync } from "node:fs";

const LIMIT = 10_000;
// cod-form.js = form logic, cod-style.js = appearance. Split so each file stays
// under the per-file limit.
const files = ["cod-form", "cod-style"];

let failed = false;
for (const name of files) {
  const out = `extensions/cod-form/assets/${name}.js`;
  await build({
    entryPoints: [`extensions-src/${name}.js`],
    outfile: out,
    minify: true,
    target: "es2017",
    legalComments: "none",
    logLevel: "warning",
  });
  const size = statSync(out).size;
  if (size > LIMIT) {
    console.error(`${out} is ${size} B, over the ${LIMIT} B theme check limit.`);
    failed = true;
  } else {
    console.log(`${out}: ${size} B (limit ${LIMIT} B)`);
  }
}
if (failed) process.exit(1);
