-- Refunds created before this migration get a unique placeholder key derived from their id.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "providerRefundId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Refund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Refund" ("idempotencyKey", "amountCents", "approvalRequestId", "chargeId", "createdAt", "currency", "customerEmail", "customerName", "id", "providerRefundId", "reason", "requestedById", "status", "updatedAt") SELECT 'legacy-' || "id", "amountCents", "approvalRequestId", "chargeId", "createdAt", "currency", "customerEmail", "customerName", "id", "providerRefundId", "reason", "requestedById", "status", "updatedAt" FROM "Refund";
DROP TABLE "Refund";
ALTER TABLE "new_Refund" RENAME TO "Refund";
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
CREATE INDEX "Refund_status_idx" ON "Refund"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
