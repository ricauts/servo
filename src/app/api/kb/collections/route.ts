import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";
import { humanChainCte } from "@/lib/kb/entitlement";

export const dynamic = "force-dynamic";

/** Collection administration (kb-17): create/list behind kb.manage. The
 *  list is entitlement-scoped for non-managers through the human chain. */
const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  description: z.string().trim().max(500).default(""),
});

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.view");
  if (denied) return denied;

  // Entitled document counts per collection — the same scoping the tool and
  // the UI list use; a collection with zero readable documents is omitted.
  const rows = await db.$queryRawUnsafe<{ id: string; name: string; description: string; n: bigint }[]>(
    `${humanChainCte(user.id)}
     SELECT c.id, c.name, c.description, count(e.id) AS n
       FROM "Collection" c
       JOIN "Document" d ON d."collectionId" = c.id
       JOIN entitled e ON e.id = d.id
      GROUP BY c.id, c.name, c.description
      HAVING count(e.id) > 0
      ORDER BY c.name`,
  );
  return Response.json({
    collections: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      documentCount: Number(r.n),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.manage");
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  }
  const existing = await db.collection.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return Response.json({ error: `A collection named "${parsed.data.name}" already exists.` }, { status: 409 });
  }
  const collection = await db.collection.create({ data: parsed.data });
  return Response.json({ collection }, { status: 201 });
}
