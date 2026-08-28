// Pure parsing/validation and catalogue rendering for desk skills (no
// database) — shared by the API, the seed, the engine and the tools. A skill
// document is Markdown with YAML frontmatter (name, description, categories);
// the body is the procedure a resolver loads with read_skill.
//
// The shape is deliberately the same as an agent profile
// (src/lib/agent-profile-format.ts): a .md file in the repository is the
// source of truth, the database row is a cache of it, and the UI edits the
// same text. Skills differ in what they are FOR — a profile is who the agent
// is, a skill is what the desk has agreed to do about a class of problem.

import matter from "gray-matter";
import { CATEGORIES } from "@/lib/types";

/** The six portable Agent Skills frontmatter fields (agentskills.io). */
export type SkillParseMode = "strict" | "lenient";

export interface ParsedSkill {
  name: string;
  description: string;
  categories: string[];
  body: string;
  /** Portable Agent Skills fields, carried for round-tripping. */
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
  metadata?: Record<string, unknown>;
  /** Non-fatal notes from lenient parsing (dropped unknown categories, …). */
  warnings: string[];
}

/** One catalogue line: what the resolver picks from before reading a body. */
export interface SkillCatalogEntry {
  slug: string;
  name: string;
  description: string;
  categories: string[];
}

/**
 * How many skills are advertised in the resolver's system prompt. The
 * catalogue is name + description only, so this is generous, but it must be
 * bounded: an admin with 500 skills should not silently blow up every prompt.
 */
export const SKILL_CATALOG_LIMIT = 40;

/**
 * Descriptions may be documents now (imports must not fail on prose), but a
 * catalogue LINE is still a one-liner: the section below truncates to this
 * so the resolver prompt budget does not move when the parse limit rose.
 */
const DESCRIPTION_LIMIT = 1024;
const CATALOG_LINE_LIMIT = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse and validate a SKILL.md document. Throws with a human-readable
 * message the API returns verbatim to the admin who typed the document.
 *
 * `description` is required, unlike on an agent profile: it is the only thing
 * the resolver sees before deciding whether to spend a tool call reading the
 * body, so a skill without one is invisible in practice.
 *
 * Agent Skills compatibility (cnp-04): the six portable fields are accepted
 * (name, description, license, compatibility, metadata, allowed-tools) and
 * unknown extra frontmatter keys are tolerated, never fatal. Categories are
 * read from `metadata.categories` first, with top-level `categories:` as the
 * Servo legacy form. STRICT mode (the UI/API default) rejects unknown
 * category values exactly as before; LENIENT mode (import/plugin paths)
 * drops them with a warning so an external skill still loads.
 */
export function parseSkillMarkdown(
  markdown: string,
  { mode = "strict" }: { mode?: SkillParseMode } = {},
): ParsedSkill {
  const { data, content } = matter(markdown);
  const warnings: string[] = [];

  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) throw new Error("Frontmatter must include a non-empty `name`.");

  const description =
    typeof data.description === "string" ? data.description.trim() : "";
  if (!description) {
    throw new Error(
      "Frontmatter must include a non-empty `description` — it is the catalogue line the agent reads before loading the skill.",
    );
  }
  if (description.length > DESCRIPTION_LIMIT) {
    throw new Error(
      `\`description\` must be at most ${DESCRIPTION_LIMIT} characters; this one is ${description.length}.`,
    );
  }

  const metadata = isRecord(data.metadata) ? data.metadata : undefined;
  const fromMetadata =
    metadata && Array.isArray(metadata.categories)
      ? metadata.categories.map(String)
      : null;
  const fromTopLevel = Array.isArray(data.categories) ? data.categories.map(String) : null;
  const raw = fromMetadata ?? fromTopLevel ?? [];

  const categories: string[] = [];
  for (const c of raw) {
    if (CATEGORIES.includes(c as (typeof CATEGORIES)[number])) {
      categories.push(c);
    } else if (mode === "lenient") {
      warnings.push(`Dropped unknown category "${c}" (lenient import).`);
    } else {
      throw new Error(`Unknown category "${c}". Valid: ${CATEGORIES.join(", ")}.`);
    }
  }

  const body = content.trim();
  if (!body) {
    throw new Error("The document body (the procedure) cannot be empty.");
  }

  const license = typeof data.license === "string" && data.license.trim() ? data.license.trim() : undefined;
  const compatibility =
    typeof data.compatibility === "string" && data.compatibility.trim()
      ? data.compatibility.trim()
      : undefined;
  const allowedRaw = data["allowed-tools"];
  const allowedTools = Array.isArray(allowedRaw)
    ? allowedRaw.map(String).filter(Boolean)
    : typeof allowedRaw === "string" && allowedRaw.trim()
      ? allowedRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;

  return {
    name,
    description,
    categories,
    body,
    ...(license !== undefined ? { license } : {}),
    ...(compatibility !== undefined ? { compatibility } : {}),
    ...(allowedTools !== undefined ? { allowedTools } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    warnings,
  };
}

/**
 * Serialize back to SKILL.md in the Agent Skills portable form: exactly the
 * six portable fields (categories nested under `metadata`), then the body.
 * parse → serialize → parse is stable, so an imported skill round-trips.
 */
export function serializeSkillMarkdown(
  skill: Omit<ParsedSkill, "warnings">,
): string {
  const data: Record<string, unknown> = {
    name: skill.name,
    description: skill.description,
  };
  if (skill.license) data.license = skill.license;
  if (skill.compatibility) data.compatibility = skill.compatibility;
  const metadata: Record<string, unknown> = { ...(skill.metadata ?? {}) };
  if (skill.categories.length > 0) metadata.categories = [...skill.categories];
  if (Object.keys(metadata).length > 0) data.metadata = metadata;
  if (skill.allowedTools && skill.allowedTools.length > 0) {
    data["allowed-tools"] = [...skill.allowedTools];
  }
  return matter.stringify(`${skill.body}\n`, data);
}

/**
 * Whether a skill applies to a ticket in `category`. An empty `categories`
 * list means "every ticket" — that is how desk-wide policy (escalation rules,
 * tone, what never to touch) is written.
 */
export function skillAppliesTo(
  skill: { categories: string[] },
  category: string,
): boolean {
  return skill.categories.length === 0 || skill.categories.includes(category);
}

/**
 * Split a catalogue into the skills that apply to this ticket and the rest.
 * Both are advertised — an agent may legitimately reach for a skill outside
 * the ticket's category — but the applicable ones lead, and the remainder is
 * what SKILL_CATALOG_LIMIT trims first.
 */
export function orderCatalogFor(
  skills: SkillCatalogEntry[],
  category: string,
): SkillCatalogEntry[] {
  const applicable = skills.filter((s) => skillAppliesTo(s, category));
  const rest = skills.filter((s) => !skillAppliesTo(s, category));
  return [...applicable, ...rest].slice(0, SKILL_CATALOG_LIMIT);
}

/**
 * The "Desk skills" section of the resolver system prompt: the catalogue plus
 * the rule that binds it. Returns "" when there is nothing to advertise, so
 * the prompt of an install with no skills is byte-for-byte what it was before.
 *
 * Progressive disclosure on purpose (the Claude Code skills pattern): names
 * and descriptions are always in context, bodies cost a tool call.
 */
export function skillCatalogSection(
  skills: SkillCatalogEntry[],
  category: string,
): string {
  const ordered = orderCatalogFor(skills, category);
  if (ordered.length === 0) return "";
  const lines = ordered
    .map((s) => {
      const scope = s.categories.length === 0 ? "every ticket" : s.categories.join(", ");
      // A long description may be a document now; a catalogue LINE is not.
      // The prompt budget does not move when the parse limit rose (cnp-04).
      const line =
        s.description.length > CATALOG_LINE_LIMIT
          ? s.description.slice(0, CATALOG_LINE_LIMIT - 1) + "…"
          : s.description;
      return `- ${s.slug} (${scope}): ${line}`;
    })
    .join("\n");
  return `## Desk skills

Procedures this desk has agreed to follow. Read the relevant one with read_skill
BEFORE you act — the body contains the steps, the limits and the things never to
do. The slug is what read_skill takes.

${lines}

- If a skill covers this ticket, follow it.
- If you deliberately depart from a skill, say so and why in your comment to the
  requester; QA reviews the run against the skills that applied.
- A skill never overrides an approval gate: a tool that needs human approval
  still pauses for it, whatever the procedure says.`;
}

/**
 * The section QA reviews against: the applicable skills and whether the run
 * actually read them. Returns "" when no skill applied, so QA's judgement is
 * unchanged on installs and tickets where skills are not in play.
 */
export function skillReviewSection(
  skills: SkillCatalogEntry[],
  category: string,
  readSlugs: string[],
): string {
  const applicable = skills.filter((s) => skillAppliesTo(s, category));
  if (applicable.length === 0) return "";
  const read = new Set(readSlugs);
  const lines = applicable
    .map(
      (s) =>
        `- ${s.slug}: ${s.description} — ${read.has(s.slug) ? "READ by the run" : "NOT read by the run"}`,
    )
    .join("\n");
  return `Desk skills that applied to this ticket:
${lines}

A skill is this desk's agreed procedure. If one applied and the run neither
followed it nor explained why it departed, that is a FAIL. Not reading a skill
is only a problem when the run's actions actually contradict it — a trivial
ticket resolved correctly is still a PASS.`;
}
