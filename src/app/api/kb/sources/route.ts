import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { seal } from "@/lib/secret-store";
import {
  SourceValidationError,
  assertNotServoDatabase,
  isSourceKind,
  secretRefFor,
  sourceView,
  validateSourceConfig,
  validateSourceScope,
} from "@/lib/kb/sources";

export const dynamic = "force-dynamic";

/** Data-source administration (xds-01). Listing is behind kb.sources.view;
 *  creating one is behind kb.sources.manage. A created source is DISABLED
 *  and ungranted — dark to every human and every agent until someone shares
 *  it, which is the only safe default. */
const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  kind: z.string(),
  config: z.unknown().default({}),
  scope: z.unknown().default([]),
  /** The credential. It is sealed into its own Setting row and NEVER stored
   *  in configJson — the validator refuses that spelling by name. */
  secret: z.string().optional(),
  syncEveryMin: z.number().int().min(0).max(10_080).default(0),
  maxRows: z.number().int().min(1).max(20_000).default(20_000),
});

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.sources.view");
  if (denied) return denied;

  const rows = await db.dataSource.findMany({ orderBy: { name: "asc" } });
  const refs = rows.map((r) => r.secretRef).filter((r) => r !== "");
  const present = new Set(
    (await db.setting.findMany({ where: { key: { in: refs } }, select: { key: true } })).map((s) => s.key),
  );
  return Response.json({ sources: rows.map((r) => sourceView(r, present.has(r.secretRef))) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.sources.manage");
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  }
  const { name, kind, secret, syncEveryMin, maxRows } = parsed.data;
  if (!isSourceKind(kind)) {
    // Deliberately a vocabulary statement, not a capability claim: nothing
    // crawls anything yet (xds-03/xds-04 are unshipped), so "Servo indexes S3
    // and POSTGRES" would be user-visible copy asserting a capability that
    // does not exist — §0.8 rail 6.
    return Response.json({ error: `Unsupported source kind "${kind}". Supported kinds: S3, POSTGRES.` }, { status: 400 });
  }

  let config: Record<string, unknown>;
  let scope: Record<string, unknown>[];
  try {
    config = validateSourceConfig(kind, parsed.data.config ?? {});
    scope = validateSourceScope(kind, parsed.data.scope ?? []);
    // Before anything is written: a source that can read the desk is a path
    // around every knowledge-base grant.
    await assertNotServoDatabase(config);
  } catch (err) {
    if (err instanceof SourceValidationError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const existing = await db.dataSource.findUnique({ where: { name } });
  if (existing) {
    return Response.json({ error: `A data source named "${name}" already exists.` }, { status: 409 });
  }

  // Two steps in one transaction because secretRef names the row's own id.
  const source = await db.$transaction(async (tx) => {
    const created = await tx.dataSource.create({
      data: {
        name,
        kind,
        configJson: config as never,
        scopeJson: scope as never,
        secretRef: "",
        syncEveryMin,
        maxRows,
        createdById: user.id,
      },
    });
    // The credential goes to the sealed store, never to configJson. The key
    // is dynamic, so src/lib/db.ts's SENSITIVE_SETTING_KEYS middleware cannot
    // cover it — seal() here is explicit, and whoever reads it (xds-03) must
    // call open() explicitly. secretRefFor()'s comment says the same thing
    // from the other side.
    const ref = secretRefFor(created.id);
    if (secret !== undefined && secret !== "") {
      await tx.setting.upsert({
        where: { key: ref },
        create: { key: ref, value: seal(secret) },
        update: { value: seal(secret) },
      });
    }
    return tx.dataSource.update({ where: { id: created.id }, data: { secretRef: ref } });
  });

  return Response.json({ source: sourceView(source, secret !== undefined && secret !== "") }, { status: 201 });
}
