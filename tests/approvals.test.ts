import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createApprovalRequest, decideApproval, type ApprovalHandler } from "@/lib/platform/approvals";
import { ConflictError, ForbiddenError } from "@/lib/platform/errors";
import { asUser, ensureUsers } from "./helpers";

function fakeHandler() {
  return {
    summarize: () => "test",
    onApproved: vi.fn(async () => {}),
    onRejected: vi.fn(async () => {}),
  } satisfies ApprovalHandler;
}

async function newRequest(requester = asUser("both")) {
  return createApprovalRequest(prisma, {
    entityType: "Widget",
    entityId: `w_${Math.random()}`,
    payload: { size: 3 },
    requestedBy: requester,
  });
}

describe("generic maker-checker approvals", () => {
  beforeAll(ensureUsers);

  it("creating a request is audited", async () => {
    const r = await newRequest();
    const logs = await prisma.auditLog.findMany({ where: { entityId: r.id } });
    expect(logs.map((l) => l.action)).toEqual(["approval.requested"]);
  });

  it("the requester can never approve their own request, even with the approver role", async () => {
    const r = await newRequest(asUser("both"));
    const handler = fakeHandler();
    await expect(
      prisma.$transaction((tx) => decideApproval(tx, { requestId: r.id, decider: asUser("both"), decision: "approved", handlers: { Widget: handler } })),
    ).rejects.toThrow(ForbiddenError);
    expect(handler.onApproved).not.toHaveBeenCalled();
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("pending");
  });

  it("users without the approver role cannot decide", async () => {
    const r = await newRequest();
    await expect(
      prisma.$transaction((tx) => decideApproval(tx, { requestId: r.id, decider: asUser("reviewer2"), decision: "approved", handlers: { Widget: fakeHandler() } })),
    ).rejects.toThrow(ForbiddenError);
  });

  it("a different approver can approve; the app handler runs with the payload", async () => {
    const r = await newRequest();
    const handler = fakeHandler();
    const { after } = await prisma.$transaction((tx) =>
      decideApproval(tx, { requestId: r.id, decider: asUser("approver"), decision: "approved", handlers: { Widget: handler } }),
    );
    expect(after.status).toBe("approved");
    expect(after.approvedById).toBe("t_approver");
    expect(handler.onApproved).toHaveBeenCalledOnce();
    expect(handler.onApproved.mock.calls[0]).toBeDefined();
  });

  it("a request can only be decided once", async () => {
    const r = await newRequest();
    const handlers = { Widget: fakeHandler() };
    await prisma.$transaction((tx) => decideApproval(tx, { requestId: r.id, decider: asUser("approver"), decision: "rejected", handlers }));
    await expect(
      prisma.$transaction((tx) => decideApproval(tx, { requestId: r.id, decider: asUser("approver2"), decision: "approved", handlers })),
    ).rejects.toThrow(ConflictError);
    expect(handlers.Widget.onRejected).toHaveBeenCalledOnce();
    expect(handlers.Widget.onApproved).not.toHaveBeenCalled();
  });

  it("rolls back the decision if the app handler fails", async () => {
    const r = await newRequest();
    const handler = fakeHandler();
    handler.onApproved.mockRejectedValueOnce(new Error("provider down"));
    await expect(
      prisma.$transaction((tx) => decideApproval(tx, { requestId: r.id, decider: asUser("approver"), decision: "approved", handlers: { Widget: handler } })),
    ).rejects.toThrow("provider down");
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("pending");
  });
});
