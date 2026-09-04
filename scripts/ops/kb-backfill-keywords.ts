/* eslint-disable no-console */
// One-shot backfill for kb-lib-1: compute Document.keywords (the
// document-level keyword profile) for every indexed document that has none.
//
//   npx tsx scripts/ops/kb-backfill-keywords.ts
//
// Idempotent — documents that already carry a profile are skipped unless
// --force is given, which recomputes every indexed document (do that after
// changing the stopword list or the tokenizer). Chunk keywords are recomputed
// alongside so the graph pass and the profile agree on the same rules; edges
// are rebuilt for every touched document. No model call, nothing leaves the
// process: this is the same deterministic pass ingest runs.

import { db } from "../../src/lib/db";
import { documentProfile, keywordPass } from "../../src/lib/kb/keywords";
import { rebuildEdgesFor } from "../../src/lib/kb/graph";

async function main() {
  const force = process.argv.includes("--force");
  const docs = await db.document.findMany({
    where: { textStatus: "EXTRACTED" },
    select: { id: true, name: true, keywords: true },
    orderBy: { createdAt: "asc" },
  });
  let touched = 0;
  for (const doc of docs) {
    const has = Array.isArray(doc.keywords) && doc.keywords.length > 0;
    if (has && !force) continue;
    const chunks = await db.documentChunk.findMany({
      where: { documentId: doc.id },
      select: { id: true, text: true },
      orderBy: { index: "asc" },
    });
    const profile = documentProfile(chunks.map((c) => c.text));
    await db.$transaction(async (tx) => {
      for (const c of chunks) {
        await tx.documentChunk.update({
          where: { id: c.id },
          data: { keywords: keywordPass(c.text).keywords },
        });
      }
      await tx.document.update({ where: { id: doc.id }, data: { keywords: profile.keywords } });
    });
    const edges = await rebuildEdgesFor(doc.id);
    touched++;
    console.log(`${doc.name}: ${profile.keywords.join(", ")} (${chunks.length} chunks, ${edges} edges)`);
  }
  console.log(`Done. ${touched} of ${docs.length} indexed document(s) updated${force ? " (forced)" : ""}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
