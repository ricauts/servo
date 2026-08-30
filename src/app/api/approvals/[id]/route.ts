import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resumeAfterApproval } from "@/lib/ai/engine";
import { canDecideApproval, forbid } from "@/lib/permissions";
import { emitEvent } from "@/lib/webhooks";

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().optional(),
});

/** POST /api/approvals/[id] — decide a pending approval and resume the run. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  const forbidden = forbid(user, "approval.decide");
  if (forbidden) return forbidden;

  const body = await req.json().catch(() => null);
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid body: expected { decision: "APPROVED" | "REJECTED", reason? }.' },
      { status: 400 },
    );
  }

  const approval = await db.approval.findUnique({ where: { id } });
  if (!approval) {
    return Response.json({ error: "Approval not found" }, { status: 404 });
  }
  if (!canDecideApproval(user, approval.riskLevel)) {
    return Response.json(
      {
        error: `Your role (${user.role}) is not allowed to decide ${approval.riskLevel}-risk approvals.`,
      },
      { status: 403 },
    );
  }
  // Conditional write: WHERE status = "PENDING" is atomic, so of two
  // concurrent decisions (double-click, two tabs) exactly one claims the
  // approval and resumes the run; the other gets the 409.
  const claimed = await db.approval.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: parsed.data.decision,
      reason: parsed.data.reason?.trim() || null,
      decidedAt: new Date(),
      deciderId: user.id,
    },
  });
  if (claimed.count === 0) {
    return Response.json(
      { error: "This approval has already been decided." },
      { status: 409 },
    );
  }

  void emitEvent("approval.decided", {
    approvalId: id,
    ticketId: approval.ticketId,
    toolName: approval.toolName,
    riskLevel: approval.riskLevel,
    decision: parsed.data.decision,
    decidedBy: user.name,
    reason: parsed.data.reason?.trim() || null,
  });

  try {
    const run = await resumeAfterApproval(id);
    const fresh = await db.approval.findUnique({
      where: { id },
      include: { decider: true },
    });
    return Response.json({ approval: fresh, run });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resume the agent run.";
    return Response.json({ error: message }, { status: 500 });
  }
}
