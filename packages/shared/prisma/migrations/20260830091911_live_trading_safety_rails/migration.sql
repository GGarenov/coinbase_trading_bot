-- AlterTable
ALTER TABLE "Session" ADD COLUMN "maxPositionSize" DECIMAL;
ALTER TABLE "Session" ADD COLUMN "maxSpendPerOrder" DECIMAL;

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "liveTradingKillSwitch" BOOLEAN NOT NULL DEFAULT false
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" DECIMAL,
    "stopPrice" DECIMAL,
    "size" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "exchangeOrderId" TEXT,
    "levelPrice" DECIMAL,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledAt" DATETIME,
    CONSTRAINT "Order_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("createdAt", "exchangeOrderId", "filledAt", "id", "levelPrice", "price", "sessionId", "side", "size", "status", "stopPrice", "type") SELECT "createdAt", "exchangeOrderId", "filledAt", "id", "levelPrice", "price", "sessionId", "side", "size", "status", "stopPrice", "type" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
