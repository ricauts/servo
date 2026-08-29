// Backfill embeddings over null-embedding chunks (spec kb-09). Commits in
// BATCHES, not one transaction — HNSW index build memory is the constraint
// (maintenance_work_mem), and a long single transaction would also pin every
// batch's WAL. Mixed states are normal: a chunk whose embeddingModel differs
// from the current setting is left alone (kb-10 excludes it from vector
// scoring) so two embedding spaces are never silently blended.

import type { PrismaClient } from "@prisma/client";
import { getEmbedSettings, embedWithEndpoint } from "@/lib/kb/embed";
import { MOCK_EMBEDDER_MODEL, mockEmbed } from "@/lib/kb/mock-embedder";

const BATCH = 100;

export interface BackfillReport {
  embedded: number;
  skippedModelMismatch: number;
  batches: number;
}

/** Structural: raw and $extends clients both compose. */
interface WriteClient {
  $queryRawUnsafe<T>(q: string): Promise<T>;
  $executeRawUnsafe(q: string): Promise<number>;
  documentChunk: {
    findMany: PrismaClient["documentChunk"]["findMany"];
  };
}

export async function backfillEmbeddings(
  db: WriteClient,
  expectModel: string,
): Promise<BackfillReport> {
  const settings = await getEmbedSettings();
  if (settings.kind === "none") return { embedded: 0, skippedModelMismatch: 0, batches: 0 };

  const report = { embedded: 0, skippedModelMismatch: 0, batches: 0 };
  for (;;) {
    const chunks = await db.documentChunk.findMany({
      where: { embeddingModel: "" },
      select: { id: true, text: true },
      take: BATCH,
      orderBy: { id: "asc" },
    });
    if (chunks.length === 0) break;

    const vectors =
      settings.kind === "mock"
        ? chunks.map((c) => ({
            vector: mockEmbed(c.text),
            dims: 256,
            model: MOCK_EMBEDDER_MODEL,
          }))
        : await embedWithEndpoint(
            settings,
            chunks.map((c) => c.text),
          );

    for (let i = 0; i < chunks.length; i++) {
      const v = vectors[i];
      if (v.model !== expectModel) {
        report.skippedModelMismatch++;
        continue;
      }
      const literal = `[${v.vector.join(",")}]`;
      await db.$executeRawUnsafe(
        `UPDATE "DocumentChunk" SET embedding = '${literal}'::vector, "embeddingModel" = '${v.model}', "embeddingDims" = ${v.dims} WHERE id = '${chunks[i].id}'`,
      );
      report.embedded++;
    }
    report.batches++;
    if (chunks.length < BATCH) break;
  }
  return report;
}
