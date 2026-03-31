-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Reservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "notes" TEXT,
    "isMaintenance" BOOLEAN NOT NULL DEFAULT false,
    "isCustomerDemo" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Reservation" ("createdAt", "endTime", "id", "isCustomerDemo", "isMaintenance", "notes", "startTime", "status", "title", "updatedAt", "userId") SELECT "createdAt", "endTime", "id", "isCustomerDemo", "isMaintenance", "notes", "startTime", "status", "title", "updatedAt", "userId" FROM "Reservation";
DROP TABLE "Reservation";
ALTER TABLE "new_Reservation" RENAME TO "Reservation";
CREATE INDEX "Reservation_startTime_endTime_idx" ON "Reservation"("startTime", "endTime");
CREATE INDEX "Reservation_userId_idx" ON "Reservation"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
