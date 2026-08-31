import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { seal } from "@/lib/secret-store";
import {
  SOURCE_KINDS,
  SOURCE_MODE,
  SourceConfigError,
  assertConfigShape,
  assertNotServoDatabase,
  assertSecretNotServoDatabase,
  assertScopeExplicit,
  redactSource,
  sourceSecretKey,
  type SourceKind,
} from "@/lib/kb/sources";

export const dynamic = "force-dynamic";

/**
 * Data source administration (xds-01). Creating a connection is the whole
 * security decision — kind, non-secret config and an explicit scope — so it
 * sits behind kb.sources.manage; listing is a staff read behind
 * kb.sources.view.
 *
 * A source is created DISABLED and reaches nothing: the default scope is the
 * empty list, and the crawler (xds-03/xds-04) is not written yet. The share
 * panel and the rest of CRUD arrive with xds-09; this route exists because
 * two of this item's acceptance criteria are assertions about a RESPONSE
 * BODY, and a body needs a route.
 */
const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  kind: z.enum(SOURCE_KINDS),
  // Passed through the validators below rather than typed here: their
  // messages name the offending key, which is what the operator needs.
  config: z.unknown().default({}),
  scope: z.unknown().default([]),
  /** The credential itself. Sealed into a Setting and never echoed. Its
   *  encoding is the crawler's business (xds-03 defines the S3 shape); this
   *  route only ever handles it as an opaque string. */
  secret: z.string().min(1).max(8000).optional(),
  maxRows: z.number().int().positive().max(20000).optional(),
  syncEveryMin: z.number().int().min(0).max(10080).optional(),
});

function refusal(err: unknown): Response | null {
  if (err instanceof SourceConfigError) {
    return Response.json({ error: err.message, key: err.key }, { status: 400 });
  }
  return null;
}

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.sources.view");
  if (denied) return denied;

  const rows = await db.dataSource.findMany({ orderBy: { name: "asc" } });
  const refs = rows.map((r) => sourceSecretKey(r.id));
  const settings = refs.length
    ? await db.setting.findMany({ where: { key: { in: refs } }, select: { key: true } })
    : [];
  const present = new Set(settings.map((s) => s.key));
  return Response.json({
    sources: rows.map((r) => redactSource(r, present.has(sourceSecretKey(r.id)))),
  });
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
  const { name, kind, config, scope, secret, maxRows, syncEveryMin } = parsed.data;

  try {
    assertConfigShape(kind as SourceKind, config);
    assertScopeExplicit(scope, kind as SourceKind);
    // The guard that matters most, at save time. It is re-run at crawl time
    // (xds-04) because DATABASE_URL can change under a stored row. Both the
    // config and a credential that happens to be a whole DSN are checked —
    // the second is the field an operator reaches for when the first refuses.
    await assertNotServoDatabase(config as Record<string, unknown>);
    if (secret !== undefined) await assertSecretNotServoDatabase(secret);
  } catch (err) {
    const refused = refusal(err);
    if (refused) return refused;
    throw err;
  }

  const existing = await db.dataSource.findUnique({ where: { name } });
  if (existing) {
    return Response.json({ error: `A source named "${name}" already exists.` }, { status: 409 });
  }

  // secretRef is derived from the row's own id, so it is created and then
  // stamped. The credential — if one was posted — is sealed under that key.
  // `isSensitiveSettingKey` now recognises `datasource.<id>.secret`, so the
  // write boundary in src/lib/db.ts seals it too; the explicit seal() here is
  // idempotent and keeps the sealing true of the RAW client as well, which is
  // what the tests and any future non-extended writer hold.
  // The write is inside the same refusal path as the validators. The catalog
  // is the floor and the validators are meant to agree with it exactly, but
  // "meant to" is not a guarantee: any input the CHECKs refuse and the
  // validators let through would otherwise leave the transaction as an
  // unhandled Prisma error and a 500 with a stack, on what is usually a typo.
  // A refused write is a 400 naming the constraint, whichever layer refused.
  let created;
  try {
    created = await createSource(db, {
      name, kind, config, scope, secret, maxRows, syncEveryMin, createdById: user.id,
    });
  } catch (err) {
    const violated = catalogRefusal(err);
    if (violated) {
      return Response.json(
        {
          error: `The database refused this source (${violated}). Check the config and scope: a source carries flat, non-secret settings and an explicit scope with no wildcards.`,
          key: violated.includes("scope") ? "scopeJson" : "configJson",
        },
        { status: 400 },
      );
    }
    throw err;
  }

  return Response.json({ source: redactSource(created, secret !== undefined) }, { status: 201 });
}

/**
 * Whether a failed write was the CATALOG refusing the row, and which
 * constraint said so when the name survives. Prisma rewrites driver messages,
 * so the name is recovered where it can be and the refusal is still reported
 * where it cannot.
 *
 * The SQLSTATEs are the ones the catalog can raise on this table: 23514 is a
 * CHECK violation, 2203A/2203B come out of a jsonpath accessor, and 22P02 is a
 * malformed jsonb literal. Anything else — a dropped connection, a serialization
 * failure — is NOT a client error and is re-thrown, because answering a
 * database outage with 400 would be a lie.
 */
function catalogRefusal(err: unknown): string | null {
  const text = err instanceof Error ? err.message : String(err);
  if (!/\b(23514|2203A|2203B|22P02)\b|check constraint/i.test(text)) return null;
  const named = /"(DataSource_[A-Za-z_]+)"/.exec(text);
  return named ? named[1] : "a database constraint";
}

type CreateInput = {
  name: string;
  kind: string;
  config: unknown;
  scope: unknown;
  secret?: string;
  maxRows?: number;
  syncEveryMin?: number;
  createdById: string;
};

async function createSource(client: typeof db, input: CreateInput) {
  const { name, kind, config, scope, secret, maxRows, syncEveryMin, createdById } = input;
  return client.$transaction(async (tx) => {
    const row = await tx.dataSource.create({
      data: {
        name,
        kind,
        mode: SOURCE_MODE,
        configJson: config as never,
        scopeJson: scope as never,
        secretRef: "",
        createdById,
        ...(maxRows === undefined ? {} : { maxRows }),
        ...(syncEveryMin === undefined ? {} : { syncEveryMin }),
      },
    });
    const key = sourceSecretKey(row.id);
    if (secret !== undefined) {
      await tx.setting.upsert({
        where: { key },
        create: { key, value: seal(secret) },
        update: { value: seal(secret) },
      });
    }
    return tx.dataSource.update({ where: { id: row.id }, data: { secretRef: key } });
  });
}
