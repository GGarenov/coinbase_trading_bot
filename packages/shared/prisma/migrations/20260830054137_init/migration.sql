-- CreateTable
CREATE TABLE "Strategy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "defaultParams" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "StrategyConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "strategyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyConfig_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "strategyConfigId" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "initialQuoteBalance" DECIMAL NOT NULL,
    "initialBaseBalance" DECIMAL NOT NULL,
    "feeSchedule" JSONB NOT NULL,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "startedAt" DATETIME,
    "stoppedAt" DATETIME,
    "strategyState" JSONB,
    "resultsSummary" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Session_strategyConfigId_fkey" FOREIGN KEY ("strategyConfigId") REFERENCES "StrategyConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" DECIMAL,
    "stopPrice" DECIMAL,
    "size" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "exchangeOrderId" TEXT,
    "levelPrice" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledAt" DATETIME,
    CONSTRAINT "Order_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Fill" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "price" DECIMAL NOT NULL,
    "size" DECIMAL NOT NULL,
    "fee" DECIMAL NOT NULL,
    "feeRate" DECIMAL NOT NULL,
    "liquidity" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    CONSTRAINT "Fill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "buyFillId" INTEGER NOT NULL,
    "sellFillId" INTEGER NOT NULL,
    "costBasis" DECIMAL NOT NULL,
    "proceeds" DECIMAL NOT NULL,
    "feesTotal" DECIMAL NOT NULL,
    "pnl" DECIMAL NOT NULL,
    "openedAt" DATETIME NOT NULL,
    "closedAt" DATETIME NOT NULL,
    CONSTRAINT "Trade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Balance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "quoteBalance" DECIMAL NOT NULL,
    "baseBalance" DECIMAL NOT NULL,
    "equity" DECIMAL NOT NULL,
    CONSTRAINT "Balance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MissedFill" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "levelPrice" DECIMAL NOT NULL,
    "side" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    CONSTRAINT "MissedFill_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceCandleCache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" TEXT NOT NULL,
    "granularity" TEXT NOT NULL,
    "openTime" DATETIME NOT NULL,
    "open" DECIMAL NOT NULL,
    "high" DECIMAL NOT NULL,
    "low" DECIMAL NOT NULL,
    "close" DECIMAL NOT NULL,
    "volume" DECIMAL NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_slug_key" ON "Strategy"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCandleCache_productId_granularity_openTime_key" ON "PriceCandleCache"("productId", "granularity", "openTime");
