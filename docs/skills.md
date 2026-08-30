# Skills — Agent Skills compatibility and distillation

Skills are the desk's agreed procedures: a `SKILL.md` per procedure,
advertised to agents as a catalogue they open with `read_skill`.

## Agent Skills compatibility

Servo consumes the Agent Skills `SKILL.md` shape:

| Field | Handling |
|---|---|
| `name` | Required, non-empty. |
| `description` | Required, non-empty — it is what the catalogue shows. |
| `categories` | Strict: each must be one of the desk's categories (ACCESS, HARDWARE, SOFTWARE, DATABASE, DEVOPS, NETWORK, OTHER). Unknown categories are dropped with a note, not a failure. |
| body | Markdown, kept verbatim. |

The parse is **lenient where the format is open** (unknown frontmatter
keys are ignored; unknown categories drop) and **strict where the desk
depends on the field** (empty name or description refuses the document,
and a structurally invalid frontmatter refuses it). A bundled skill that
fails to parse is skipped at sync with the reason — it never blocks boot.

## The deterministic distillation flow

When a ticket resolves, an admin can distil it into a draft skill: the
ticket's timeline becomes a procedure draft, deterministically — no model
call decides what a distilled skill contains; the flow derives it from
the recorded steps. The draft records its source ticket
(`sourceTicketId`), so a distilled skill always names where it came from.

## The absolute human gate

A distilled skill arrives **disabled**, and only a human admin can enable
it. Nothing in the distillation flow — and no agent, ever — enables a
skill. Enabling is an explicit admin action in the skills UI, exactly as
enabling a plugin skill is.
