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
    "dialCodes" TEXT NOT NULL DEFAULT '+880,+91,+92,+977,+94,+971,+966,+60,+65,+44,+1',
    "otpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "phoneConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "ipBlockingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "blockedIps" TEXT NOT NULL DEFAULT '',
    "blockedPostalCodes" TEXT NOT NULL DEFAULT '',
    "maxOrdersPerPhone" INTEGER NOT NULL DEFAULT 0,
    "codFee" REAL NOT NULL DEFAULT 0,
    "shippingRate" REAL NOT NULL DEFAULT 0,
    "freeShippingThreshold" REAL NOT NULL DEFAULT 0,
    "currencySymbol" TEXT NOT NULL DEFAULT '',
    "countdownMinutes" INTEGER NOT NULL DEFAULT 0,
    "shippingOptions" TEXT NOT NULL DEFAULT '[]',
    "builderConfig" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CodSettings" ("blockedIps", "blockedPostalCodes", "builderConfig", "buttonText", "codFee", "countdownMinutes", "currencySymbol", "enabled", "freeShippingThreshold", "headingText", "ipBlockingEnabled", "maxOrdersPerPhone", "orderTag", "otpEnabled", "phoneConfirmation", "shippingOptions", "shippingRate", "shop", "showAddress", "showCity", "showEmail", "showName", "showNotes", "showPhone", "showQuantity", "successMessage", "updatedAt") SELECT "blockedIps", "blockedPostalCodes", "builderConfig", "buttonText", "codFee", "countdownMinutes", "currencySymbol", "enabled", "freeShippingThreshold", "headingText", "ipBlockingEnabled", "maxOrdersPerPhone", "orderTag", "otpEnabled", "phoneConfirmation", "shippingOptions", "shippingRate", "shop", "showAddress", "showCity", "showEmail", "showName", "showNotes", "showPhone", "showQuantity", "successMessage", "updatedAt" FROM "CodSettings";
DROP TABLE "CodSettings";
ALTER TABLE "new_CodSettings" RENAME TO "CodSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
