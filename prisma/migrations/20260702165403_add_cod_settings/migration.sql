-- CreateTable
CREATE TABLE "CodSettings" (
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
    "updatedAt" DATETIME NOT NULL
);
