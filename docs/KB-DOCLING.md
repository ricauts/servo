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

**This is no longer a hypothetical - the live lane confirmed it (dcl-07).**
The image exits code 3 (gunicorn worker boot failure) about a minute into
model load under `read_only: true`, with tmpfs on `/tmp` alone AND with
tmpfs on both `/tmp` and `/root/.cache` - a live bisect exonerated
`cap_drop`, `no-new-privileges`, the memory limit and the pids limit;
`read_only` is the sole killer, and nothing it writes survives to stderr.
**The recorded deviation - drop `read_only`, keep every other control - is
what actually runs.** The overlay keeps the control as shipped YAML shape
per dcl-06 (its criterion was shape only); apply the deviation there when
you deploy.

**The healthcheck needs the same correction.** The overlay's
`DOCLING_SERVE_ARTIFACTS_PATH=/opt/artifacts` knob is NOT implemented by
this image - the variable sits in the container's environment but the
directory is never created, so the overlay's healthcheck can never go green
and `depends_on: condition: service_healthy` would never be satisfied on a
real deployment. The models are baked under `/opt/app-root` (4.3 GB at this
digest). The one-line fix, for both files:

```yaml
    healthcheck:
      test: ["CMD-SHELL", "test -n \"$(ls -A /opt/app-root)\""]
```

The test rig (`docker-compose.docling.test.yml`) already carries the
corrected assertion; the overlay's edit is a docker-compose diff - Tier C
under the landing rule - and is recorded as an owner question rather than
smuggled into a Tier-A tick.

## The live lane (`npm run test:docling`, opt-in)

Everything above is asserted offline. The LIVE lane drives a real container
of the same image, digest-pinned by `docker-compose.docling.test.yml` (an
offline test asserts that file's digest equals the overlay's — the lane can
never drift onto an unrecorded image). It is **gated on
`SERVO_TEST_DOCLING=1`**, is **not part of `npm test`**, and **never runs in
CI** — a 4.4 GB image is not a CI prerequisite:

```
SERVO_TEST_DOCLING=1 npm run test:docling
```

The command brings the rig up (`docker compose -f docker-compose.docling.test.yml
up -d --wait`), runs `vitest.live.config.ts` (whose include is
`tests/live/**/*.live.ts` — a different suffix than the default suite's
`tests/**/*.test.ts`, so a live test can never leak into `npm test` or have
to self-skip), and tears the rig down either way. The rig differs from the
production overlay in exactly two ways, both documented in its header: the
port is published to loopback only, and the network is the default bridge
(publishing on an internal network does not route — the no-egress production
shape lives in the overlay and is asserted offline).

The lane asserts **structure, never bytes** — an ML pipeline is not
bit-deterministic across versions and hardware — and it records what only a
running container can settle, below.

## What the live lane settled (dcl-07)

<!-- dcl-07-live-lane-begin -->

observed 2026-09-02 against docling-serve@1.31.0 at http://172.26.4.57:5002

- the models are baked under `/opt/app-root` (4.3 GB at this digest), NOT `/opt/artifacts`: the dcl-06 overlay's `DOCLING_SERVE_ARTIFACTS_PATH` knob is not implemented by this image (the var sits in the environment; the directory is never created) — the overlay's healthcheck needs the one-line fix to `/opt/app-root`, recorded as an owner question
- `id -u` inside the container: 1001 (non-root; the uid is baked by the image, not pinned by us)
- DEVIATION CONFIRMED LIVE: the root mount is NOT read-only; the image exits code 3 during model load under read_only (bisected live: tmpfs on /tmp and /root/.cache both tried; cap_drop, no-new-privileges, memory and pids limits exonerated). The recorded deviation — drop read_only, keep every other control — is what the rig runs and what the overlay's operator applies
- a remote-source request (`/v1/convert/source`, kind http) is REFUSED by the server — observed "URL is not allowed" (category source_unavailable), zero content in the result; the openapi exposes no per-request remote-engine knob
- observed status of `DELETE /v1/result/{task_id}` on docling-serve docling-serve@1.31.0: 405 — the dcl-03 client's 405-as-success handling is the correct one
- structure observed live: manual 3 chunks over 3 page(s), scanned 3 non-empty chunk(s), workbook 2 table chunk(s) with the header row intact — every locator valid against dcl-02's schemas

<!-- dcl-07-live-lane-end -->

## Every control, asserted in CI without pulling anything

`tests/docling-compose.test.ts` parses the overlay as YAML and asserts:
digest-pinned image; `internal: true` network; `cap_drop: [ALL]`;
`no-new-privileges:true`; empty volumes; `mem_limit`/`cpus`/`pids_limit`;
`read_only` with tmpfs; the artifacts healthcheck; `depends_on …
service_healthy` on the servo service; and NO environment key that could
enable remote services. Deleting any control goes red in the lane everyone
runs — no container is started to check.
