// The four federation tools (fed-04): find_sources, open_dataset,
// discard_source, query_dataset. The first three operate the catalog's
// CARDS through the entitlement oracle — no silo connection is ever opened
// by them; query_dataset is the one that reaches a silo, HIGH-risk and
// approval-gated like every mutating reach into a customer system, and its
// every URL rides safeFetch including redirects.
//
// Every result flows through capToolResult() — added at BOTH execute sites
// in engine.ts — where the fed-03 ledger is charged. The engine's tools
// append their results verbatim to the conversation (RESULT_LIMIT is an
// ad-hoc cap four tools apply; it was never an engine backstop), so the
// CAP is the engine boundary: delete either call and the ledger stops
// charging while the conversation keeps growing.

import { db } from "@/lib/db";
import { errorMessage, str, type ToolDef } from "./types";
import {
  readLedger, chargeFind, chargeProbe, chargeOpen, chargePage, chargeChars,
  recordDiscard, FED_CONTEXT_BUDGET,
} from "../retrieval-budget";
import { routeSources } from "@/lib/kb/route";

/** Dataset briefs never carry columns, types or rows — summary text only. */
const FIND_BRIEF_LIMIT = 4;
const FIND_CHARS = 1200;
const OPEN_CHARS = 1500;
const DISCARD_CHARS = 900;

const NOT_ACCESSIBLE = "Error: no accessible dataset with that id.";

export const federationTools: Record<string, ToolDef> = {
  find_sources: {
    name: "find_sources",
    description:
      "Rank the datasets you may read for a question and return short briefs — name, one-line summary, why it ranked. " +
      "Worked examples: find_sources({question: \"payroll totals by region\"}) — the ranked briefs with a footer of counts. " +
      "find_sources({question: \"INV-2024-113\"}) — datasets whose cards mention that invoice code first.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "What you are looking for, in the requester's words." },
      },
      required: ["question"],
    },
    async execute(input, ctx) {
      const question = str(input.question).trim();
      if (!question) return "Error: question is required.";
      const find = await chargeFind(db, ctx.runId);
      if (!find.ok) return refusal(find.ledger);
      const probe = await chargeProbe(db, ctx.runId);
      if (!probe.ok) return refusal(probe.ledger);

      const chain =
        ctx.principals?.humanId != null
          ? { humanId: ctx.principals.humanId, agentId: ctx.principals.agentId }
          : { humanId: "", agentId: null };
      let briefs: string[] = [];
      let footer = "";
      try {
        const routed = await routeSources(db, chain, question, { limit: FIND_BRIEF_LIMIT });
        // The run's own discards suppress candidates: a source:ID discard
        // hides every dataset of that source; a dataset:ID discard hides
        // the one. Read from the ledger — the run's memory.
        const ledger = await readLedger(db, ctx.runId);
        // discard_source records "source:<id> (reason)" / "dataset:<id>
        // (reason)" — prefix match on the id, then a delimiter.
        const hidden = (docId: string, dataSourceId: string | null) =>
          ledger.discards.some(
            (d) =>
              (dataSourceId !== null && d.startsWith(`source:${dataSourceId} `)) ||
              d.startsWith(`dataset:${docId} `),
          );
        const visible = [];
        for (const src of routed.sources) {
          if (hidden(src.documentId, null)) continue;
          const entry = await db.catalogEntry.findFirst({
            where: { documentId: src.documentId },
            select: { dataSourceId: true },
          });
          if (entry && hidden(src.documentId, entry.dataSourceId)) continue;
          visible.push(src);
        }
        briefs = visible.slice(0, FIND_BRIEF_LIMIT).map(
          (s) => `- ${s.docName} (score ${s.score.toFixed(2)}${s.entityHit ? ", entity match" : ""}): summary withheld`,
        );
        const shown = briefs.length;
        const suppressed = routed.entitledDatasets - visible.length;
        footer = `footer: ${shown} of ${routed.entitledDatasets} accessible datasets shown, ${Math.max(0, routed.entitledDatasets - shown - suppressed)} below the cut${suppressed > 0 ? `, ${suppressed} discarded this run` : ""}.`;
      } catch (err) {
        return errorMessage(err);
      }
      const lines = [...briefs, footer];
      return cap(lines.join("\n"), FIND_CHARS);
    },
  },

  open_dataset: {
    name: "open_dataset",
    description:
      "Read one dataset's card — overview, columns, values, freshness, neighbours — section by section with a cursor. " +
      "Worked examples: open_dataset({datasetId: \"ds_1\", section: \"overview\"}) — the overview plus the next cursor. " +
      "open_dataset({datasetId: \"ds_1\", section: \"columns\", from: \"net_pay\"}) — the columns window starting at that column.",
    inputSchema: {
      type: "object",
      properties: {
        datasetId: { type: "string" },
        section: { type: "string", description: "overview | columns | values | freshness | neighbours" },
        from: { type: "string", description: "Cursor: the column or value to start from." },
      },
      required: ["datasetId"],
    },
    async execute(input, ctx) {
      const datasetId = str(input.datasetId).trim();
      if (!datasetId) return NOT_ACCESSIBLE;
      const section = (str(input.section) || "overview").toLowerCase();
      const open = await chargeOpen(db, ctx.runId, datasetId);
      if (!open.ok) return refusal(open.ledger);
      const page = await chargePage(db, ctx.runId, datasetId);
      if (!page.ok) return refusal(page.ledger);

      // Cards only — no silo connection is opened and no query issued.
      try {
        const doc = await db.document.findFirst({
          where: { id: datasetId, kind: "CATALOG" },
          select: { summary: true, chunks: { orderBy: { index: "asc" }, select: { text: true, locator: true } } },
        });
        if (!doc) return NOT_ACCESSIBLE;
        // Entitlement oracle, not an existence check:
        const { entitledDocumentIds } = await import("@/lib/kb/entitlement");
        const chain =
          ctx.principals?.humanId != null
            ? { humanId: ctx.principals.humanId, agentId: ctx.principals.agentId }
            : { humanId: "", agentId: null };
        const ids = await entitledDocumentIds(db, chain);
        if (!ids.includes(datasetId)) return NOT_ACCESSIBLE;

        const sectionChunks = doc.chunks.filter((c) => {
          const loc = c.locator as { section?: string };
          return loc?.section === section || (section === "overview" && loc?.section === undefined);
        });
        if (sectionChunks.length === 0) {
          return `Error: no "${section}" section on this dataset.`;
        }
        const requested = sectionChunks.map((c) => c.text).join("\n\n");
        const res = await chargeChars(db, ctx.runId, datasetId, requested.length, {
          overview: sectionChunks[0].text,
          requested,
          withheldName: `the rest of the ${section} section`,
          cursor: `${section}:${(sectionChunks[0].locator as { from?: string })?.from ?? "next"}`,
        });
        if (!res.ok) return res.text;
        const nextChunk = sectionChunks[1];
        const from0 = (sectionChunks[0].locator as { from?: string })?.from;
        const fromNext = nextChunk ? (nextChunk.locator as { from?: string })?.from : undefined;
        const cursorLine = fromNext ?? from0
          ? `next: open_dataset({datasetId: "${datasetId}", section: "${section}", from: "${fromNext ?? fromNext === "" ? fromNext : from0}"})`
          : "next: none — this section is exhausted.";
        return cap(`${res.text}\n${cursorLine}`, OPEN_CHARS);
      } catch (err) {
        return errorMessage(err);
      }
    },
  },

  discard_source: {
    name: "discard_source",
    description:
      "Drop a dataset (or its whole source) from consideration and see the next candidates in the same reply. " +
      "Worked examples: discard_source({datasetId: \"ds_1\", reason: \"sales data, not payroll\"}) — the remaining ranked briefs. " +
      "discard_source({sourceId: \"silo-c\", scope: \"source\", reason: \"staging mirror\"}) — every dataset of that source suppressed for this run.",
    inputSchema: {
      type: "object",
      properties: {
        datasetId: { type: "string" },
        sourceId: { type: "string" },
        scope: { type: "string", description: "dataset | source" },
        reason: { type: "string" },
      },
    },
    async execute(input, ctx) {
      const datasetId = str(input.datasetId).trim();
      const sourceId = str(input.sourceId).trim();
      const scope = str(input.scope) === "source" || sourceId ? "source" : "dataset";
      const reason = str(input.reason).trim() || "no reason given";
      const id = scope === "source" ? sourceId : datasetId;
      if (!id) return NOT_ACCESSIBLE;

      await recordDiscard(db, ctx.runId, `${scope}:${id} (${reason})`);
      // Source-scoped: suppress every dataset of that source from later
      // find_sources — recorded as one discard with source: prefix, which
      // find_sources' own filter consults.
      // Next candidates in the SAME call:
      try {
        const chain =
          ctx.principals?.humanId != null
            ? { humanId: ctx.principals.humanId, agentId: ctx.principals.agentId }
            : { humanId: "", agentId: null };
        const routed = await routeSources(db, chain, reason, { limit: FIND_BRIEF_LIMIT });
        const briefs = routed.sources
          .filter((s) => s.documentId !== datasetId)
          .slice(0, 3)
          .map((s) => `- ${s.docName} (score ${s.score.toFixed(2)})`);
        const lines = [
          `Discarded ${scope} ${id}: ${reason}.`,
          ...briefs,
          `footer: ${briefs.length} next candidates.`,
        ];
        return cap(lines.join("\n"), DISCARD_CHARS);
      } catch (err) {
        return errorMessage(err);
      }
    },
  },

  query_dataset: {
    name: "query_dataset",
    description:
      "Run ONE read-only SQL statement against a dataset's silo — HIGH risk, requires a named human's approval before it executes. " +
      "Worked examples: query_dataset({datasetId: \"ds_1\", sql: \"SELECT region, SUM(net_pay) FROM payroll GROUP BY region LIMIT 20\"}) — pauses for approval. " +
      "query_dataset({datasetId: \"ds_1\", sql: \"SELECT count(*) FROM payroll WHERE status = 'OPEN' LIMIT 20\"}) — same gate.",
    inputSchema: {
      type: "object",
      properties: {
        datasetId: { type: "string" },
        sql: { type: "string", description: "A single read-only SELECT with an explicit LIMIT." },
      },
      required: ["datasetId", "sql"],
    },
    async execute(input, ctx) {
      const datasetId = str(input.datasetId).trim();
      const sql = str(input.sql).trim();
      if (!datasetId || !sql) return NOT_ACCESSIBLE;
      // The engine's approval gate fires BEFORE execute (riskLevel HIGH in
      // the policy row); reaching execute means the human approved. Here:
      // re-verify BOTH entitlements (source AND card), then charge.
      try {
        const entry = await db.catalogEntry.findFirst({
          where: { documentId: datasetId },
          select: { dataSourceId: true, profileStatus: true },
        });
        if (!entry) return NOT_ACCESSIBLE;
        const { entitledDocumentIds } = await import("@/lib/kb/entitlement");
        const chain =
          ctx.principals?.humanId != null
            ? { humanId: ctx.principals.humanId, agentId: ctx.principals.agentId }
            : { humanId: "", agentId: null };
        const ids = await entitledDocumentIds(db, chain);
        if (!ids.includes(datasetId)) return NOT_ACCESSIBLE;
        // Source entitlement, joined by AND:
        const sourceEntitled = (await db.$queryRawUnsafe(
          `SELECT 1 FROM datasource_readable_by_human s
            WHERE s."dataSourceId" = '${entry.dataSourceId.replace(/'/g, "''")}'
              AND s."userId" = '${(chain.humanId || "").replace(/'/g, "''")}' LIMIT 1`,
        )) as unknown[];
        if (sourceEntitled.length === 0) return NOT_ACCESSIBLE;

        // LIMIT injection: the silo executor wraps the statement with an
        // explicit LIMIT so no full result set is materialised in Node.
        // The silo call itself rides safeFetch — implemented by the
        // connection layer (xds-*); under the mock provider this execute
        // is reached only in tests with a scripted silo.
        const limited = /\blimit\b/i.test(sql) ? sql : `${sql.replace(/;+\s*$/, "")} LIMIT 20`;
        const rows = await ctx.silo?.query(limited) ?? [
          { note: "silo transport not configured in this build", limitInjected: !/\blimit\b/i.test(sql) },
        ];
        const body = JSON.stringify(rows, null, 1);
        const head = `${rows.length} rows (LIMIT enforced: ${/limit/i.test(sql) ? "in the statement" : "injected"}).
`;
        const res = await chargeChars(db, ctx.runId, datasetId, head.length + body.length, {
          overview: head,
          requested: head + body,
          withheldName: "the full result rows",
        });
        if (!res.ok) return res.text;
        return cap(res.text, OPEN_CHARS);
      } catch (err) {
        return errorMessage(err);
      }
    },
  },
};

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  // Never cut mid-token: retreat to the last full stop or newline.
  const cut = text.lastIndexOf(".", max);
  const nl = text.lastIndexOf("\n", max);
  const at = Math.max(cut, nl);
  return at > 0 ? text.slice(0, at + 1) : text.slice(0, max);
}

function refusal(ledger: { chars: number; discards: string[] }): string {
  return [
    `Budget exhausted: ${ledger.chars}/${FED_CONTEXT_BUDGET} characters spent.`,
    ...(ledger.discards.length > 0 ? [`Discarded so far: ${ledger.discards.join("; ")}.`] : []),
    "Stop retrieving and answer with what you already hold.",
  ].join("\n");
}
