// Transcript compaction for federation results (fed-05). compactFederation
// Results replaces the CONTENT of every federation tool_result for one
// dataset in the live conversation — preserving tool_use_id so the
// conversation stays structurally valid — with a ≤120-character line that
// NAMES THE HANDLE, so open_dataset(datasetId) can re-fetch exactly what
// was removed. Compaction never refunds the ledger (fed-03's rule), runs
// only when discard_source fired AND chars exceed 60% of the budget, and
// at most once per dataset per run.
//
// AUDIT PRESERVED: the original card text stays in AgentStep.content and
// leaves AgentRun.conversation; the replacement line enters the
// conversation and never enters AgentStep.content. The step table is the
// audit trail; the conversation is working memory.

import type { ConversationMessage } from "@/lib/types";

export const COMPACTION_TRIGGER_FRACTION = 0.6;
export const COMPACTION_MAX_LINE = 120;

/** The replacement line: names the handle, ≤120 characters. When the id
 *  alone cannot fit, returns null — compaction is REFUSED, because a
 *  handle that cannot be named in the replacement cannot be re-fetched,
 *  and nothing un-re-fetchable may ever be compacted. */
export function compactionLine(datasetId: string): string | null {
  const short = `[compacted] ${datasetId} — re-fetch: open_dataset(datasetId: "${datasetId}")`;
  if (short.length <= COMPACTION_MAX_LINE) return short;
  return null;
}

/**
 * Replace every federation tool_result for `datasetId` in the conversation.
 * The tool_use_ids are preserved; only content blocks change. Returns the
 * messages array (mutated in place — the caller owns ctx.messages) and
 * how many blocks were compacted.
 */
export function compactFederationResults(
  messages: ConversationMessage[],
  datasetId: string,
  alreadyCompacted: Set<string>,
): { compacted: number } {
  if (alreadyCompacted.has(datasetId)) return { compacted: 0 };
  const line = compactionLine(datasetId);
  if (line === null) return { compacted: 0 }; // un-nameable handle: refuse
  alreadyCompacted.add(datasetId);
  let compacted = 0;

  // The dataset handle lives in the assistant tool_use INPUT; pair each
  // federation call for this dataset with its tool_result by id. Matching
  // on the RESULT text would miss results that merely quote the card.
  const useIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      const input = (block as { input?: Record<string, unknown> }).input ?? {};
      const named = [input.datasetId, input.sourceId].map((v) => String(v ?? ""));
      if (named.includes(datasetId)) useIds.add((block as { id: string }).id);
    }
  }
  if (useIds.size === 0) return { compacted: 0 };

  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const b = block as { tool_use_id?: string; content: string };
      if (b.tool_use_id !== undefined && useIds.has(b.tool_use_id) && !b.content.startsWith("[compacted]")) {
        b.content = line;
        compacted++;
      }
    }
  }
  return { compacted };
}

/** Should compaction run now? Pure: the discard just fired, chars spent. */
export function compactionDue(
  discardedThisCall: boolean,
  charsSpent: number,
  totalBudget: number,
  alreadyCompactedForDataset: boolean,
): boolean {
  return (
    discardedThisCall &&
    !alreadyCompactedForDataset &&
    charsSpent > COMPACTION_TRIGGER_FRACTION * totalBudget
  );
}
