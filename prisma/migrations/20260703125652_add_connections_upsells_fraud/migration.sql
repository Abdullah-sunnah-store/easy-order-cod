-- CreateTable
CREATE TABLE "Connections" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "fbPixelId" TEXT NOT NULL DEFAULT '',
    "tiktokPixelId" TEXT NOT NULL DEFAULT '',
    "googleTagId" TEXT NOT NULL DEFAULT '',
    "snapPixelId" TEXT NOT NULL DEFAULT '',
    "pinterestTagId" TEXT NOT NULL DEFAULT '',
    "googleSheetsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "googleSheetUrl" TEXT NOT NULL DEFAULT '',
    "smsProvider" TEXT NOT NULL DEFAULT 'none',
    "smsApiKey" TEXT NOT NULL DEFAULT '',
    "smsSenderId" TEXT NOT NULL DEFAULT '',
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsappPhone" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Upsell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Special offer',
    "type" TEXT NOT NULL DEFAULT 'bump',
    "offerProductId" TEXT NOT NULL DEFAULT '',
    "offerProductTitle" TEXT NOT NULL DEFAULT '',
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CodSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "headingText" TEXT NOT NULL DEFAULT 'Order — Cash on Delivery',
    "buttonText" TEXT NOT NULL DEFAULT 'Order Now (Cash on Delivery)',
    "successMessage" TEXT NOT NULL DEFAULT 'Thank you! Your order has been placed. We''ll call you to confirm.',
    "orderTag" TEXT NOT NULL DEFAULT 'COD',
    "showName" BOOLEAN NOT NULL DEFAULT true,
    "showEmail" BOOLEAN NOT NULL DEFAULT false,
    "showPhone" BOOLEAN NOT NULL DEFAULT true,
    "showAddress" BOOLEAN NOT NULL DEFAULT true,
    "showCity" BOOLEAN NOT NULL DEFAULT true,
    "showQuantity" BOOLEAN NOT NULL DEFAULT true,
    "showNotes" BOOLEAN NOT NULL DEFAULT false,
    "otpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "phoneConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "ipBlockingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "blockedIps" TEXT NOT NULL DEFAULT '',
    "blockedPostalCodes" TEXT NOT NULL DEFAULT '',
    "maxOrdersPerPhone" INTEGER NOT NULL DEFAULT 0,
    "codFee" REAL NOT NULL DEFAULT 0,
    "shippingRate" REAL NOT NULL DEFAULT 0,
    "freeShippingThreshold" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CodSettings" ("buttonText", "enabled", "headingText", "orderTag", "shop", "showAddress", "showCity", "showEmail", "showName", "showNotes", "showPhone", "showQuantity", "successMessage", "updatedAt") SELECT "buttonText", "enabled", "headingText", "orderTag", "shop", "showAddress", "showCity", "showEmail", "showName", "showNotes", "showPhone", "showQuantity", "successMessage", "updatedAt" FROM "CodSettings";
DROP TABLE "CodSettings";
ALTER TABLE "new_CodSettings" RENAME TO "CodSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Upsell_shop_idx" ON "Upsell"("shop");
