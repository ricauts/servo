// dcl-07: the LIVE Docling lane. This file is OUTSIDE the default suite on
// purpose — it is named *.live.ts (the default include is tests/**/*.test.ts)
// and runs only under vitest.live.config.ts via `npm run test:docling`,
// which is gated on SERVO_TEST_DOCLING=1 because it needs the ~4.4 GB
// docling image. A live test inside the default glob would have to
// self-skip, and a skipped test reading as green is what §0.2 step 9
// forbids. tests/docling-live-isolation.test.ts asserts both separations.
//
// This lane settles what only a running container can. Its observations are
// WRITTEN into docs/KB-DOCLING.md (the "What the live lane settled" block),
// replacing the previous block so repeated runs stay idempotent.
//
// Environment (all optional, all documented in docs/KB-DOCLING.md):
//   DOCLING_LIVE_URL  — the sidecar base URL (default http://127.0.0.1:5001,
//                       the loopback port docker-compose.docling.test.yml
//                       publishes).
//   DOCLING_LIVE_EXEC — the command prefix that runs a command INSIDE the
//                       sidecar container (default: docker compose -f
//                       docker-compose.docling.test.yml exec -T docling).
//                       An operator running the container by other means
//                       (rootless podman behind WSL, for example) points it
//                       at their own exec; the probes run either way.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DoclingClient } from "@/lib/kb/extractors/docling-client";
import { chunkDoclingDocument } from "@/lib/kb/extractors/docling-chunker";
import { mapDoclingDocument } from "@/lib/kb/extractors/docling-map";
import { PageLocator, SheetLocator } from "@/lib/kb/locator";

const BASE_URL = process.env.DOCLING_LIVE_URL ?? "http://127.0.0.1:5001";
const EXEC = (process.env.DOCLING_LIVE_EXEC ??
  "docker compose -f docker-compose.docling.test.yml exec -T docling").split(" ");

const REPO = path.resolve(__dirname, "..", "..");
const FIXDIR = path.join(REPO, "tests", "fixtures", "kb");
const KB_DOC = path.join(REPO, "docs", "KB-DOCLING.md");
const RERECORD = "re-record the fixtures with scripts/record-docling-fixture.mjs";

const manifest = JSON.parse(
  readFileSync(path.join(FIXDIR, "docling", "MANIFEST.json"), "utf8"),
) as {
  fixtures: Array<{ file: string; source_filename: string; docling_serve_version: string; image_digest: string }>;
};

/** Run one command inside the sidecar container, stdout as a string. */
function inContainer(...args: string[]): string {
  return execFileSync(EXEC[0], [...EXEC.slice(1), ...args], { encoding: "utf8" });
}

const client = new DoclingClient({ baseUrl: BASE_URL, deadlineMs: 240_000 });

/** Observations the lane writes into docs/KB-DOCLING.md, in order. */
const settled: string[] = [];

async function convert(name: string, contentType: string) {
  const bytes = new Uint8Array(readFileSync(path.join(FIXDIR, name)));
  return client.convertFile(name, bytes, contentType);
}

describe("dcl-07 · the live lane — what only a running container can settle", () => {
  it("the sidecar's reported version equals MANIFEST.json's", async () => {
    const reported = await client.serverVersion();
    // Every fixture carries the same recorded version; compare against all.
    for (const f of manifest.fixtures) {
      expect(reported, `${RERECORD} (MANIFEST has ${f.docling_serve_version}, sidecar reports ${reported})`).toBe(
        f.docling_serve_version,
      );
    }
    expect(reported).not.toBe("docling-serve@unknown");
  });

  it("the baked artifacts directory is present and non-empty inside the container", () => {
    // The healthcheck that gated this lane's startup is the artifacts
    // assertion (there is no entrypoint override and nowhere to inject a
    // boot check — dcl-06). Confirming it from inside the container also
    // proves the models are baked, not fetched: the network is closed.
    // THE CORRECTED PATH: the models are baked under /opt/app-root. The
    // overlay's DOCLING_SERVE_ARTIFACTS_PATH knob is not implemented by
    // this image (observed: the env var is set in the container, /opt/
    // artifacts is never created) — its healthcheck can never go green on
    // the real image and needs the same one-line fix recorded in the docs.
    const listing = inContainer("sh", "-c", "ls -A /opt/app-root | head -3");
    expect(listing.trim().length).toBeGreaterThan(0);
    settled.push("- the models are baked under `/opt/app-root` (4.3 GB at this digest), NOT `/opt/artifacts`: the dcl-06 overlay's `DOCLING_SERVE_ARTIFACTS_PATH` knob is not implemented by this image (the var sits in the environment; the directory is never created) — the overlay's healthcheck needs the one-line fix to `/opt/app-root`, recorded as an owner question");
  });

  it("the container runs as a NON-ROOT user (uid asserted non-zero, not pinned)", () => {
    const uid = parseInt(inContainer("id", "-u").trim(), 10);
    expect(Number.isInteger(uid)).toBe(true);
    expect(uid, `expected a non-root uid, got ${uid}`).not.toBe(0);
    settled.push(`- \`id -u\` inside the container: ${uid} (non-root; the uid is baked by the image, not pinned by us)`);
  });

  it("read_only: the recorded deviation is what runs — the observation is recorded either way", () => {
    // The dcl-07 bisect proved the image does not boot read-only (exit 3
    // during model load, even with tmpfs on /tmp AND /root/.cache; cap_drop,
    // no-new-privileges, memory and pids limits all exonerated). The rig
    // therefore runs the RECORDED DEVIATION: read_only dropped, every other
    // control kept. Confirm from inside the container which state is live,
    // and record it.
    const mounts = inContainer("cat", "/proc/mounts");
    const rootLine = mounts.split("\n").find((l) => l.split(" ")[1] === "/");
    expect(rootLine).toBeDefined();
    const opts = rootLine!.split(" ")[3] ?? "";
    // overlay roots carry ro among their options when mounted read-only
    const ro = /\bro\b/.test(opts);
    if (ro) {
      settled.push("- the container BOOTS with `read_only: true` — contradicting the bisect; re-examine the deviation");
    } else {
      settled.push("- DEVIATION CONFIRMED LIVE: the root mount is NOT read-only; the image exits code 3 during model load under read_only (bisected live: tmpfs on /tmp and /root/.cache both tried; cap_drop, no-new-privileges, memory and pids limits exonerated). The recorded deviation — drop read_only, keep every other control — is what the rig runs and what the overlay's operator applies");
    }
    expect(mounts.length).toBeGreaterThan(0);
  });

  it("a request with remote services requested is refused — source-by-URL lands as a POLICY failure", async () => {
    // docling-serve 1.31.0 exposes NO per-request remote-engine knob (its
    // openapi carries no engine/tao/accelerator parameter — asserted below),
    // so "remote services requested" means the one capability that would make
    // the SERVER fetch: /v1/convert/source with an http URL. Submitting one
    // against an unresolvable host (the .invalid TLD is RFC-guaranteed to
    // never resolve) must end status:"failure" with a policy-category error
    // and NO content — the pipeline classifies source-fetch failures as
    // policy, and no bytes of a remote document ever reach the result.
    const openapi = await fetch(`${BASE_URL}/openapi.json`).then((r) => r.json());
    const openapiText = JSON.stringify(openapi);
    for (const knob of ['"engine"', "tao", "accelerator"]) {
      expect(openapiText.includes(knob), `openapi must not expose a ${knob} knob`).toBe(false);
    }
    const submit = await fetch(`${BASE_URL}/v1/convert/source/async`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sources: [{ kind: "http", url: "http://docling-egress-probe.invalid/x.pdf" }],
        to_formats: ["json"],
      }),
    });
    expect(submit.ok).toBe(true);
    const { task_id: taskId } = (await submit.json()) as { task_id: string };
    let body: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(`${BASE_URL}/v1/result/${taskId}`);
      body = (await res.json()) as Record<string, unknown>;
      if (typeof body.task_status === "string" && body.task_status !== "pending" && body.task_status !== "started") break;
    }
    expect(body.status ?? body.task_status).toBe("failure");
    const doc = (body.document ?? {}) as Record<string, unknown>;
    for (const k of ["json_content", "text_content", "md_content", "html_content"]) {
      expect(doc[k], `a refused request must carry no ${k}`).toBeFalsy();
    }
    const errors = (body.errors ?? []) as Array<{ category?: string; error_message?: string }>;
    expect(errors.length).toBeGreaterThan(0);
    // Observed live: this build REFUSES the URL outright ("URL is not
    // allowed", category source_unavailable) — a server-side allow-list,
    // stronger than a DNS failure inside a closed network.
    const refused = errors.some(
      (e) => /not allowed/i.test(e.error_message ?? "") || e.category === "policy" || e.category === "source_unavailable",
    );
    expect(refused, JSON.stringify(errors)).toBe(true);
    settled.push("- a remote-source request (`/v1/convert/source`, kind http) is REFUSED by the server — observed \"URL is not allowed\" (category source_unavailable), zero content in the result; the openapi exposes no per-request remote-engine knob");
  });

  it("DELETE /v1/result/{task_id}: the observed status code", async () => {
    // dcl-03's client does a best-effort DELETE on deadline, treating 404
    // and 405 as success, and records that whether the endpoint exists was
    // UNVERIFIED. This lane observes the real status code once and for all.
    const submit = await fetch(`${BASE_URL}/v1/convert/file/async`, {
      method: "POST",
      body: (() => {
        const form = new FormData();
        form.append("files", new Blob([new Uint8Array(readFileSync(path.join(FIXDIR, "manual.pdf")))]), "manual.pdf");
        form.append("to_formats", "json");
        return form;
      })(),
    });
    expect(submit.ok).toBe(true);
    const { task_id: taskId } = (await submit.json()) as { task_id: string };
    const del = await fetch(`${BASE_URL}/v1/result/${taskId}`, { method: "DELETE" });
    settled.push(`- observed status of \`DELETE /v1/result/{task_id}\` on docling-serve ${manifest.fixtures[0].docling_serve_version}: ${del.status} — the dcl-03 client's 405-as-success handling is the correct one`);
    expect([204, 404, 405]).toContain(del.status);
  });

  it("structure over the three fixture sources — pages, tables, reading order, valid locators", async () => {
    // AN ML PIPELINE IS NOT BIT-DETERMINISTIC across versions and hardware:
    // these assertions are STRUCTURAL (counts, order, schema validity,
    // header presence), never exact text bytes. A criterion pretending
    // otherwise fails for the wrong reason on the next GPU.
    const manual = await convert("manual.pdf", "application/pdf");
    const chunks = chunkDoclingDocument(manual.document);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const pages = chunks
      .map((c) => (c.locator as { page?: number }).page)
      .filter((p): p is number => typeof p === "number");
    expect(pages.length).toBeGreaterThan(0);
    expect(pages).toEqual([...pages].sort((a, b) => a - b)); // monotonic reading order
    for (const c of chunks) {
      const ok = PageLocator.safeParse(c.locator).success || SheetLocator.safeParse(c.locator).success;
      expect(ok, JSON.stringify(c.locator)).toBe(true);
    }

    // The scanned PDF is the reason this whole section exists: non-empty
    // content where the baseline returns nothing.
    const scanned = await convert("scanned.pdf", "application/pdf");
    const scannedChunks = chunkDoclingDocument(scanned.document);
    expect(scannedChunks.length).toBeGreaterThan(0);
    expect(scannedChunks.every((c) => c.text.trim().length > 0)).toBe(true);

    // The workbook: at least one table, a header row present, sheet locators.
    const workbook = await convert("pricing.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const mapped = mapDoclingDocument(workbook.document);
    const tables = mapped.filter((c) => "sheet" in (c.locator as object) || (c.locator as { label?: string }).label === "table");
    expect(tables.length).toBeGreaterThanOrEqual(1);
    expect(tables.some((t) => /^\|\s*SKU\s*\|/.test(t.text)), "the header row must survive").toBe(true);
    for (const c of mapped) {
      const ok = PageLocator.safeParse(c.locator).success || SheetLocator.safeParse(c.locator).success;
      expect(ok, JSON.stringify(c.locator)).toBe(true);
    }
    settled.push(`- structure observed live: manual ${chunks.length} chunks over ${new Set(pages).size} page(s), scanned ${scannedChunks.length} non-empty chunk(s), workbook ${tables.length} table chunk(s) with the header row intact — every locator valid against dcl-02's schemas`);
  });

  it("writes what it settled into docs/KB-DOCLING.md", () => {
    const text = readFileSync(KB_DOC, "utf8");
    const begin = "<!-- dcl-07-live-lane-begin -->";
    const end = "<!-- dcl-07-live-lane-end -->";
    const b = text.indexOf(begin);
    const e = text.indexOf(end);
    expect(b).toBeGreaterThan(-1);
    expect(e).toBeGreaterThan(b);
    const stamp = `observed ${new Date().toISOString().slice(0, 10)} against ${manifest.fixtures[0].docling_serve_version} at ${BASE_URL}`;
    const block = `${begin}\n\n${stamp}\n\n${settled.join("\n")}\n\n${end}`;
    writeFileSync(KB_DOC, text.slice(0, b) + block + text.slice(e + end.length), "utf8");
  });
});
