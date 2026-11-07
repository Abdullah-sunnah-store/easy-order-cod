-- AlterTable: monthly revenue and review-flag counts for the Analytics page.
ALTER TABLE "UsageCounter" ADD COLUMN "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "UsageCounter" ADD COLUMN "flagged" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: orders/create deliveries already handled (idempotency).
CREATE TABLE "ProcessedOrder" (
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedOrder_pkey" PRIMARY KEY ("shop","orderId")
);

-- CreateIndex
CREATE INDEX "ProcessedOrder_createdAt_idx" ON "ProcessedOrder"("createdAt");
