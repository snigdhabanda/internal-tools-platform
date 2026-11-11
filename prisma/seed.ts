import { faker } from "@faker-js/faker";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
faker.seed(20261111);

const USERS = [
  { id: "u_alice", name: "Alice Chen", email: "alice@fintech.example", roles: "reviewer" },
  { id: "u_bob", name: "Bob Martinez", email: "bob@fintech.example", roles: "reviewer" },
  { id: "u_carol", name: "Carol Okafor", email: "carol@fintech.example", roles: "approver" },
  { id: "u_dave", name: "Dave Singh", email: "dave@fintech.example", roles: "approver" },
  { id: "u_frank", name: "Frank Weber", email: "frank@fintech.example", roles: "reviewer,approver" },
  { id: "u_erin", name: "Erin Park", email: "erin@fintech.example", roles: "admin" },
];

const REFUND_REASONS = [
  "Duplicate charge",
  "Service not delivered",
  "Customer cancelled within trial",
  "Fraudulent transaction reported",
  "Billing error: wrong plan tier",
  "Goodwill credit after outage",
  "Chargeback pre-emption",
];

// Area numbers 900-999 are never issued by the SSA, so these can't collide with real SSNs.
const fakeSsn = () =>
  `${faker.number.int({ min: 900, max: 999 })}-${faker.string.numeric(2)}-${faker.string.numeric(4)}`;

const SYSTEM = "system:seed";

// Mirrors refundAuditSnapshot: customer details stay out of the audit log.
function withoutCustomer<T extends { customerName: string; customerEmail: string }>(row: T): Partial<T> {
  const snapshot: Partial<T> = { ...row };
  delete snapshot.customerName;
  delete snapshot.customerEmail;
  return snapshot;
}

async function seedAudit(entityType: string, entityId: string, after: unknown, at: Date) {
  await prisma.auditLog.create({
    data: { actorId: SYSTEM, action: "seed.created", entityType, entityId, after: JSON.stringify(after), timestamp: at },
  });
}

async function main() {
  for (const u of USERS) await prisma.user.create({ data: u });

  const reviewers = ["u_alice", "u_bob", "u_frank"];

  for (let i = 0; i < 14; i++) {
    const createdAt = faker.date.recent({ days: 30 });
    const big = i % 5 === 0;
    const amountCents = big
      ? faker.number.int({ min: 500_00, max: 2_500_00 })
      : faker.number.int({ min: 5_00, max: 499_99 });
    const status = big ? (i === 0 ? "rejected" : "executed") : "executed";
    const refund = await prisma.refund.create({
      data: {
        idempotencyKey: faker.string.uuid(),
        customerName: faker.person.fullName(),
        customerEmail: faker.internet.email().toLowerCase(),
        chargeId: `ch_${faker.string.alphanumeric(14)}`,
        amountCents,
        reason: faker.helpers.arrayElement(REFUND_REASONS),
        status,
        requestedById: faker.helpers.arrayElement(reviewers),
        providerRefundId: status === "executed" ? `re_${faker.string.alphanumeric(14)}` : null,
        createdAt,
      },
    });
    await seedAudit("Refund", refund.id, withoutCustomer(refund), createdAt);
  }

  // One large refund already waiting for a checker, requested by Alice.
  const pending = await prisma.refund.create({
    data: {
      idempotencyKey: faker.string.uuid(),
      customerName: "Priya Raman",
      customerEmail: "priya.raman@example.com",
      chargeId: "ch_3PqRsT9uVwXyZ1",
      amountCents: 750_00,
      reason: "Annual plan cancelled within 14-day window",
      status: "pending_approval",
      requestedById: "u_alice",
    },
  });
  const approval = await prisma.approvalRequest.create({
    data: {
      entityType: "Refund",
      entityId: pending.id,
      requestedById: "u_alice",
      payload: JSON.stringify({ refundId: pending.id, chargeId: pending.chargeId, amountCents: pending.amountCents, currency: "usd" }),
    },
  });
  await prisma.refund.update({ where: { id: pending.id }, data: { approvalRequestId: approval.id } });
  await seedAudit("Refund", pending.id, withoutCustomer(pending), new Date());
  await seedAudit("ApprovalRequest", approval.id, approval, new Date());

  const statuses = [
    ...Array(8).fill("submitted"),
    "in_review",
    "in_review",
    "escalated",
    "escalated",
    "approved",
    "approved",
    "rejected",
  ];
  for (const status of statuses) {
    const createdAt = faker.date.recent({ days: 14 });
    const claimed = status !== "submitted";
    const kycCase = await prisma.kycCase.create({
      data: {
        applicantName: faker.person.fullName(),
        email: faker.internet.email().toLowerCase(),
        dateOfBirth: faker.date.birthdate({ min: 18, max: 80, mode: "age" }).toISOString().slice(0, 10),
        country: faker.helpers.arrayElement(["US", "US", "US", "CA", "GB"]),
        ssn: fakeSsn(),
        idType: faker.helpers.arrayElement(["drivers_license", "passport", "state_id"]),
        idNumber: faker.string.alphanumeric({ length: 9, casing: "upper" }),
        status,
        assignedToId: claimed ? faker.helpers.arrayElement(["u_alice", "u_bob"]) : null,
        escalatedById: status === "escalated" ? "u_bob" : null,
        vendorCheckId: claimed ? `chk_${faker.string.alphanumeric(8).toLowerCase()}` : null,
        vendorResult: claimed ? faker.helpers.arrayElement(["clear", "consider"]) : null,
        riskScore: claimed ? faker.number.int({ min: 1, max: 99 }) : null,
        createdAt,
      },
    });
    await seedAudit("KycCase", kycCase.id, { status: kycCase.status }, createdAt);
  }

  console.log(`Seeded ${USERS.length} users, 15 refunds, ${statuses.length} KYC cases.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
