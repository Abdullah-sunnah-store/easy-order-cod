-- AlterTable
ALTER TABLE "CodSettings" ADD COLUMN     "recommendEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recommendLimit" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "thankYouCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "thankYouDiscountId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "thankYouEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "thankYouHeading" TEXT NOT NULL DEFAULT 'Thanks for your order!',
ADD COLUMN     "thankYouPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "thankYouRecommend" BOOLEAN NOT NULL DEFAULT true;

