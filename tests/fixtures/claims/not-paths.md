# Things that are not repo-relative paths

A bare basename is a name, not a location: `engine.ts`, `SKILL.md`, `readme.md`.

A JSON-RPC method: `tools/call`. A container image: `pgvector/pgvector:pg17`.
A GitHub coordinate: `paperclipai/paperclip`. An npm scope:
`@modelcontextprotocol/sdk`. A URI scheme: `node:sqlite`. An HTTP route:
`POST /api/inbound/email` is prose, but `/api/inbound/email` alone is absolute.

A placeholder names a shape, not a file: `skills/<slug>/SKILL.md`.

An upstream citation that names a FILE is recognised as a path and needs an
exemption, not a recognition rule — see exempt.md. What stays unrecognised is
the extension-less form, which is shape-identical to a GitHub coordinate:
`apps/v4/registry/bases/radix`.

A fenced block is a sample, not an assertion:

```
see src/lib/absolutely-not-here.ts and `src/lib/nor-here.ts`
```
