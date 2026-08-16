-- CreateTable
CREATE TABLE "UsageCounter" (
    "shop" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("shop", "period")
);
