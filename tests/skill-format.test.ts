// The pure half of desk skills: parsing a SKILL.md, deciding which skills
// apply to a ticket, and rendering the two prompt sections. No database.

import { describe, expect, it } from "vitest";
import {
  orderCatalogFor,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  skillAppliesTo,
  skillCatalogSection,
  skillReviewSection,
  SKILL_CATALOG_LIMIT,
  type SkillCatalogEntry,
} from "@/lib/skill-format";

const VALID = `---
name: Account lockouts
description: What to establish before resetting anything.
categories: [ACCESS]
---

## Steps

1. Confirm the requester owns the account.
`;

function entry(over: Partial<SkillCatalogEntry> = {}): SkillCatalogEntry {
  return {
    slug: "a-skill",
    name: "A skill",
    description: "Does a thing.",
    categories: [],
    ...over,
  };
}

describe("parseSkillMarkdown", () => {
  it("parses frontmatter and body", () => {
    const skill = parseSkillMarkdown(VALID);
    expect(skill.name).toBe("Account lockouts");
    expect(skill.description).toBe("What to establish before resetting anything.");
    expect(skill.categories).toEqual(["ACCESS"]);
    expect(skill.body).toContain("Confirm the requester owns the account.");
    // The frontmatter is not part of the body an agent reads back.
    expect(skill.body).not.toContain("categories:");
  });

  it("treats a missing categories list as 'every ticket'", () => {
    const skill = parseSkillMarkdown(`---
name: Escalation rule
description: When to escalate.
---

Body.`);
    expect(skill.categories).toEqual([]);
    expect(skillAppliesTo(skill, "DATABASE")).toBe(true);
  });

  it("requires a name", () => {
    expect(() => parseSkillMarkdown(`---\ndescription: d\n---\n\nBody.`)).toThrow(
      /non-empty `name`/,
    );
  });

  it("requires a description — it is the only thing the agent sees first", () => {
    expect(() => parseSkillMarkdown(`---\nname: N\n---\n\nBody.`)).toThrow(
      /non-empty `description`/,
    );
  });

  it("rejects a description beyond the 1024-char import limit", () => {
    const long = "x".repeat(1025);
    expect(() =>
      parseSkillMarkdown(`---\nname: N\ndescription: ${long}\n---\n\nBody.`),
    ).toThrow(/at most 1024 characters/);
  });

  it("rejects an unknown category by name", () => {
    expect(() =>
      parseSkillMarkdown(`---\nname: N\ndescription: d\ncategories: [BILLING]\n---\n\nBody.`),
    ).toThrow(/Unknown category "BILLING"/);
  });

  it("rejects an empty body — a skill with no procedure is not a skill", () => {
    expect(() => parseSkillMarkdown(`---\nname: N\ndescription: d\n---\n`)).toThrow(
      /body \(the procedure\) cannot be empty/,
    );
  });
});

describe("parseSkillMarkdown — Agent Skills compatibility (cnp-04)", () => {
  it("accepts the six portable fields and tolerates unknown frontmatter keys", () => {
    const skill = parseSkillMarkdown(`---
name: External skill
description: Imported from a public library.
license: MIT
compatibility: claude-code
allowed-tools: [read_file, grep]
when_to_use: whenever          # Claude Code's extra key — tolerated, never fatal
metadata:
  author: someone
---

Procedure body.`);
    expect(skill.license).toBe("MIT");
    expect(skill.compatibility).toBe("claude-code");
    expect(skill.allowedTools).toEqual(["read_file", "grep"]);
    expect(skill.metadata).toEqual({ author: "someone" });
    expect(skill.warnings).toEqual([]);
  });

  it("reads categories from metadata.categories first, top-level as legacy", () => {
    const portable = parseSkillMarkdown(`---
name: N
description: d
metadata:
  categories: [ACCESS, NETWORK]
---

Body.`);
    expect(portable.categories).toEqual(["ACCESS", "NETWORK"]);

    const legacy = parseSkillMarkdown(VALID);
    expect(legacy.categories).toEqual(["ACCESS"]);
  });

  it("lenient mode drops unknown categories with a warning; strict still throws", () => {
    const doc = `---\nname: N\ndescription: d\nmetadata:\n  categories: [ACCESS, BILLING]\n---\n\nBody.`;
    const lenient = parseSkillMarkdown(doc, { mode: "lenient" });
    expect(lenient.categories).toEqual(["ACCESS"]);
    expect(lenient.warnings[0]).toMatch(/Dropped unknown category "BILLING"/);
    expect(() => parseSkillMarkdown(doc)).toThrow(/Unknown category "BILLING"/);
  });

  it("accepts allowed-tools as a comma-separated string", () => {
    const skill = parseSkillMarkdown(
      `---\nname: N\ndescription: d\nallowed-tools: read_file, grep\n---\n\nBody.`,
    );
    expect(skill.allowedTools).toEqual(["read_file", "grep"]);
  });

  it("round-trips: a Claude-Code-style skill re-serializes with only the portable fields", () => {
    const external = `---
name: External skill
description: Imported.
license: MIT
allowed-tools: [read_file]
when_to_use: always
metadata:
  categories: [ACCESS]
---

Procedure body.`;
    const first = parseSkillMarkdown(external, { mode: "lenient" });
    const serialized = serializeSkillMarkdown(first);
    expect(serialized).not.toContain("when_to_use"); // extras do not survive
    expect(serialized).toContain("license: MIT");
    const second = parseSkillMarkdown(serialized);
    expect(second.name).toBe(first.name);
    expect(second.description).toBe(first.description);
    expect(second.categories).toEqual(first.categories);
    expect(second.license).toBe(first.license);
    expect(second.allowedTools).toEqual(first.allowedTools);
    expect(second.body).toBe(first.body);
  });

  it("round-trips a legacy Servo skill into the portable form and back", () => {
    const first = parseSkillMarkdown(VALID);
    const serialized = serializeSkillMarkdown(first);
    expect(serialized).toContain("metadata:"); // categories nest under metadata
    const second = parseSkillMarkdown(serialized);
    expect(second.categories).toEqual(first.categories);
    expect(second.body).toBe(first.body);
  });
});

describe("skillAppliesTo", () => {
  it("matches on category, and an empty list matches everything", () => {
    expect(skillAppliesTo({ categories: ["ACCESS"] }, "ACCESS")).toBe(true);
    expect(skillAppliesTo({ categories: ["ACCESS"] }, "NETWORK")).toBe(false);
    expect(skillAppliesTo({ categories: [] }, "NETWORK")).toBe(true);
  });
});

describe("orderCatalogFor", () => {
  it("puts the applicable skills first without dropping the others", () => {
    const skills = [
      entry({ slug: "db", categories: ["DATABASE"] }),
      entry({ slug: "everywhere", categories: [] }),
      entry({ slug: "access", categories: ["ACCESS"] }),
    ];
    expect(orderCatalogFor(skills, "ACCESS").map((s) => s.slug)).toEqual([
      "everywhere",
      "access",
      "db",
    ]);
  });

  it("caps the catalogue, trimming the inapplicable skills first", () => {
    const many = [
      ...Array.from({ length: SKILL_CATALOG_LIMIT + 10 }, (_, i) =>
        entry({ slug: `other-${i}`, categories: ["DATABASE"] }),
      ),
      entry({ slug: "the-relevant-one", categories: ["ACCESS"] }),
    ];
    const ordered = orderCatalogFor(many, "ACCESS");
    expect(ordered).toHaveLength(SKILL_CATALOG_LIMIT);
    expect(ordered.map((s) => s.slug)).toContain("the-relevant-one");
  });
});

describe("skillCatalogSection", () => {
  it("advertises slug, scope and description — never the body", () => {
    const section = skillCatalogSection(
      [entry({ slug: "locked-out", description: "Reset rules.", categories: ["ACCESS"] })],
      "ACCESS",
    );
    expect(section).toContain("## Desk skills");
    expect(section).toContain("- locked-out (ACCESS): Reset rules.");
    expect(section).toContain("read_skill");
  });

  it("labels a desk-wide skill as applying to every ticket", () => {
    const section = skillCatalogSection([entry({ slug: "always", categories: [] })], "OTHER");
    expect(section).toContain("- always (every ticket):");
  });

  it("says a skill never overrides an approval gate", () => {
    const section = skillCatalogSection([entry()], "OTHER");
    expect(section).toMatch(/never overrides an approval gate/i);
  });

  it("is empty when the desk has no skills, so the prompt is unchanged", () => {
    expect(skillCatalogSection([], "ACCESS")).toBe("");
  });

  it("truncates a document-length description to a 300-char catalogue line", () => {
    const long = "y".repeat(600);
    const section = skillCatalogSection([entry({ slug: "verbose", description: long })], "OTHER");
    const line = section.split("\n").find((l) => l.startsWith("- verbose")) ?? "";
    expect(line.length).toBeLessThanOrEqual("- verbose (every ticket): ".length + 300);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("skillReviewSection", () => {
  it("tells QA which applicable skills the run actually read", () => {
    const skills = [
      entry({ slug: "read-me", categories: ["ACCESS"] }),
      entry({ slug: "ignored", categories: ["ACCESS"] }),
      entry({ slug: "irrelevant", categories: ["DEVOPS"] }),
    ];
    const section = skillReviewSection(skills, "ACCESS", ["read-me"]);
    expect(section).toContain("- read-me: Does a thing. — READ by the run");
    expect(section).toContain("- ignored: Does a thing. — NOT read by the run");
    // A skill for another category is not something this run had to follow.
    expect(section).not.toContain("irrelevant");
  });

  it("is empty when no skill applied, leaving QA's judgement untouched", () => {
    expect(skillReviewSection([entry({ categories: ["DEVOPS"] })], "ACCESS", [])).toBe("");
    expect(skillReviewSection([], "ACCESS", [])).toBe("");
  });
});
