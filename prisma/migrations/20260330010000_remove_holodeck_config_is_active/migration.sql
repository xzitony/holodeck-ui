-- DropIndex
DROP INDEX IF EXISTS "HoloDeckConfig_isActive_idx";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HoloDeckConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "lastSynced" DATETIME,
    "cachedJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_HoloDeckConfig" ("id", "configId", "description", "notes", "lastSynced", "cachedJson", "createdAt", "updatedAt") SELECT "id", "configId", "description", "notes", "lastSynced", "cachedJson", "createdAt", "updatedAt" FROM "HoloDeckConfig";
DROP TABLE "HoloDeckConfig";
ALTER TABLE "new_HoloDeckConfig" RENAME TO "HoloDeckConfig";
CREATE UNIQUE INDEX "HoloDeckConfig_configId_key" ON "HoloDeckConfig"("configId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
