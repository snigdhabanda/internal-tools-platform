-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KycCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicantName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "dateOfBirth" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "isUSPerson" BOOLEAN NOT NULL,
    "idType" TEXT NOT NULL,
    "idNumber" TEXT NOT NULL,
    "idCountry" TEXT,
    "idExpiry" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "assignedToId" TEXT,
    "escalatedById" TEXT,
    "vendorCheckId" TEXT,
    "identityCheck" TEXT,
    "documentCheck" TEXT,
    "sanctionsCheck" TEXT,
    "pepCheck" TEXT,
    "riskScore" INTEGER,
    "decisionReason" TEXT,
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "approvalRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KycCase_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Backfill pre-CIP rows. US residents become US persons identified by their SSN (TIN); everyone
-- else keeps their passport/ID number with the residence country as issuing country, and their SSN
-- is dropped (non-US persons must not carry one). Addresses were never captured, so they're marked.
-- A legacy "consider" result doesn't say which check flagged, so all four become needs_review.
INSERT INTO "new_KycCase" (
    "id", "applicantName", "email", "dateOfBirth", "addressLine1", "city", "region", "postalCode", "country", "isUSPerson",
    "idType", "idNumber", "idCountry", "status", "assignedToId", "escalatedById", "vendorCheckId",
    "identityCheck", "documentCheck", "sanctionsCheck", "pepCheck", "riskScore", "createdAt", "updatedAt")
SELECT
    "id", "applicantName", "email", "dateOfBirth", 'Not captured (pre-CIP record)', '', '', '', "country", "country" = 'US',
    CASE WHEN "country" = 'US' THEN 'ssn' WHEN "idType" = 'passport' THEN 'passport' ELSE 'other_gov_id' END,
    CASE WHEN "country" = 'US' THEN "ssn" ELSE "idNumber" END,
    CASE WHEN "country" = 'US' THEN NULL ELSE "country" END,
    "status", "assignedToId", "escalatedById", "vendorCheckId",
    CASE "vendorResult" WHEN 'clear' THEN 'pass' WHEN 'consider' THEN 'needs_review' END,
    CASE "vendorResult" WHEN 'clear' THEN 'pass' WHEN 'consider' THEN 'needs_review' END,
    CASE "vendorResult" WHEN 'clear' THEN 'pass' WHEN 'consider' THEN 'needs_review' END,
    CASE "vendorResult" WHEN 'clear' THEN 'pass' WHEN 'consider' THEN 'needs_review' END,
    "riskScore", "createdAt", "updatedAt"
FROM "KycCase";
DROP TABLE "KycCase";
ALTER TABLE "new_KycCase" RENAME TO "KycCase";
CREATE INDEX "KycCase_status_idx" ON "KycCase"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CIP records must be retained: cases can never be deleted.
CREATE TRIGGER "KycCase_no_delete"
BEFORE DELETE ON "KycCase"
BEGIN
    SELECT RAISE(ABORT, 'KycCase records cannot be deleted');
END;
