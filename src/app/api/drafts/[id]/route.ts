import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { approveDraft, rejectDraft } from "@/lib/ai/draft";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  action: z.enum(["approve", "reject"]),
  body: z.string().max(20_000).optional(), // edited reply text (approve only)
});

/** PATCH /api/drafts/[id] — approve (and send) or reject an AI reply draft. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  const forbidden = forbid(user, "approval.decide");
  if (forbidden) return forbidden;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid draft decision payload." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const draft =
      parsed.data.action === "approve"
        ? await approveDraft(id, user, parsed.data.body)
        : await rejectDraft(id, user);
    return Response.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Draft decision failed.";
    const status = message.includes("not found") ? 404 : message.includes("no longer readable") ? 409 : 409;
    return Response.json({ error: message }, { status });
  }
}
