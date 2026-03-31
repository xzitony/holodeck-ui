-- CreateTable
CREATE TABLE "HoloDeckConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastSynced" DATETIME,
    "cachedJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "HoloDeckConfig_configId_key" ON "HoloDeckConfig"("configId");

-- CreateIndex
CREATE INDEX "HoloDeckConfig_isActive_idx" ON "HoloDeckConfig"("isActive");
