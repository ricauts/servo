# The knowledge base

Uploaded documents become searchable company knowledge: extraction,
chunking with source locators, a deterministic keyword pass, an optional
knowledge graph and grants. This page states the invariant and the
default posture in plain words.

## The entitlement invariant

**Retrieval is entitlement-filtered before a single byte reaches model
context.** A search runs the reader's entitlement chain inside the
database statement itself; passages the reader may not see never leave
the database, never enter a prompt and cannot be quoted. There is exactly
one definition of "may read", shared by every surface — search, the
tools, citations, downloads.

## Grants and subject types

Access beyond ownership is granted, never assumed:

- **USER** — one named human.
- **GROUP** — a flat group; membership rides `GroupMember`.
- **AGENT** — one named agent principal. Agents get nothing implicitly:
  no ownership spillover, no staff visibility, nothing public — an agent
  reads exactly what an explicit AGENT grant gives it.

A document's owner can grant (and revoke) per subject through the share
panel; admins see everything.

## STAFF and PUBLIC

- `PRIVATE` (the default): owner and explicit grants only.
- `STAFF`: every human with desk access (roles ADMIN and AGENT) — agent
  principals still need an explicit grant; staff visibility never leaks
  to them.
- `PUBLIC`: readable by any authenticated principal, the only visibility
  an auto-provisioned requester account can reach through membership
  alone.

## Auto-deliver and its five preconditions

A draft reply can be delivered without a human press only when **all
five** hold, checked in order:

1. The per-category auto-deliver setting is ON.
2. The draft cites at least one source.
3. Send-time re-verification passes — every cited document and chunk is
   re-checked against the reader's chain immediately before sending.
4. The QA reviewer has not flagged the draft.
5. The daily cap is not exhausted.

Any condition failing leaves the draft in the ordinary approval queue.

## Embeddings — the documented default

**With no embeddings endpoint configured, retrieval is keyword
(tsvector) search only and nothing leaves the container.** That is the
shipped default. An operator may configure an OpenAI-compatible
embeddings endpoint; when one is configured, chunks are vectorized and
search blends keyword and vector scores. The endpoint's host follows the
same egress allowlist rules as every other outbound destination.

## The library view — keywords, shelves, visibility

Every indexed document carries a **keyword profile**: the terms that top the
deterministic keyword pass in the most chunks (a running header on every
page wins by this rule, a word repeated fifty times on one page does not).
The pass is English- and Spanish-aware and keeps accented words whole; it
never calls a model, so a profile is reproducible and nothing leaves the
container to compute it.

The Knowledge list renders the profile as chips and filters on three axes
at once: **text** (name or keyword), **visibility** (private / staff /
public) and **collection**, with an *Uncategorized* shelf for documents no
one has filed. Chips on a document page link back to the list pre-filtered
on that keyword. Documents indexed before this view existed get their
profile from `npx tsx scripts/ops/kb-backfill-keywords.ts` (`--force`
recomputes every document after a stopword or tokenizer change); the
Re-extract button recomputes one.
