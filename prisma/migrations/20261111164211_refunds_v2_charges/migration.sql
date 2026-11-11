-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "amountRefundedCents" INTEGER NOT NULL DEFAULT 0,
    "amountPendingCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backfill: every existing refund needs a charge to point at. Create one per charge id,
-- sized so the refunds already issued against it fit within the original amount.
INSERT INTO "Charge" ("id", "customerName", "customerEmail", "description", "amountCents", "currency", "amountRefundedCents", "amountPendingCents", "createdAt")
SELECT
    "chargeId",
    MIN("customerName"),
    MIN("customerEmail"),
    'Imported from refund history',
    MAX(1, SUM(CASE WHEN "status" IN ('rejected', 'failed') THEN 0 ELSE "amountCents" END)),
    MIN("currency"),
    SUM(CASE WHEN "status" = 'executed' THEN "amountCents" ELSE 0 END),
    SUM(CASE WHEN "status" IN ('pending_approval', 'processing') THEN "amountCents" ELSE 0 END),
    MIN("createdAt")
FROM "Refund"
GROUP BY "chargeId";

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
    "note" TEXT,
    "status" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "providerRefundId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Refund_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Refund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Free-text reasons become reason codes; the original text is kept as the internal note.
INSERT INTO "new_Refund" ("amountCents", "approvalRequestId", "chargeId", "createdAt", "currency", "customerEmail", "customerName", "id", "idempotencyKey", "providerRefundId", "reason", "note", "requestedById", "status", "updatedAt")
SELECT "amountCents", "approvalRequestId", "chargeId", "createdAt", "currency", "customerEmail", "customerName", "id", "idempotencyKey", "providerRefundId",
    CASE
        WHEN lower("reason") LIKE '%duplicate%' THEN 'duplicate'
        WHEN lower("reason") LIKE '%fraud%' THEN 'fraudulent'
        WHEN lower("reason") LIKE '%not delivered%' THEN 'service_not_delivered'
        WHEN lower("reason") LIKE '%goodwill%' THEN 'goodwill'
        ELSE 'requested_by_customer'
    END,
    "reason", "requestedById", "status", "updatedAt"
FROM "Refund";
DROP TABLE "Refund";
ALTER TABLE "new_Refund" RENAME TO "Refund";
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
CREATE INDEX "Refund_status_idx" ON "Refund"("status");
CREATE INDEX "Refund_chargeId_idx" ON "Refund"("chargeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Charge_customerEmail_idx" ON "Charge"("customerEmail");
