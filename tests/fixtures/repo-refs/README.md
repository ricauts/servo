# repo-refs fixtures

A miniature repository that the repo-refs test feeds to the pure functions in
the reference scanner. Nothing here names a real path on purpose: the scanner
scans this directory too, and a fixture that mentions a live source file would
mark it "referenced" on the strength of test data. `virtual-repo.json` is the manifest: it maps
each virtual path to the fixture file holding its content, and carries the
virtual `package.json`, `package-lock.json`, `tsconfig.json` and `.gitignore`.

Every content file ends in `.fixture` on purpose. The scanner runs over
`git ls-files` on the real repository, and a fixture called `page.tsx` holding
`import "some-package-that-does-not-exist"` would show up in the real scan as an
undeclared dependency. The `.fixture` suffix is in none of the scanner's
extension sets, so these files are inert everywhere except in the test that
loads them by name.

What each fixture covers:

| fixture | rule it exercises |
|---|---|
| `app-page.tsx.fixture` | aliased import (`@/…`), a named import binding |
| `barrel-index.ts.fixture` | a barrel file: `export * from` / `export { … } from` |
| `barrelled-widget.tsx.fixture` | a file reachable only through the barrel |
| `dynamic-literal.ts.fixture` | the shape at line 56 of the real screenshot module — a literal `await import("puppeteer-core")` |
| `dynamic-template.ts.fixture` | a non-literal `import()` with a readable static prefix |
| `dynamic-opaque.ts.fixture` | a non-literal `import()` with no prefix at all |
| `docs-mention.md.fixture` | a markdown-only path mention |
| `dead-widget.tsx.fixture` | nothing imports it; only prose names it |
| `utils.ts.fixture` | one used export and one dead export |
| `undeclared-user.mjs.fixture` | imports a package nothing declares |
| `lockfile-claim.mjs.fixture` | a comment asserting `node_modules/<pkg>` for a package the lockfile has never heard of |
