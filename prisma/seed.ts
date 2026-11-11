import { faker } from "@faker-js/faker";
import { PrismaClient, type Charge } from "@prisma/client";

const prisma = new PrismaClient();
faker.seed(20261111);

/** A fake person whose email is derived from their name, e.g. adam.rutherford@gmail.com. */
function fakePerson() {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  return { name: `${firstName} ${lastName}`, email: faker.internet.email({ firstName, lastName }).toLowerCase() };
}

const USERS = [
  { id: "u_alice", name: "Alice Chen", email: "alice@fintech.example", roles: "reviewer" },
  { id: "u_bob", name: "Bob Martinez", email: "bob@fintech.example", roles: "reviewer" },
  { id: "u_carol", name: "Carol Okafor", email: "carol@fintech.example", roles: "approver" },
  { id: "u_dave", name: "Dave Singh", email: "dave@fintech.example", roles: "approver" },
  { id: "u_frank", name: "Frank Weber", email: "frank@fintech.example", roles: "reviewer,approver" },
  { id: "u_erin", name: "Erin Park", email: "erin@fintech.example", roles: "admin" },
];

const REFUND_REASONS = ["duplicate", "fraudulent", "requested_by_customer", "service_not_delivered", "goodwill"] as const;
const NOTES = [
  "Customer emailed support twice about this.",
  "Confirmed with billing: plan was downgraded mid-cycle.",
  "Charged twice by retry logic during the outage.",
  null,
  null,
];
const PRODUCTS = [
  ["Pro plan · monthly", 49_00, 99_00],
  ["Pro plan · annual", 480_00, 1_188_00],
  ["Business plan · annual", 2_400_00, 4_800_00],
  ["Card issuance fee", 15_00, 45_00],
  ["Wire transfer fee", 25_00, 75_00],
  ["Invoice payment", 150_00, 2_500_00],
  ["Add-on: extra seats", 60_00, 600_00],
] as const;

// Area numbers 900-999 are never issued by the SSA, so these can't collide with real SSNs.
const fakeSsn = () =>
  `${faker.number.int({ min: 900, max: 999 })}-${faker.string.numeric(2)}-${faker.string.numeric(4)}`;

const SYSTEM = "system:seed";
const HOUR = 3_600_000;
const now = new Date();
const ago = (ms: number) => new Date(now.getTime() - ms);
const chargeId = () => `ch_${faker.string.alphanumeric(14)}`;

type RefundRow = Awaited<ReturnType<typeof prisma.refund.create>>;

// Mirrors refundAuditSnapshot: customer details stay out of the audit log.
function withoutCustomer<T extends { customerName: string; customerEmail: string }>(row: T): Partial<T> {
  const snapshot: Partial<T> = { ...row };
  delete snapshot.customerName;
  delete snapshot.customerEmail;
  return snapshot;
}

async function log(actorId: string, action: string, entityType: string, entityId: string, at: Date, after: unknown, before?: unknown) {
  await prisma.auditLog.create({
    data: { actorId, action, entityType, entityId, before: before ? JSON.stringify(before) : null, after: JSON.stringify(after), timestamp: at },
  });
}

/**
 * Creates a refund against a charge with a realistic audit trail (the same events the API writes),
 * and keeps the charge's refunded/pending balances consistent.
 */
async function seedRefund(opts: {
  charge: { id: string; customerName: string; customerEmail: string };
  amountCents: number;
  requestedById: string;
  at: Date;
  outcome: "executed" | "pending_approval" | "rejected";
  approverId?: string;
  rejectionReason?: string;
  reason?: (typeof REFUND_REASONS)[number];
}) {
  const needsApproval = opts.amountCents >= 500_00;
  const decidedAt = new Date(opts.at.getTime() + faker.number.int({ min: 1, max: 6 }) * HOUR);
  const created = await prisma.refund.create({
    data: {
      idempotencyKey: faker.string.uuid(),
      customerName: opts.charge.customerName,
      customerEmail: opts.charge.customerEmail,
      chargeId: opts.charge.id,
      amountCents: opts.amountCents,
      reason: opts.reason ?? faker.helpers.arrayElement(REFUND_REASONS),
      note: faker.helpers.arrayElement(NOTES),
      status: needsApproval ? "pending_approval" : "processing",
      requestedById: opts.requestedById,
      createdAt: opts.at,
    },
  });
  await log(opts.requestedById, "refund.requested", "Refund", created.id, opts.at, withoutCustomer(created));
  let refund: RefundRow = created;

  if (needsApproval) {
    const approval = await prisma.approvalRequest.create({
      data: {
        entityType: "Refund",
        entityId: created.id,
        requestedById: opts.requestedById,
        payload: JSON.stringify({ refundId: created.id, chargeId: created.chargeId, amountCents: created.amountCents, currency: "usd" }),
        createdAt: opts.at,
      },
    });
    await log(opts.requestedById, "approval.requested", "ApprovalRequest", approval.id, opts.at, approval);
    refund = await prisma.refund.update({ where: { id: created.id }, data: { approvalRequestId: approval.id } });

    if (opts.outcome !== "pending_approval") {
      const approved = opts.outcome === "executed";
      const decided = await prisma.approvalRequest.update({
        where: { id: approval.id },
        data: {
          status: approved ? "approved" : "rejected",
          approvedById: approved ? opts.approverId : null,
          rejectedById: approved ? null : opts.approverId,
          decisionNote: approved ? null : opts.rejectionReason,
          decidedAt,
          updatedAt: decidedAt,
        },
      });
      await log(opts.approverId!, `approval.${decided.status}`, "ApprovalRequest", approval.id, decidedAt, decided, approval);
    }
  }

  if (opts.outcome === "pending_approval") {
    await prisma.charge.update({ where: { id: opts.charge.id }, data: { amountPendingCents: { increment: opts.amountCents } } });
    return refund;
  }
  const actor = needsApproval ? opts.approverId! : opts.requestedById;
  const at = needsApproval ? decidedAt : opts.at;
  const before = refund;
  refund = await prisma.refund.update({
    where: { id: created.id },
    data:
      opts.outcome === "executed"
        ? { status: "executed", providerRefundId: `re_${faker.string.alphanumeric(14)}`, updatedAt: at }
        : { status: "rejected", updatedAt: at },
  });
  await log(actor, `refund.${refund.status}`, "Refund", created.id, at, withoutCustomer(refund), withoutCustomer(before));
  if (opts.outcome === "executed") {
    await prisma.charge.update({ where: { id: opts.charge.id }, data: { amountRefundedCents: { increment: opts.amountCents } } });
  }
  return refund;
}

async function main() {
  for (const u of USERS) await prisma.user.create({ data: u });

  const reviewers = ["u_alice", "u_bob", "u_frank"];
  const approvers = ["u_carol", "u_dave"];

  // ---- Charges: the payment processor's record of what customers paid. ----
  const charges: Charge[] = [];
  for (let i = 0; i < 48; i++) {
    const person = fakePerson();
    const [description, min, max] = faker.helpers.arrayElement(PRODUCTS);
    charges.push(
      await prisma.charge.create({
        data: {
          id: chargeId(),
          customerName: person.name,
          customerEmail: person.email,
          description,
          amountCents: faker.number.int({ min, max }),
          createdAt: faker.date.recent({ days: 60 }),
        },
      }),
    );
  }
  const priya = await prisma.charge.create({
    data: { id: "ch_3PqRsT9uVwXyZ1", customerName: "Priya Raman", customerEmail: "priya.raman@example.com", description: "Business plan · annual", amountCents: 2_400_00, createdAt: ago(9 * 24 * HOUR) },
  });

  // ---- Refund history: full and partial refunds, approvals and rejections. ----
  const pick = (i: number) => charges[i];
  const days = (n: number) => n * 24 * HOUR;
  let refundCount = 0;
  const refund = async (args: Parameters<typeof seedRefund>[0]) => {
    refundCount++;
    return seedRefund(args);
  };

  // Small refunds that executed immediately, spread over the last month (some today).
  for (let i = 0; i < 14; i++) {
    const c = pick(i);
    const full = i % 3 === 0;
    await refund({
      charge: c,
      amountCents: full ? Math.min(c.amountCents, 499_99) : Math.round(Math.min(c.amountCents, 499_99) * faker.number.float({ min: 0.2, max: 0.6 })),
      requestedById: faker.helpers.arrayElement(reviewers),
      at: i < 3 ? ago(faker.number.int({ min: 1, max: 5 }) * HOUR) : ago(faker.number.int({ min: days(1), max: days(30) })),
      outcome: "executed",
    });
  }
  // A charge refunded in two partial installments.
  const twice = charges.find((c, i) => i >= 14 && c.amountCents >= 300_00)!;
  await refund({ charge: twice, amountCents: Math.round(twice.amountCents * 0.25), requestedById: "u_bob", at: ago(days(12)), outcome: "executed", reason: "service_not_delivered" });
  await refund({ charge: twice, amountCents: Math.round(twice.amountCents * 0.15), requestedById: "u_alice", at: ago(days(4)), outcome: "executed", reason: "goodwill" });

  // Large refunds approved by a checker.
  const large = charges.filter((c) => c.amountCents >= 700_00 && c.id !== twice.id).slice(0, 7);
  for (const [i, c] of large.slice(0, 4).entries()) {
    await refund({
      charge: c,
      amountCents: i % 2 === 0 ? c.amountCents : Math.max(500_00, Math.round(c.amountCents * 0.5)),
      requestedById: reviewers[i % reviewers.length],
      approverId: approvers[i % approvers.length],
      at: i === 0 ? ago(7 * HOUR) : ago(faker.number.int({ min: days(2), max: days(25) })),
      outcome: "executed",
    });
  }
  // Rejected by a checker, with the reason recorded.
  const rejections = ["Customer already received a chargeback for this charge.", "Outside the 30-day refund window; offered account credit instead."];
  for (const [i, c] of large.slice(4, 6).entries()) {
    await refund({ charge: c, amountCents: Math.max(500_00, Math.round(c.amountCents * 0.8)), requestedById: reviewers[i], approverId: "u_dave", rejectionReason: rejections[i], at: ago(days(3 + i * 5)), outcome: "rejected", reason: "requested_by_customer" });
  }

  // Waiting for a checker. Priya's (requested by Alice) has been waiting over 24 hours.
  await refund({ charge: priya, amountCents: 750_00, requestedById: "u_alice", at: ago(30 * HOUR), outcome: "pending_approval", reason: "requested_by_customer" });
  const bigPending = large[6] ?? charges.find((c) => c.amountCents >= 600_00 && !large.includes(c))!;
  await refund({ charge: bigPending, amountCents: Math.max(500_00, Math.round(bigPending.amountCents * 0.6)), requestedById: "u_bob", at: ago(3 * HOUR), outcome: "pending_approval", reason: "duplicate" });
  const framePending = charges.find((c) => c.amountCents >= 520_00 && !large.includes(c) && c.id !== twice.id && c.id !== bigPending.id && charges.indexOf(c) >= 14)!;
  await refund({ charge: framePending, amountCents: 520_00, requestedById: "u_frank", at: ago(0.5 * HOUR), outcome: "pending_approval", reason: "fraudulent" });

  // ---- KYC cases (CIP: name, DOB, address, TIN for US persons / passport or gov ID otherwise). ----
  const statuses = [...Array(7).fill("submitted"), "in_review", "in_review", "escalated", "escalated", "approved", "approved", "rejected", "pending_rejection"];
  const nonUs = [
    { country: "GB", region: "Greater London", city: "London" },
    { country: "CA", region: "Ontario", city: "Toronto" },
    { country: "DE", region: "Berlin", city: "Berlin" },
    { country: "MX", region: "CDMX", city: "Mexico City" },
  ];
  const checks = ["pass", "pass", "pass", "pass", "needs_review", "fail"] as const;
  for (const [i, status] of statuses.entries()) {
    const createdAt = faker.date.recent({ days: 14 });
    const claimed = status !== "submitted";
    const applicant = fakePerson();
    const us = i % 3 !== 1;
    const place = us ? { country: "US", region: faker.location.state({ abbreviated: true }), city: faker.location.city() } : nonUs[i % nonUs.length];
    const passport = !us && i % 2 === 0;
    // All-clear cases for the approved and pending-rejection examples; mixed results otherwise.
    const allClear = status === "approved" || status === "pending_rejection";
    const result = () => (allClear ? "pass" : faker.helpers.arrayElement(checks));
    const decided = ["approved", "rejected", "escalated", "pending_rejection"].includes(status);
    const decision = {
      approved: ["identity_verified", "All four checks passed; documents match application."],
      rejected: ["document_invalid_or_expired", "Passport scan expired; customer asked to resubmit."],
      escalated: ["potential_sanctions_match", "Name is a partial match on the OFAC SDN list; needs approver review."],
      pending_rejection: ["suspected_fraud", "Address belongs to a known mail-drop service despite clear checks."],
    }[status as string] ?? ["", ""];
    const kycCase = await prisma.kycCase.create({
      data: {
        applicantName: applicant.name,
        email: applicant.email,
        dateOfBirth: faker.date.birthdate({ min: 18, max: 80, mode: "age" }).toISOString().slice(0, 10),
        addressLine1: faker.location.streetAddress(),
        addressLine2: i % 4 === 0 ? faker.location.secondaryAddress() : null,
        city: place.city,
        region: place.region,
        postalCode: us ? faker.location.zipCode("#####") : faker.location.zipCode(),
        country: place.country,
        isUSPerson: us,
        idType: us ? "ssn" : passport ? "passport" : "other_gov_id",
        idNumber: us ? fakeSsn() : faker.string.alphanumeric({ length: 9, casing: "upper" }),
        idCountry: us ? null : place.country,
        idExpiry: passport ? faker.date.future({ years: 8 }).toISOString().slice(0, 10) : null,
        status,
        assignedToId: claimed ? faker.helpers.arrayElement(["u_alice", "u_bob"]) : null,
        escalatedById: status === "escalated" ? "u_bob" : null,
        vendorCheckId: claimed ? `chk_${faker.string.alphanumeric(8).toLowerCase()}` : null,
        identityCheck: claimed ? result() : null,
        documentCheck: claimed ? result() : null,
        sanctionsCheck: claimed ? (status === "escalated" ? "needs_review" : result()) : null,
        pepCheck: claimed ? result() : null,
        riskScore: claimed ? (allClear ? faker.number.int({ min: 3, max: 35 }) : faker.number.int({ min: 1, max: 99 })) : null,
        decisionReason: decided ? decision[0] : null,
        decisionNote: decided ? decision[1] : null,
        decidedById: decided ? (status === "approved" ? "u_alice" : "u_bob") : null,
        decidedAt: decided ? new Date(createdAt.getTime() + 2 * HOUR) : null,
        createdAt,
      },
    });
    await log(SYSTEM, "seed.created", "KycCase", kycCase.id, createdAt, { status: kycCase.status });
    if (status === "pending_rejection") {
      const approval = await prisma.approvalRequest.create({
        data: { entityType: "KycCase", entityId: kycCase.id, requestedById: kycCase.decidedById!, payload: JSON.stringify({ caseId: kycCase.id, reasonCode: decision[0], fromStatus: "in_review" }), createdAt: kycCase.decidedAt! },
      });
      await prisma.kycCase.update({ where: { id: kycCase.id }, data: { approvalRequestId: approval.id } });
      await log(kycCase.decidedById!, "approval.requested", "ApprovalRequest", approval.id, kycCase.decidedAt!, approval);
    }
  }

  console.log(`Seeded ${USERS.length} users, ${charges.length + 1} charges, ${refundCount} refunds, ${statuses.length} KYC cases.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
