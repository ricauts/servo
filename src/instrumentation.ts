// Next's server-boot hook (dcl-01). The one boot-time job today: drain
// stranded EXTRACTING rows — a container that dies mid-extraction leaves
// them, and a restart is a longer window than kb-05 assumed. The reclaim
// resolves its own budget (kb.extract.workerBudgetMs) and NEVER blocks
// boot: a database that is not ready is a normal startup state, and the
// next boot drains the queue.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { db } = await import("@/lib/db");
    const { reclaimStuckExtractions } = await import("@/lib/kb/extract");
    const reclaimed = await reclaimStuckExtractions(db);
    if (reclaimed > 0) {
      console.log(`[servo] boot reclaim: ${reclaimed} extraction(s) marked FAILED (exceeded the worker budget)`);
    }
  } catch {
    // Boot never blocks on the reclaim — the rows are drained next boot.
  }
}
