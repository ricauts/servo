// POST /api/catalog/runs — the MANUAL reprofile trigger (cat-08). An ADMIN
// action, not a tool: settings.manage-gated, accepts ONLY an existing
// dataSourceId (never a host or URL — a caller-chosen id against a stored
// host with only safeFetch behind it is SSRF by DataSource row), and is
// rate-limited to one run per source per catalog.manual.minIntervalMinutes.
// Absent from the tool registry and from MCP by construction: no tool
// wrapper exists for it anywhere.
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { manualTriggerAllowed } from "@/lib/catalog/freshness";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  // settings.manage is the admin surface; only ADMIN holds it in the flat
  // matrix, so this is both the permission and the role gate.
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { dataSourceId?: unknown } | null;
  const dataSourceId = typeof body?.dataSourceId === "string" ? body.dataSourceId.trim() : "";
  if (!dataSourceId || /:\/\/|:|\s|[?&]/.test(dataSourceId)) {
    return Response.json(
      { error: "dataSourceId must be an existing data source id — never a host or URL." },
      { status: 400 },
    );
  }

  // Only an EXISTING source: an unknown id is 404, not a run.
  const known = await db.catalogEntry.findFirst({
    where: { dataSourceId },
    select: { id: true },
  });
  const knownRun = await db.catalogRun.findFirst({
    where: { dataSourceId },
    select: { id: true },
  });
  if (!known && !knownRun) {
    return Response.json({ error: "No such data source." }, { status: 404 });
  }

  const lastManual = await db.catalogRun.findFirst({
    where: { dataSourceId, trigger: "MANUAL" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  if (!manualTriggerAllowed(lastManual?.startedAt ?? null, new Date())) {
    return Response.json(
      { error: "A manual run for this source started recently; wait for the interval." },
      { status: 429 },
    );
  }

  const run = await db.catalogRun.create({
    data: { dataSourceId, trigger: "MANUAL", tier: "TIER1", status: "RUNNING" },
    select: { id: true },
  });
  return Response.json({ runId: run.id }, { status: 201 });
}
