-- Additive columns only: SQLite can ALTER TABLE ADD COLUMN when a default is
-- supplied (or the column is nullable), so no table rebuild is needed.
ALTER TABLE "CodSettings" ADD COLUMN "shippingMode" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "CodSettings" ADD COLUMN "shippingSynced" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "CodSettings" ADD COLUMN "shippingSyncedAt" DATETIME;
ALTER TABLE "CodSettings" ADD COLUMN "shippingAutoSync" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CodSettings" ADD COLUMN "shippingRulesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CodSettings" ADD COLUMN "shippingRules" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "CodSettings" ADD COLUMN "shippingFallbackPrice" REAL NOT NULL DEFAULT 0;
ALTER TABLE "CodSettings" ADD COLUMN "shippingFallbackLabel" TEXT NOT NULL DEFAULT 'Delivery charge';
