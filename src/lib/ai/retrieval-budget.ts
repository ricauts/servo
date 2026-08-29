// The retrieval ledger and the tool-layer budgets (fed-03). The ledger IS
// AgentRun.retrieval (the column cat-01 added): {probed, opened, discarded,
// perDataset, chars, hops, finds, compacted}. Every charge is a
// read-modify-write inside a transaction on the AgentRun row, so a run
// paused on an approval and resumed through resumeAfterApproval reads back
// the SAME counters — the ledger is the row, not memory.
//
// Budget is measured in CHARACTERS, and the comment states why: there is
// no offline tokenizer for the mock provider, and an UNASSERTABLE BUDGET
// IS NOT A BUDGET.
//
// THE LEDGER IS MONOTONE: no exported function decreases any counter. A
// refunding compaction would let probe→discard→compact→probe loop
// unboundedly through a fixed budget — compaction therefore only RECORDS
// that it happened (compacted++), never gives characters back.

export const MAX_FIND_CALLS = 6;
export const MAX_SOURCES_PROBED = 8;
export const MAX_DATASETS_OPENED = 3;
export const MAX_HOPS = 4;
export const MAX_CHARS_PER_DATASET = 3000;
export const MAX_PAGES_PER_DATASET = 3;
export const FED_CONTEXT_BUDGET = 24000;

export interface Ledger {
  probed: number;
  opened: number;
  discarded: number;
  perDataset: Record<string, { chars: number; pages: number }>;
  chars: number;
  hops: number;
  finds: number;
  compacted: number;
  /** Every discard reason recorded so far — surfaced on exhaustion. */
  discards: string[];
}

export function emptyLedger(): Ledger {
  return {
    probed: 0, opened: 0, discarded: 0, perDataset: {},
    chars: 0, hops: 0, finds: 0, compacted: 0, discards: [],
  };
}

/** Structural: raw or $extends clients. */
interface LedgerDb {
  $transaction<T>(fn: (tx: { agentRun: { findUnique(args: unknown): Promise<{ retrieval: unknown } | null>; update(args: unknown): Promise<unknown> } }) => Promise<T>): Promise<T>;
}

/** Read the ledger of a run (a fresh empty one for runs predating it). */
export async function readLedger(db: LedgerDb, runId: string): Promise<Ledger> {
  const run = await db.$transaction(async (tx) => {
    return tx.agentRun.findUnique({ where: { id: runId }, select: { retrieval: true } });
  });
  return asLedger((run as { retrieval?: unknown } | null)?.retrieval);
}

function asLedger(raw: unknown): Ledger {
  if (raw === null || raw === undefined) return emptyLedger();
  const r = raw as Partial<Ledger>;
  return { ...emptyLedger(), ...r, perDataset: { ...(r.perDataset ?? {}) }, discards: [...(r.discards ?? [])] };
}

async function modify(
  db: LedgerDb,
  runId: string,
  fn: (l: Ledger) => string | null, // returns a discard reason or null
): Promise<Ledger> {
  return db.$transaction(async (tx) => {
    const run = (await tx.agentRun.findUnique({ where: { id: runId }, select: { retrieval: true } })) as
      | { retrieval: unknown }
      | null;
    const ledger = asLedger(run?.retrieval);
    const reason = fn(ledger);
    if (reason !== null && !ledger.discards.includes(reason)) ledger.discards.push(reason);
    await tx.agentRun.update({
      where: { id: runId },
      data: { retrieval: ledger as unknown as object },
    });
    return ledger;
  });
}

/** Charge one find() call. Refuses past MAX_FIND_CALLS — never throws. */
export async function chargeFind(db: LedgerDb, runId: string): Promise<{ ok: boolean; ledger: Ledger }> {
  const ledger = await readLedger(db, runId);
  if (ledger.finds >= MAX_FIND_CALLS) {
    await modify(db, runId, () => `find: ${ledger.finds} calls (cap ${MAX_FIND_CALLS})`);
    return { ok: false, ledger: await readLedger(db, runId) };
  }
  const after = await modify(db, runId, (l) => {
    l.finds++;
    return null;
  });
  return { ok: true, ledger: after };
}

/** Charge one source probe. Refuses past MAX_SOURCES_PROBED. */
export async function chargeProbe(db: LedgerDb, runId: string): Promise<{ ok: boolean; ledger: Ledger }> {
  const current = await readLedger(db, runId);
  if (current.probed >= MAX_SOURCES_PROBED) {
    await modify(db, runId, () => `probe: ${current.probed} sources (cap ${MAX_SOURCES_PROBED})`);
    return { ok: false, ledger: await readLedger(db, runId) };
  }
  const ledger = await modify(db, runId, (l) => {
    l.probed++;
    return null;
  });
  return { ok: true, ledger };
}

/** Charge one router hop. Refuses past MAX_HOPS. */
export async function chargeHop(db: LedgerDb, runId: string): Promise<{ ok: boolean; ledger: Ledger }> {
  const current = await readLedger(db, runId);
  if (current.hops >= MAX_HOPS) {
    await modify(db, runId, () => `hop: ${current.hops} hops (cap ${MAX_HOPS})`);
    return { ok: false, ledger: await readLedger(db, runId) };
  }
  const ledger = await modify(db, runId, (l) => {
    l.hops++;
    return null;
  });
  return { ok: true, ledger };
}

/** Charge opening one dataset's card. Refuses past MAX_DATASETS_OPENED and
 *  past the per-dataset caps — the per-dataset pages/chars refusals are
 *  SEPARATE from the global budget, checked independently. */
export async function chargeOpen(db: LedgerDb, runId: string, datasetId: string): Promise<{ ok: boolean; ledger: Ledger }> {
  const current = await readLedger(db, runId);
  const per = current.perDataset[datasetId];
  const globalRefusal = current.opened >= MAX_DATASETS_OPENED;
  const pagesRefusal = per !== undefined && per.pages >= MAX_PAGES_PER_DATASET;
  const charsRefusal = per !== undefined && per.chars >= MAX_CHARS_PER_DATASET;
  if (globalRefusal || pagesRefusal || charsRefusal) {
    const reason = globalRefusal
      ? `open: ${current.opened} datasets (cap ${MAX_DATASETS_OPENED})`
      : pagesRefusal
        ? `open ${datasetId}: ${per!.pages} pages (cap ${MAX_PAGES_PER_DATASET})`
        : `open ${datasetId}: ${per!.chars} chars (cap ${MAX_CHARS_PER_DATASET})`;
    await modify(db, runId, () => reason);
    return { ok: false, ledger: await readLedger(db, runId) };
  }
  const ledger = await modify(db, runId, (l) => {
    if (l.perDataset[datasetId] === undefined) {
      l.opened++; // first open of this dataset
      l.perDataset[datasetId] = { chars: 0, pages: 0 };
    }
    return null;
  });
  return { ok: true, ledger };
}

/** Charge one page read within a dataset (the router's cursor step). */
export async function chargePage(db: LedgerDb, runId: string, datasetId: string): Promise<{ ok: boolean; ledger: Ledger }> {
  const current = await readLedger(db, runId);
  const per = current.perDataset[datasetId];
  if (per !== undefined && per.pages >= MAX_PAGES_PER_DATASET) {
    await modify(db, runId, () => `page ${datasetId}: ${per.pages} pages (cap ${MAX_PAGES_PER_DATASET})`);
    return { ok: false, ledger: await readLedger(db, runId) };
  }
  const ledger = await modify(db, runId, (l) => {
    const p = l.perDataset[datasetId] ?? (l.perDataset[datasetId] = { chars: 0, pages: 0 });
    p.pages++;
    return null;
  });
  return { ok: true, ledger };
}

export interface ChargeCharsResult {
  ok: boolean;
  /** The characters ACTUALLY granted — a downgrade returns fewer. */
  granted: number;
  /** What the helper returned to the caller (card text / refusal). */
  text: string;
  ledger: Ledger;
}

/**
 * Charge characters against BOTH budgets (per-dataset and global). This is
 * where DOWNGRADE, never truncate, lives: with 900 global characters left,
 * a request for a 1200-character card gets the OVERVIEW section plus the
 * cursor and a line naming what was withheld. No string is cut mid-token:
 * every returned string ends on a newline or a full stop. On refusal the
 * helper returns the terminal refusal string with the spent/total counters
 * and every discard reason recorded so far — it NEVER throws.
 */
export async function chargeChars(
  db: LedgerDb,
  runId: string,
  datasetId: string,
  requested: number,
  sections: { overview: string; requested?: string; withheldName?: string; cursor?: string },
): Promise<ChargeCharsResult> {
  const current = await readLedger(db, runId);
  const per = current.perDataset[datasetId] ?? { chars: 0, pages: 0 };
  const globalRemaining = FED_CONTEXT_BUDGET - current.chars;
  const perRemaining = MAX_CHARS_PER_DATASET - per.chars;

  // Hard refusals (both caps checked SEPARATELY, per the acceptance):
  if (per.chars >= MAX_CHARS_PER_DATASET) {
    const reason = `chars ${datasetId}: ${per.chars}/${MAX_CHARS_PER_DATASET} per dataset`;
    await modify(db, runId, () => reason);
    return {
      ok: false, granted: 0,
      text: refusalText(await readLedger(db, runId)),
      ledger: await readLedger(db, runId),
    };
  }
  if (current.chars >= FED_CONTEXT_BUDGET) {
    const reason = `chars global: ${current.chars}/${FED_CONTEXT_BUDGET}`;
    await modify(db, runId, () => reason);
    return {
      ok: false, granted: 0,
      text: refusalText(await readLedger(db, runId)),
      ledger: await readLedger(db, runId),
    };
  }

  const room = Math.min(globalRemaining, perRemaining, requested);
  const wanted = sections.requested ?? sections.overview;

  if (room >= wanted.length) {
    // Full grant.
    const ledger = await modify(db, runId, (l) => {
      const p = l.perDataset[datasetId] ?? (l.perDataset[datasetId] = { chars: 0, pages: 0 });
      p.chars += wanted.length;
      l.chars += wanted.length;
      return null;
    });
    return { ok: true, granted: wanted.length, text: wanted, ledger };
  }

  if (room >= sections.overview.length) {
    // DOWNGRADE: the overview fits where the full card does not. The
    // withheld line names what was held back; the cursor rides along.
    const withheld = sections.withheldName ?? "the detailed sections";
    const lines = [
      sections.overview,
      `— budget: ${room} characters remained, so ${withheld} were withheld.`,
      sections.cursor ? `resume: ${sections.cursor}.` : "",
    ].filter(Boolean);
    const text = lines.join("\n");
    const ledger = await modify(db, runId, (l) => {
      const p = l.perDataset[datasetId] ?? (l.perDataset[datasetId] = { chars: 0, pages: 0 });
      p.chars += sections.overview.length;
      l.chars += sections.overview.length;
      return null;
    });
    return { ok: true, granted: sections.overview.length, text, ledger };
  }

  // Even the overview does not fit — the terminal refusal. The reason
  // names the BINDING cap: whichever of the two budgets ran out of room
  // is the one the caller must be told about.
  const binding = perRemaining <= globalRemaining ? "per-dataset" : "global";
  const reason =
    binding === "per-dataset"
      ? `chars ${datasetId}: ${per.chars}/${MAX_CHARS_PER_DATASET} per dataset — only ${room} of ${sections.overview.length} overview characters fit`
      : `chars global: ${current.chars}/${FED_CONTEXT_BUDGET} — only ${room} of ${sections.overview.length} overview characters fit`;
  await modify(db, runId, () => reason);
  const after = await readLedger(db, runId);
  return { ok: false, granted: 0, text: refusalText(after), ledger: after };
}

/** The terminal refusal: spent/total counters AND every discard reason. */
export function refusalText(ledger: Ledger): string {
  const perDataset = Object.entries(ledger.perDataset)
    .map(([id, p]) => `${id}: ${p.chars}/${MAX_CHARS_PER_DATASET}`)
    .join(", ");
  const lines = [
    `Budget exhausted: ${ledger.chars}/${FED_CONTEXT_BUDGET} characters spent.`,
    `finds ${ledger.finds}/${MAX_FIND_CALLS}, probes ${ledger.probed}/${MAX_SOURCES_PROBED}, opens ${ledger.opened}/${MAX_DATASETS_OPENED}, hops ${ledger.hops}/${MAX_HOPS}.`,
    ...(perDataset ? [`per dataset: ${perDataset}.`] : []),
  ];
  if (ledger.discards.length > 0) {
    lines.push(`Discarded so far: ${ledger.discards.join("; ")}.`);
  }
  lines.push("Stop retrieving and answer with what you already hold.");
  return lines.join("\n");
}

/** Record a discard (a candidate the router dropped). Monotone: +1 only. */
export async function recordDiscard(db: LedgerDb, runId: string, reason: string): Promise<Ledger> {
  return modify(db, runId, (l) => {
    l.discarded++;
    void reason;
    return reason;
  });
}

/** Record that a compaction happened. Compaction NEVER refunds characters —
 *  see the module header: a refunding compaction lets the retrieval loop
 *  run unbounded through a fixed budget. */
export async function recordCompaction(db: LedgerDb, runId: string): Promise<Ledger> {
  return modify(db, runId, (l) => {
    l.compacted++;
    return null;
  });
}
