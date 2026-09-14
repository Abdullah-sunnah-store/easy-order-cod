-- Checkout handoff (App Store requirement 1.1.2, review ref 129273).
--
-- The app no longer creates orders, so the columns that existed only to price
-- one are dropped: the shipping engine (rates, city rules, sync, free-shipping
-- threshold), the COD fee, and the contact/address field toggles. Shopify
-- checkout collects and prices all of it now.
--
-- Upsell.discountId/discountCode point at the real Shopify discount that
-- applies an offer's percentage. CodOrder records COD orders observed on the
-- orders/create webhook — ids only, no customer data.

-- CreateTable
CREATE TABLE "CodOrder" (
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "period" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("shop", "orderId")
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CodSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "headingText" TEXT NOT NULL DEFAULT 'Order — Cash on Delivery',
    "buttonText" TEXT NOT NULL DEFAULT 'Order Now (Cash on Delivery)',
    "orderTag" TEXT NOT NULL DEFAULT 'COD',
    "showQuantity" BOOLEAN NOT NULL DEFAULT true,
    "showNotes" BOOLEAN NOT NULL DEFAULT false,
    "otpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "phoneConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "ipBlockingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "blockedIps" TEXT NOT NULL DEFAULT '',
    "blockedPostalCodes" TEXT NOT NULL DEFAULT '',
    "maxOrdersPerPhone" INTEGER NOT NULL DEFAULT 0,
    "currencySymbol" TEXT NOT NULL DEFAULT '',
    "countdownMinutes" INTEGER NOT NULL DEFAULT 0,
    "checkoutNotice" TEXT NOT NULL DEFAULT 'Shipping, taxes and payment are calculated at checkout.',
    "builderConfig" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CodSettings" ("blockedIps", "blockedPostalCodes", "builderConfig", "buttonText", "countdownMinutes", "currencySymbol", "enabled", "headingText", "ipBlockingEnabled", "maxOrdersPerPhone", "orderTag", "otpEnabled", "phoneConfirmation", "shop", "showNotes", "showQuantity", "updatedAt") SELECT "blockedIps", "blockedPostalCodes", "builderConfig", "buttonText", "countdownMinutes", "currencySymbol", "enabled", "headingText", "ipBlockingEnabled", "maxOrdersPerPhone", "orderTag", "otpEnabled", "phoneConfirmation", "shop", "showNotes", "showQuantity", "updatedAt" FROM "CodSettings";
DROP TABLE "CodSettings";
ALTER TABLE "new_CodSettings" RENAME TO "CodSettings";
CREATE TABLE "new_Upsell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Special offer',
    "type" TEXT NOT NULL DEFAULT 'bump',
    "offerKind" TEXT NOT NULL DEFAULT 'product',
    "offerProductId" TEXT NOT NULL DEFAULT '',
    "offerProductTitle" TEXT NOT NULL DEFAULT '',
    "offerVariantId" TEXT NOT NULL DEFAULT '',
    "offerHandle" TEXT NOT NULL DEFAULT '',
    "offerImage" TEXT NOT NULL DEFAULT '',
    "offerPrice" TEXT NOT NULL DEFAULT '',
    "offerProductCount" INTEGER NOT NULL DEFAULT 0,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "discountId" TEXT NOT NULL DEFAULT '',
    "discountCode" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Upsell" ("createdAt", "discountPercent", "enabled", "id", "minQuantity", "offerHandle", "offerImage", "offerKind", "offerPrice", "offerProductCount", "offerProductId", "offerProductTitle", "offerVariantId", "shop", "title", "type") SELECT "createdAt", "discountPercent", "enabled", "id", "minQuantity", "offerHandle", "offerImage", "offerKind", "offerPrice", "offerProductCount", "offerProductId", "offerProductTitle", "offerVariantId", "shop", "title", "type" FROM "Upsell";
DROP TABLE "Upsell";
ALTER TABLE "new_Upsell" RENAME TO "Upsell";
CREATE INDEX "Upsell_shop_idx" ON "Upsell"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CodOrder_shop_period_idx" ON "CodOrder"("shop", "period");

