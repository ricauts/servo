import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { parseSkillMarkdown } from "@/lib/skills";
import { slugify } from "@/lib/agent-profiles";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "skills.view");
  if (denied) return denied;

  const skills = await db.skill.findMany({ orderBy: { createdAt: "asc" } });
  return Response.json({ skills });
}

const createSchema = z.object({
  markdown: z.string().min(1, "The skill definition (SKILL.md) is required"),
  /** Optional: pin the slug the agent will use. Defaults to the name. */
  slug: z.string().optional(),
  /** Optional provenance (reb-05): the ticket this skill was distilled
   *  from. Must reference an existing ticket or NOTHING is written. */
  sourceTicketId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "skills.manage");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  let skill;
  try {
    skill = parseSkillMarkdown(parsed.data.markdown);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid skill document." },
      { status: 400 },
    );
  }

  // Provenance is validated before anything is written: an invalid id
  // writes nothing, not a half-created skill (reb-05).
  let sourceTicket: { id: string } | null = null;
  if (parsed.data.sourceTicketId) {
    sourceTicket = await db.ticket.findUnique({
      where: { id: parsed.data.sourceTicketId },
      select: { id: true },
    });
    if (!sourceTicket) {
      return Response.json(
        { error: "Source ticket not found — nothing was created." },
        { status: 400 },
      );
    }
  }

  const slug = slugify(parsed.data.slug?.trim() || skill.name);
  if (!slug) {
    return Response.json(
      { error: "The name must contain at least one letter or digit." },
      { status: 400 },
    );
  }
  const existing = await db.skill.findUnique({ where: { slug } });
  if (existing) {
    return Response.json(
      { error: `A skill with the slug "${slug}" already exists.` },
      { status: 409 },
    );
  }

  const created = await db.skill.create({
    data: {
      slug,
      name: skill.name,
      description: skill.description,
      categories: JSON.stringify(skill.categories),
      body: skill.body,
      markdown: parsed.data.markdown,
      ...(sourceTicket ? { sourceTicketId: sourceTicket.id } : {}),
      // A distilled skill is created disabled: nothing auto-enables, a
      // human reads the scaffold and flips the switch (reb-05).
      ...(sourceTicket ? { enabled: false } : {}),
    },
  });
  return Response.json({ skill: created }, { status: 201 });
}
