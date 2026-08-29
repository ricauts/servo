# Integration mining — the one procedure

This file is the ONE mining procedure. There is no flat integrations doc
and no second location: per-candidate intake documents live at
`docs/integrations/<slug>.md` and nowhere else.

## When a mining tick is allowed

A mining tick runs only when BOTH hold, stated verbatim:

1. The backlog has **no unblocked todo item** — mining is what the loop does
   when there is nothing better to pick, never a way around an item.
2. `p0-01`, `loop-05` and `loop-06` are all **done** (they are, as of this
   writing — the audit trail, the offline-scrub and the quarantine triple
   that every adopted tool must pass through).

## Source rotation, in order

One candidate **per tick**, rotating through the sources in this order:

1. **anthropics/skills** — SKILL.md libraries.
2. **The MCP registry.**
3. **NousResearch/hermes-agent** `tools/` — MIT.
4. **paperclipai/paperclip** `server/src/services/` — MIT; any lifted code
   keeps its copyright notice and lands in `THIRD_PARTY.md`.

## The intake template

Copy this into `docs/integrations/<slug>.md` for each candidate. The FIRST
STAGE is the adopt-first gate — an intake that skips it is not an intake.

```markdown
# <name> — intake

## Stage 0 — the adopt-first gate (ALWAYS FIRST)

- Licence: <read from the upstream LICENSE file, never recalled>
- Verdict: ADOPTED / REJECTED / IDEAS ONLY
- If adopted: the upstream copyright notice, recorded in THIRD_PARTY.md in
  the same commit.
- If a verified verdict already exists in spec.md §0.4's table: CITE it,
  never re-litigate it.
- `gorkbot` stays UNVERIFIED unless the research brief says otherwise.

Gate rules, verbatim:
- Allowlist: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0,
  Unlicense.
- GPL, AGPL, SSPL: rejected — not adoptable in any form.
- No LICENSE file upstream: ideas only. Read it, learn from it, never copy
  a line.
- Vendored code keeps its upstream copyright in THIRD_PARTY.md.

## The candidate

- Name:
- Source URL:
- Licence: (from Stage 0)
- Proposed tool names:

## The fixed triple — NOT fields an intake may change

Every adopted tool ships a DEFAULT_TOOL_POLICIES row carrying exactly:

    enabled: false
    requiresApproval: true
    riskLevel: HIGH

These three are the quarantine (loop-06). An intake proposes a tool; a
human admin enables it after reading what it does. The intake template
cannot soften, disable or pre-approve them.

## Egress notes

- Every model-steerable outbound URL goes through `safeFetch` — host
  resolution, loopback/private/CGNAT/link-local refusal, redirect
  re-checks, optional allowlist.

## Validation evidence

- What was run, on what fixtures, with what result. A candidate without
  evidence is not adoptable, no matter how clean its licence is.
```

## The non-negotiables

Verbatim, because each one closes a hole the spec's history named:

- **Every adopted tool gets a `DEFAULT_TOOL_POLICIES` row carrying the
  triple** (`enabled:false, requiresApproval:true, riskLevel:HIGH`).
- **Every model-steerable outbound URL goes through `safeFetch`.**
- **Gated tools stay unreachable over MCP** — the MCP surface never serves
  a tool whose policy requires approval.

## Adopt-first is step 0 of EVERY tick

Not only mining ticks. Before building any component, the loop records in
its changelog line either the adopted OSS component and its licence, or
one sentence on why nothing cleared the gate. That sentence is part of the
audit trail: a tick that builds first and justifies later has already
skipped the gate.
