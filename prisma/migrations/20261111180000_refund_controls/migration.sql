-- AlterTable
ALTER TABLE "Refund" ADD COLUMN "approvalRule" TEXT;
ALTER TABLE "Refund" ADD COLUMN "approvalReason" TEXT;

-- Every refund that went to approval before this change was caught by the single-amount rule.
UPDATE "Refund"
SET "approvalRule" = 'single_amount',
    "approvalReason" = 'Needs approval: refund amount is $500.00 or more'
WHERE "approvalRequestId" IS NOT NULL;
