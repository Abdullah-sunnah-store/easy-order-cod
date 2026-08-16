-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodSettings" (
    "shop" TEXT NOT NULL,
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
    "codFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freeShippingThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currencySymbol" TEXT NOT NULL DEFAULT '',
    "countdownMinutes" INTEGER NOT NULL DEFAULT 0,
    "shippingOptions" TEXT NOT NULL DEFAULT '[]',
    "shippingMode" TEXT NOT NULL DEFAULT 'manual',
    "shippingSynced" TEXT NOT NULL DEFAULT '[]',
    "shippingSyncedAt" TIMESTAMP(3),
    "shippingAutoSync" BOOLEAN NOT NULL DEFAULT false,
    "shippingHiddenRates" TEXT NOT NULL DEFAULT '[]',
    "shippingRulesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "shippingRules" TEXT NOT NULL DEFAULT '[]',
    "shippingFallbackPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingFallbackLabel" TEXT NOT NULL DEFAULT 'Delivery charge',
    "builderConfig" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodSettings_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "Connections" (
    "shop" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connections_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "shop" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("shop","period")
);

-- CreateTable
CREATE TABLE "Upsell" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upsell_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Upsell_shop_idx" ON "Upsell"("shop");

