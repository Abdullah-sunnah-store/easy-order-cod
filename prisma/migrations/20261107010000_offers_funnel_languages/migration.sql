-- AlterTable
ALTER TABLE "CodSettings" ADD COLUMN     "downsellCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "downsellDiscountId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "downsellEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "downsellPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "templateId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "translations" TEXT NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Connections" ADD COLUMN     "productPixels" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Upsell" ADD COLUMN     "discountId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "triggerProductIds" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "triggerTitles" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "QuantityOffer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Quantity offer',
    "productIds" TEXT NOT NULL DEFAULT '[]',
    "productTitles" TEXT NOT NULL DEFAULT '[]',
    "tiers" TEXT NOT NULL DEFAULT '[]',
    "discountIds" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuantityOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelStat" (
    "shop" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "opens" INTEGER NOT NULL DEFAULT 0,
    "checkouts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelStat_pkey" PRIMARY KEY ("shop","day")
);

-- CreateIndex
CREATE INDEX "QuantityOffer_shop_idx" ON "QuantityOffer"("shop");

