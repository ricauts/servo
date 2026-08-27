<!-- Design rationale for spec.md. spec.md remains the work order:
     the backlog, the tick protocol and the claims ledger live there. -->

# High-fidelity extraction — the optional Docling sidecar

*This section extends §5's ingestion pipeline; it does not fork it. The entitlement CTE, the `locator` contract, the deterministic keyword pass, the mock embedder and `ReplyDraft.sources` all survive unchanged. Nothing in this section is on §5's critical path: delete every `dcl-*` item and §5 ships exactly as specified.*

§5 decided extraction — `exceljs` for xlsx, `unpdf` for PDF, both MIT, both pure JS, both inside the one app container. That decision was correct and is **not reopened**. It has exactly one hole, and §5 already names it in the plainest possible terms: **"Scanned PDFs are the common case for product manuals and have no text layer. There is no OCR in v1."** A desk whose most-asked-about document is a scanned manual indexes nothing and says so honestly, which is better than lying, but it is still nothing.

Docling closes that hole, and closing it costs a ~4.4 GB published image. So the shape is forced: **Docling is an optional second extractor, off by default, and Servo's extraction path must be complete and green with Docling absent from the machine.** Not degraded-but-working. Complete. The baseline is the floor, not the untested fallback nobody exercises.

### The verdict, cited once, never re-litigated

Audited 2026-08-27 to the §0.4 standard. Licences read from the LICENSE file, not from a badge.

| Candidate | Licence | Verdict |
|---|---|---|
| `docling-project/docling` | **MIT**, `Copyright The Docling Contributors` — no added clauses, no field-of-use restriction, no revenue threshold. IBM Research origin, donated to the **LF AI & Data Foundation** (Incubation, April 2025). v2.123.0, 2026-08-26 | **ADOPT — format and sidecar only.** No npm dependency; no Python in the Servo image |
| `docling-project/docling-serve` | **MIT**, v1.31.0, 2026-08-20. OpenAPI at `/openapi.json`, async convert + poll + result, models baked into the published image at build time | **ADOPT** — the deployment shape, pulled as an image, never rebuilt |
| `DoclingDocument` JSON format | open format | **FORMAT-ONLY**, exactly like `SKILL.md` in §6.4 — our own Zod schema over the ~10 fields we consume, no licence barrier and no dependency to drift |
| `docling-ts` / `docling-client` | MIT, but self-described *"an unstable draft implementation that evolves quickly"*; published package id for the client is **UNVERIFIED** | **REJECT for v1.** We make two HTTP calls and must validate the response anyway |
| `docling.rs` (napi-rs Node addon) | MIT, inside the official org — would delete this entire section | **REJECT for v1, revisit in two quarters.** 51 stars, 227 downloads/week, first npm publish 2026-07-08, no macOS prebuild, every parity and performance claim self-reported. §0.4 asks for a *proven* implementation |
| `docling-mcp` | MIT, official | **REJECT as the mechanism.** Ingestion of untrusted uploads is not a model-steerable action and must not become a registry tool under §0.8 rail 4 |
| `marker` | Apache-2.0 code, but model weights are **Modified AI Pubs OpenRAIL-M** — free only under $5M funding/revenue | **REJECT.** A revenue threshold is exactly what §0.4 refuses on a planned hosted offering |
| `MinerU` | Apache-2.0 **plus additional terms**: MAU/revenue thresholds *and* a visible-attribution obligation | **REJECT.** The attribution duty is a product constraint, not just a licence line |
| `PyMuPDF4LLM` / PyMuPDF | **AGPL-3.0** | **REJECT — disqualifying under §0.4.** Docling's own paper cites the same licensing as its reason for writing `docling-parse` |
| `unstructured` | Apache-2.0, clean | **REJECT on merit, not licence.** 4.2 s/page against Docling's 3.1 s/page on the same benchmark, and no capability we need |

**The model weights are a separate licence question and they also clear.** They are recorded individually in `THIRD_PARTY.md` because they differ from the code licence: layout `docling-layout-heron` **Apache-2.0**; TableFormer `docling-models` **CDLA-Permissive-2.0 + Apache-2.0**; `CodeFormulaV2` **CDLA-Permissive-2.0**; `DocumentFigureClassifier` **MIT**; `granite-docling-258M` **Apache-2.0**. Nothing here is research-only or non-commercial. CDLA-Permissive-2.0 carries a pass-along obligation **on redistribution of the weights**, and Servo does not redistribute them: we pull the upstream published image by digest and never rebuild it. That is written down in `THIRD_PARTY.md` before anyone bakes a Servo-branded image by accident, because that is the day the obligation attaches.

### The deployment shape: an opt-in sidecar, and nothing in the app image

Servo ships one `node:22-alpine` container plus §4's Postgres. Docling is Python with PyTorch. The CLI-subprocess shape would put a full Python + torch environment in *everyone's* image — the self-hoster who never wanted OCR pays the 4.4 GB — and would reload models on every invocation, which is precisely what `docling-serve`'s `DOCLING_SERVE_LOAD_MODELS_AT_BOOT` exists to avoid. Rejected on the container promise alone.

So: **`docker-compose.docling.yml` is a separate overlay file, never merged into `docker-compose.yml`.** The default `docker compose up` stays byte-identical to today's, and a test asserts `docker-compose.yml` contains no docling service. Opting in is:

```
docker compose -f docker-compose.yml -f docker-compose.docling.yml up -d
```

plus one setting. The image is `docling-serve-cpu` **pinned by digest, not tag** — a tag that moves would silently change extraction output under a KB whose citations are supposed to be stable. The digest is amd64. **arm64 availability of `docling-serve-cpu` is UNVERIFIED**; the overlay's header documents `docker manifest inspect` and how an arm64 self-hoster substitutes their own digest, and `docs/KB-DOCLING.md` says plainly that pinning a single-arch digest is why.

**No client library is adopted.** `src/lib/kb/extractors/docling-client.ts` is hand-written `fetch` against `POST /v1/convert/file/async`, `GET /v1/status/poll/{task_id}` and `GET /v1/result/{task_id}`, with our own Zod schema over the consumed subset — which we would need regardless, because that JSON is untrusted input crossing a process boundary.

**`/v1/convert/file`, never `/v1/convert/source`.** Source-by-URL makes the sidecar fetch the document itself. We spend a whole compose file removing the sidecar's ability to reach the network; handing it a URL hands it back. A test greps the source to prove the endpoint is never called.

**Version handshake.** `extractorVersion` for the docling path is read from `GET /openapi.json` → `info.version`, cached per process and refreshed whenever the circuit closes. Whether `docling-serve` exposes a dedicated version endpoint is **UNVERIFIED**, and a comment says so. If the read fails, `extractorVersion` records `docling-serve@unknown` — never a guess, never a silent blank — and the KB settings page shows the reported version beside the configured URL so a mismatched digest is visible instead of manifesting as a permanent stream of `docling-schema-invalid` baselines.

### The pluggable extractor interface

One seam, in `src/lib/kb/extractors/`:

```ts
export interface Extractor {
  readonly id: "baseline" | "docling";
  readonly version: string;            // baseline: "exceljs@4.4.0+unpdf@0.12.1"; docling: server-reported
  supports(sniffedType: string): boolean;
  extract(input: ExtractInput): Promise<ExtractOutcome>;
}

export interface ExtractInput {
  bytes: Buffer;
  sniffedType: string;                 // magic-byte sniff, NOT the client-declared Content-Type
  name: string;
  signal: AbortSignal;                 // the worker's wall-clock deadline, shared by both extractors
}

export type ExtractOutcome =
  | { status: "EXTRACTED";  chunks: ExtractedChunk[]; summary: string }
  | { status: "UNSUPPORTED"; reason: string }
  | { status: "FAILED";      reason: string };

export interface ExtractedChunk { text: string; locator: Locator }
```

That is the whole contract, and its narrowness is the point. **Chunking lives inside the extractor; everything downstream is untouched.** The keyword/entity pass, the graph-edge builder, the embedding client and the mock embedder are pure functions of `text` and neither know nor care which extractor produced it. §5's pipeline stays: upload → extract → chunk → keyword/entity → embed-if-configured → edges.

**The extractor is selected on the *sniffed* type, never on the client-declared one.** An emailed attachment must not get to choose whether a pure-JS parser or a native ML stack eats it.

Both extractors run inside kb-05's forked, capped, XXE-disabled worker. The Docling extractor is a *client* inside that runner, not an exemption from it.

**Provenance columns on `Document`**, all additive and defaulted, so §0.6 lands them Tier B:

```prisma
extractor         String  @default("baseline")   // "baseline" | "docling"
extractorVersion  String  @default("")           // exact library or server version that produced these chunks
extractorFallback String?                        // null = the configured extractor ran; else why it did not
extractedAt       DateTime?
```

`extractorFallback` is the honesty column, and it is **cleared to null on every successful non-fallback extraction** — otherwise dcl-09's "the sidecar was down when these landed" queue never drains. Its values are a closed, machine-readable set: `docling-unreachable`, `docling-timeout`, `docling-http-5xx`, `docling-schema-invalid`, `docling-oversize-body`, `docling-page-cap`, `docling-circuit-open`, `docling-task-abandoned`.

### The extraction budget, made arithmetic

The published per-page figures — 3.1 s/page on 8 vCPU, 1.27 s/page on an M3 Max, 0.49 s/page on an L4 — are from **Docling 2.5.2, January 2025**, with a different layout model than current. Current latency is **unmeasured**. That is precisely why the budget is expressed as an invariant with headroom rather than as three numbers that happen to disagree:

```
assumedMsPerPage = 6000            // 2× the published 3.1 s/page, headroom for a modest server
maxPages × assumedMsPerPage  ≤  timeoutMs  ≤  workerBudgetMs − pollSlackMs
40 × 6000 = 240_000          ≤  300_000    ≤  360_000 − 30_000 = 330_000   ✓
```

Shipped defaults: `kb.extract.docling.maxPages` **40**, `kb.extract.docling.timeoutMs` **300_000**, `kb.extract.workerBudgetMs` **360_000**, poll interval 2 s, poll slack 30 s. **A test asserts the inequality over the shipped defaults**, so raising one constant without the others fails the suite rather than deterministically timing out in production.

This is the correction that matters most. The naive pairing — 120 s deadline, 200-page cap — makes every scanned PDF over ~40 pages land `docling-timeout` → baseline → `UNSUPPORTED`: the default configuration could not OCR the exact artifact this section exists for. It is now coherent, and it is honest about its consequence: **a 200-page scanned manual is over the cap by default.** It lands `docling-page-cap` with copy naming the cap and the setting, not a mystery. Raising `maxPages` means raising `timeoutMs` and `workerBudgetMs` with it, and `docs/KB-DOCLING.md` gives the arithmetic and says a 200-page scan is roughly ten minutes of CPU, not seconds.

Because the polling window is now minutes rather than seconds, a container restart mid-poll can strand an `EXTRACTING` row — a window kb-05's killed-child criterion does not cover. `reclaimStuckExtractions()` runs at boot and flips any `EXTRACTING` row older than `workerBudgetMs` to `FAILED` with a specific `textError`. **Concurrency stays 1**, and it is not a new mutex: it is the property of §5's one-file-at-a-time forked worker, stated so nobody adds a second.

### The locator contract survives by extension

§5's citations depend on `locator`, and the format is load-bearing across kb-11's tool results, kb-12's numbered markers, kb-13's send-time re-verification and kb-16's UI. Docling produces something richer — provenance on every item, page plus bounding box plus char span, table cells with row/column offsets and spans. That richness makes citations *more* precise and must not break a single consumer that reads the simpler shape.

The rule, and it is a rule: **existing keys keep their exact meaning forever; new keys are additive and optional; no consumer may require a key it did not previously require.**

```ts
// Zod, .passthrough(). Baseline emits the required keys; Docling emits the same
// required keys plus optionals. A Docling locator MUST validate against the
// baseline schema — that assertion is dcl-02's acceptance.
PageLocator  = { page: number,  pageEnd?: number, bbox?: [l,t,r,b], label?: string, ref?: string }
SheetLocator = { sheet: string, range: string, table?: number, cell?: {row,col,rowSpan,colSpan} }
LineLocator  = { lines: string }
```

`bbox` is normalized 0–1 with a top-left origin, so it survives any render scale. `label` is the Docling item label (`table`, `section_header`, `list_item`, `code`, `formula`, …). `ref` is the DoclingDocument self-reference (`#/tables/0`) — useful for debugging a mapping, never shown to a user. `range` stays authoritative for spreadsheets and `cell` is advisory: a renderer that only knows `range` is still correct.

One renderer, `formatLocator()`, is the single owner of citation strings and **degrades cleanly by construction**: `{page:12}` → *"page 12"*; `{page:12,label:"table",bbox:[…]}` → *"page 12 · table"*; `{sheet:"2026",range:"B4:D9"}` → exactly what §5 promised, *"Pricing.xlsx · sheet 2026 · B4:D9"*. Every existing citation string is byte-identical after dcl-02. Both extractors are 1-based on page numbers, asserted against a fixture rather than assumed.

### Chunking: structure-aware, same contract

Docling's value for chunking is that its output is a *tree* with reading order — headers and page furniture separated from body, multi-column text ordered correctly, tables recovered as cells. `docling-chunker.ts` walks that tree **in Node** and applies §5's existing rules to it:

- **A section keeps its heading.** The heading path (`H1 › H2 › H3`) is prefixed into every chunk's text — the same idea as §5's "header row repeated into every chunk of its region", applied to prose.
- **A table stays whole** up to the per-chunk cell cap. Over the cap it splits by row groups **with the header row repeated**, exactly the xlsx rule, each piece carrying its own `{page, bbox, label:"table"}`.
- **Page furniture is dropped.** Running headers and footers do not become chunks — that alone removes a large class of junk chunks that rank well and say nothing (§5 risk 4).
- Chunking is done in Node over the returned JSON, **not** by calling a Docling chunking endpoint. Whether `docling-serve` exposes one is **UNVERIFIED**; adopting it later is a separate item, and keeping chunking in one language and one test lane is worth more than saving the code.

**Effect on the embedding and keyword passes: structurally none, with one real consequence.** Chunks are still `{text, locator}` and the passes never see structure. But the heading prefix is *inside* `text`, so it is embedded and keyworded — intended for embedding, since it is what makes a mid-document chunk self-describing to a vector search, and a distortion for keywords, because a heading term would otherwise appear in every chunk under it and dominate every top-N list. The keyword pass therefore **de-weights the heading prefix**: prefix terms enter a chunk's keywords only if they also occur in the chunk body. Small rule, measurable effect, its own acceptance criterion rather than a comment.

**kb-07's low-text threshold applies to Docling output too.** An empty or near-empty conversion lands `UNSUPPORTED`, never a silently empty `EXTRACTED` — otherwise a failed OCR pass looks like a successfully indexed blank manual, which is the exact failure §5 refuses.

Chunk boundaries change when the extractor changes, so **switching extractors is a re-ingestion** on §5's existing re-upload path: chunks and edges replaced, grants untouched, embeddings recomputed. A pending `ReplyDraft` whose `sources` point at now-deleted chunk ids is not a new problem — it is exactly the case kb-13 fails closed on. Re-extraction makes that path common instead of rare, which is a good reason to prove it, and dcl-09 does.

### Offline testability: three lanes, and only one of them may ever be red

§0.8 and §11 are unambiguous: acceptance is checkable offline, a local container is fine, external SaaS is not, and a green tick against something that was not there is the failure the rails exist to prevent. A 4.4 GB image is technically a local container, but making it a CI prerequisite would be a hostile trade. So:

**Lane 1 — baseline, always green, Docling absent from the machine.** With `kb.extract.docling.url` unset, every `kb-*` test from kb-04 through kb-17 passes unchanged. This is the default `npm test`, it is what CI runs, it is the state of a fresh install, and it is the lane that may never be red. If a Docling change breaks lane 1, the change is wrong. **Every `dcl-*` item's last acceptance criterion says so.**

**Lane 2 — recorded fixtures, no image, no network, runs in CI.** The client sits behind a `DoclingTransport` interface with `HttpTransport` and `FixtureTransport` implementations. Committed `tests/fixtures/kb/docling/*.doclingdocument.json` with a `MANIFEST.json` entry per fixture. This lane tests everything that can actually be wrong in *our* code — schema validation, byte caps, locator mapping, page numbering, structure-aware chunking, table splitting, keyword de-weighting, and every fallback branch — with no image and no socket.

The fixtures are a genuine ordering problem and it is solved explicitly rather than wished away: **the sidecar overlay lands after the client**, so the first tick that needs fixtures cannot record them. Every `MANIFEST.json` entry therefore declares its provenance:

- `"recorded"` — produced by `scripts/record-docling-fixture.mjs` against a live sidecar, carrying the source filename, the `docling-serve` version and the **image digest**.
- `"synthetic": true` — hand-authored offline from the documented `DoclingDocument` shape, with a `reason`, permitted **only** while `docker-compose.docling.yml` does not exist in the tree.

An offline lint fails the build on any `synthetic` fixture once that overlay file exists. The loop is never blocked, the fiction is labelled as fiction, and it is structurally impossible for it to survive the arrival of the thing that can replace it.

**Lane 3 — the live lane, opt-in, local, never in CI.** `tests/live/docling.live.ts` under its own `vitest.live.config.ts`, run by `npm run test:docling`, gated on `SERVO_TEST_DOCLING=1`. It is **outside** the default `tests/**/*.test.ts` glob — a live test inside that glob would have to self-skip, and a skipped test reading as green is what §0.2 step 9 forbids outright. A CI assertion proves the default include pattern matches zero files under `tests/live/`.

Lane 3's job is not to re-test the mapping. It is to **prove the fixtures are not fiction**: the live sidecar's reported version equals `MANIFEST.json`'s, failing with the literal message *"re-record the fixtures with scripts/record-docling-fixture.mjs"*; and a real conversion of the same source files satisfies the same schema and the same *structural* invariants — page count, table count, header row present, monotonic reading order. **It never asserts exact text bytes.** An ML pipeline is not bit-deterministic across versions and hardware, and a criterion pretending otherwise fails for the wrong reason.

Fixture rot is also detectable **without** the image: an offline test asserts `MANIFEST.json`'s digest equals the digest parsed out of `docker-compose.docling.yml`, failing with the same re-record message. That catches the common drift — someone bumps the pin — in the lane everybody runs.

That split is the honest one: lane 2 asserts exact bytes against a frozen artifact, lane 3 asserts shape against a live one, lane 1 asserts that none of this is load-bearing.

### Security: a large native parser eating untrusted uploads

Servo's tickets arrive by email, so uploads are attacker-influenced by construction, and the sidecar is a large native dependency surface parsing them. It is treated as hostile in both directions.

**No egress.** The sidecar joins a compose network declared `internal: true`. It has no route out. This is not belt-and-braces with the model download — it is the *reason* the models must be pre-baked. `enable_remote_services` stays off (the default; remote VLM calls raise `OperationNotAllowed`), and the overlay sets nothing that could turn it on.

**The artifacts check is a healthcheck, not an entrypoint change.** We pull the upstream image by digest and never rebuild it — dcl-08 makes that a licence commitment — so there is nowhere to inject a boot assertion. The overlay's `healthcheck` is a `CMD-SHELL` test that `DOCLING_SERVE_ARTIFACTS_PATH` exists and is non-empty, and the app's `depends_on: { docling: { condition: service_healthy } }` waits for it. That also fixes the first-upload problem: `LOAD_MODELS_AT_BOOT` means the first requests after `up` would otherwise fail, open the circuit, and silently baseline everything for M minutes.

**Least privilege, with one honest UNVERIFIED.** `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, no volumes, `mem_limit`, `cpus`, `pids_limit`. `read_only: true` with tmpfs mounts is shipped, but **whether the image boots read-only is UNVERIFIED** — the baked artifacts live at `/opt/app-root/src/.cache/docling/models` and HF-hub lock files and rasterization scratch may write outside `/tmp`. So the *offline* criterion asserts the YAML shape only; whether it boots is lane 3's job, and `docs/KB-DOCLING.md` documents the recorded deviation (drop `read_only`, keep every other control) if it crashloops. Non-root is asserted by `id -u` returning non-zero in the live lane rather than by pinning a uid we have not verified.

**Every one of those controls is asserted offline, by parsing the YAML.** `tests/docling-compose.test.ts` reads `docker-compose.docling.yml` as text and asserts `internal: true`, `cap_drop: [ALL]`, `no-new-privileges`, empty `volumes`, the three limits, the healthcheck, and an `image` matching `@sha256:`. A PR deleting `internal: true` goes red in the lane CI actually runs — which is the whole point, since the live lane runs only when somebody chooses to.

**Caps enforced on Servo's side, before the bytes leave.** §5's 25 MB stored-byte cap already applies. Added: the page cap, checked **before** we call at all; the deadline, ours and not the server's, which is why we use the async endpoints and poll — `DOCLING_SERVE_MAX_SYNC_WAIT` is 120 s and a long scan would burn it for nothing; and concurrency 1.

**The response is untrusted and is capped while it streams.** `Content-Length` is checked first, and a byte counter aborts mid-body — a post-buffer cap OOMs the worker before it fires. Then an item-count cap, then Zod. Anything failing lands `docling-schema-invalid` or `docling-oversize-body` → baseline. No field is ever HTML-rendered. Extracted text carries prompt-injection risk, but that is equally true of `unpdf` output and is already answered by §5: citations are structural, the entitlement CTE is the gate, and no new claim is made here.

**Results do not outlive their document.** On success and on deadline the client issues a best-effort `DELETE /v1/result/{task_id}` and treats 404/405 as fine — whether that endpoint exists is **UNVERIFIED** and the comment says so; the live lane records the observed status code in the doc. Abandonment without confirmation records `docling-task-abandoned`. `internal: true` already bounds who can fetch a stale result to the compose network, and `SERVO_DOCLING_API_KEY`, sent as a bearer when set, is the second layer.

**Failure degrades, never fails closed on the KB.** Crash, timeout, 5xx, malformed body, oversize body, circuit open — one branch: baseline, recorded reason, upload succeeds. `docling-health.ts` opens the circuit after **3 consecutive failures** and stops calling for **10 minutes**, so a wedged sidecar cannot add five minutes to every upload; documents ingested while it is open record `docling-circuit-open`. A broken sidecar makes the KB *less good*. It must never make the KB *unavailable*.

**On `checkEgress`.** `kb.extract.docling.url` is admin- or env-configured infrastructure pointing at a private address, so it does not pass through `src/lib/egress.ts`, which would correctly refuse it. Same class as §5's `kb.embed.baseUrl` pointing at a local Ollama — and the exemption is bounded so it is not a hole: read **only** from settings or env, never from a model, a document or a request; http/https only; no credentials in the URL; no redirects followed; **the host must resolve to loopback, an RFC1918/ULA address, or a compose service name**, and anything else is refused at configuration time with the reason named. A typo must not ship every uploaded document to an arbitrary public host. Stated here so a reviewer reads it as a decision, not an oversight.

### Limits, stated plainly, and what it costs the self-hoster who enables it

The per-page numbers are from **Docling 2.5.2, January 2025**; current latency on 2.123.0 is **unmeasured** and no SLA is claimed anywhere. Peak RSS per worker is **unpublished** — 2–4 GiB is inferred from the project's own k8s request/limit conventions, and the compose `mem_limit` is a starting guess the live lane should refine. The cost to a self-hoster who opts in: a **~4.4 GB published image** (on-disk is larger; the figure is a proxy from published image sizes, not a measurement), **10 GiB of disk for the baked model cache** — the number upstream's own PVC example uses — and one more container competing for CPU with the app and Postgres. That is the entire reason this is opt-in and the default `docker compose up` is untouched.

The digest is single-arch and **arm64 availability is UNVERIFIED**; an arm64 self-hoster substitutes their own digest per `docs/KB-DOCLING.md`. Whether the image boots `read_only` is UNVERIFIED. Whether `DELETE /v1/result/{id}` exists is UNVERIFIED. Whether `docling-serve` exposes a chunking endpoint or a pinned OpenAPI artifact is UNVERIFIED, and each is a comment in the code rather than an assumption in the design.

Recorded fixtures rot when upstream moves; the mitigation is the digest-agreement test in lane 2 and the version assertion in lane 3, not a promise it cannot happen. Extraction output is not reproducible across versions or hardware, so a re-extract can legitimately change chunk boundaries and therefore citation text — §5's re-upload semantics and kb-13's fail-closed re-verification are what keep that safe, and they are why dcl-09 exists rather than being optional polish.

**Two Tier-C merges gate the sidecar.** dcl-06 (compose diff) and dcl-08 (product copy) both open PRs and wait on the owner, and §0.6's anti-stall rule allows only one `review` at a time. dcl-01 through dcl-05 therefore ship **dormant code**: complete, tested against fixtures, and inert on every install until a human merges the overlay. That is the correct ordering — nothing user-visible claims OCR before the thing that does OCR can be started — but it means the capability is not one autonomous tick away, and the backlog should not read as if it were.

Finally: `docling.rs` would delete this entire section — no sidecar, no Python, one npm install — and it is deliberately not bet on at 51 stars, 227 downloads/week, seven weeks on npm, no macOS prebuild and every claim self-reported. Worth a re-audit under §0.4 in two quarters. Worth nothing before then.
