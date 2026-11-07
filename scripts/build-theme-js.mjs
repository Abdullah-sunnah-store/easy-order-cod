// Minifies the theme app extension's storefront script.
//
// Shopify's theme check (AssetSizeAppBlockJavaScript) caps an app block's
// JavaScript at 10,000 bytes. The readable source lives in extensions-src/;
// the file in extensions/cod-form/assets/ is generated — edit the source, not it.
import { build } from "esbuild";
import { statSync } from "node:fs";

const LIMIT = 10_000;
const out = "extensions/cod-form/assets/cod-form.js";

await build({
  entryPoints: ["extensions-src/cod-form.js"],
  outfile: out,
  minify: true,
  target: "es2017",
  legalComments: "none",
  logLevel: "warning",
});

const size = statSync(out).size;
if (size > LIMIT) {
  console.error(`${out} is ${size} B, over the ${LIMIT} B theme check limit.`);
  process.exit(1);
}
console.log(`${out}: ${size} B (limit ${LIMIT} B)`);
