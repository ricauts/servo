-- kb-lib-2: opt-in model enrichment of documents. Additive: every column
-- carries a default or is nullable, so a pre-existing row reads as
-- "not enriched" (enrichedAt IS NULL) rather than failing a NOT NULL.
ALTER TABLE "Document"
  ADD COLUMN "topics" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "aiSummary" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "enrichModel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "enrichedAt" TIMESTAMP(3);
