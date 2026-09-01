# The Docling sidecar — opt-in, pinned, offline-asserted

This is the operator guide for the OPTIONAL high-fidelity extraction lane
(`kb.extract.docling.url`). Nothing here is required to run Servo: with the
setting unset the Docling code path never executes and the whole suite is
green. The overlay exists because baseline extraction returns nothing for
scanned PDFs — no text layer, no chunks, no citations — and OCR is the one
job the default image must not grow.

## Opting in: the exact two-file command

The sidecar ships as a SEPARATE compose overlay, never merged into
`docker-compose.yml` — the default `docker compose up` stays byte-identical
and never pulls multi-GB model weights:

```
docker compose -f docker-compose.yml -f docker-compose.docling.yml up -d
```

Then point Servo at the sidecar (settings UI or env):
`kb.extract.docling.url = http://docling:5001` (compose network) or
`http://127.0.0.1:5001` (host). The URL must resolve to loopback, an
RFC1918/ULA address, or a compose service name — anything else is refused
at configuration time. `kb.extract.docling.types` defaults to
`application/pdf` ONLY; xlsx stays on exceljs unless an admin opts in.

## The image: pinned by digest

```
ghcr.io/docling-project/docling-serve-cpu@sha256:7deed6ddba54908925c039d69a95806416c90cfc9b5486ca8554d3ce30a50289
```

- **Why a digest, not a tag**: a moving tag would silently change extraction
  output under a knowledge base whose citations are supposed to be stable —
  a re-crawl could rewrite every chunk a draft cites. The digest is also
  recorded in `tests/fixtures/kb/docling/MANIFEST.json`; an offline test
  asserts the two agree and fails with `re-record the fixtures with
  scripts/record-docling-fixture.mjs` when they drift.
- **arm64 is UNVERIFIED.** The digest above is the linux/AMD64 manifest. No
  arm64 host has run this overlay. An arm64 self-hoster substitutes their
  own digest with:
  `docker manifest inspect ghcr.io/docling-project/docling-serve-cpu:latest`
  and takes the arm64 entry's digest — then re-records the fixtures with
  `scripts/record-docling-fixture.mjs`, because a different manifest can
  produce different extraction output.
- The recorded fixtures carry `docling-serve@1.31.0`.

## What it costs

Every figure below is a PROXY or an INFERENCE from upstream's published
conventions — none is a measurement on this project's hardware:

- **~4.4 GB image pull.** A proxy from the published image sizes, not a
  measurement; on-disk after decompression is larger.
- **~10 GiB model-cache disk.** This is the number upstream's own PVC
  example uses. With the pinned image the models are BAKED at build time —
  this figure is the headroom an operator keeps free, not a runtime fetch
  (the sidecar's network is `internal: true`; there is no egress to fetch
  from).
- **2–4 GiB RAM per worker.** Inferred from upstream's k8s request/limit
  conventions, NOT measured. The overlay's `mem_limit: 4g` fits one worker
  inside that band; raise it before raising worker counts.
- **Per-page latency: UNMEASURED. No SLA is claimed.** A 200-page scan is
  roughly ten minutes of CPU on the upstream figures — and is over the
  default page cap regardless (next section).

## The budget arithmetic (dcl-05)

Defaults: `maxPages 40`, `timeoutMs 300000`, `workerBudgetMs 360000`,
poll interval 2000 ms, poll slack 30000 ms. They are not independent:

```
maxPages × 6000 ms  ≤  timeoutMs  ≤  workerBudgetMs − 30000 ms
      40 × 6 s = 240 s ≤      300 s      ≤        360 − 30 = 330 s  ✓
```

**Raising `maxPages` means raising `timeoutMs` and `workerBudgetMs
together.** The naive pairing (200 pages under the default 300 s timeout)
makes every scanned PDF over ~40 pages deterministically time out into the
baseline fallback — the default configuration would be unable to OCR the
exact artifact this sidecar exists for. A test asserts the arithmetic over
the shipped constants, so the suite goes red if one constant moves without
the others. The deadline is OURS, not the server's: docling-serve's own
`DOCLING_SERVE_MAX_SYNC_WAIT` is 120 s, which is why the client uses the
async endpoints with polling.

A document over `maxPages` never sends bytes: it records the
`docling-page-cap` fallback reason and the upload succeeds on baseline.

## If the container will not boot read-only

`read_only: true` is shipped in the overlay, but whether this image boots
read-only is UNVERIFIED — the baked artifacts path is outside `/tmp` and
lock files may write there. **The recorded deviation: drop `read_only`,
keep every other control** (`cap_drop`, `no-new-privileges`, empty
`volumes`, `internal: true`, the limits). dcl-07's live lane is what
actually finds out; until then the YAML shape is asserted offline, and the
deviation above is the only supported change to it.

## Every control, asserted in CI without pulling anything

`tests/docling-compose.test.ts` parses the overlay as YAML and asserts:
digest-pinned image; `internal: true` network; `cap_drop: [ALL]`;
`no-new-privileges:true`; empty volumes; `mem_limit`/`cpus`/`pids_limit`;
`read_only` with tmpfs; the artifacts healthcheck; `depends_on …
service_healthy` on the servo service; and NO environment key that could
enable remote services. Deleting any control goes red in the lane everyone
runs — no container is started to check.
