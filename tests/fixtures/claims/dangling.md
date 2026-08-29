# Dangling references

The resolver loop lives in `src/lib/ai/engine.ts`, and the build order is
[the contract](CONTRACT.md) — a link target, so it resolves against the
directory holding THIS document, not the repository root.

This one is dead: `src/lib/does-not-exist.ts`.

And so is this link: [gone](nowhere.md).

A line reference is a coordinate inside a file, not part of its name, so
`src/lib/ai/engine.ts:474-604` and `src/lib/ai/engine.ts:190` both resolve.
