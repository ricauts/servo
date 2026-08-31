-- 0011_document_fact — the DocumentFact table (spec ext-01).
--
-- BORN COVERED, not retrofitted: a fact row is a FRAGMENT OF DOCUMENT
-- CONTENT — the extracted dates, money and identifiers of a passage — so
-- the RLS backstop must cover it from the first CREATE TABLE. A content
-- table the backstop does not cover is a hole in the backstop: a
-- forgotten WHERE on a facts query would leak exactly the payload the
-- document policy exists to protect.
--
-- The policy resolves entitlement through the parent Document, matching
-- kb-15's chunk policy in shape (kb_chunk_floor): a fact is visible when
-- its document is visible. FORCE ROW LEVEL SECURITY ships in the same
-- statement pair — without it, the owning role bypasses the policy and
-- these lines are decorative. No ALTER TABLE touches "Document" or
-- "DocumentChunk"; the back-relations are Prisma-level only.

CREATE TABLE "DocumentFact" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "norm" TEXT NOT NULL,
    "num" DECIMAL(38,6),
    "unit" TEXT NOT NULL,
    "ts" BIGINT,
    "tsEnd" BIGINT,
    "text" TEXT NOT NULL,
    "offset" INTEGER NOT NULL,
    "length" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'EXACT',
    "extractor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFact_pkey" PRIMARY KEY ("id")
);

-- One fact per (chunk, offset, kind): two extractors may not disagree at
-- the same position, and a re-extract replaces rather than duplicates.
CREATE UNIQUE INDEX "DocumentFact_chunkId_offset_kind_key"
    ON "DocumentFact"("chunkId", "offset", "kind");

-- The four query shapes the retrieval statement (ext-06) will drive:
-- facts of one document, facts of one kind by norm, by num, by ts.
CREATE INDEX "DocumentFact_documentId_kind_idx"
    ON "DocumentFact"("documentId", "kind");
CREATE INDEX "DocumentFact_kind_norm_idx"
    ON "DocumentFact"("kind", "norm");
CREATE INDEX "DocumentFact_kind_num_idx"
    ON "DocumentFact"("kind", "num");
CREATE INDEX "DocumentFact_kind_ts_idx"
    ON "DocumentFact"("kind", "ts");

-- Foreign keys with the same cascade semantics as DocumentChunk: deleting
-- a chunk cascades its facts; deleting a document cascades both.
ALTER TABLE "DocumentFact"
    ADD CONSTRAINT "DocumentFact_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentFact"
    ADD CONSTRAINT "DocumentFact_chunkId_fkey"
    FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The RLS backstop, born with the table (see the header).
ALTER TABLE "DocumentFact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentFact" FORCE ROW LEVEL SECURITY;

CREATE POLICY kb_fact_floor ON "DocumentFact"
    USING (EXISTS (
        SELECT 1 FROM "Document" d WHERE d.id = "DocumentFact"."documentId"
    ));
