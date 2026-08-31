-- 0003_kb — the knowledge base (spec item kb-01).
--
-- THREE TRAPS, recorded here because each one bites silently:
--
-- 1. to_tsvector is IMMUTABLE only in its TWO-ARGUMENT form, which is why
--    the config is written literally. 'simple' over 'english': the desk is
--    multilingual and English stemming on a Spanish workbook is worse than
--    no stemming. CHANGING THE CONFIG IS A MIGRATION PLUS A FULL RE-INDEX,
--    never a setting.
-- 2. prisma migrate diff --from-empty does NOT regenerate CHECKs, partial
--    indexes, generated columns or Unsupported index types. This file is
--    hand-maintained from here on: KB migrations are numbered after 0002 and
--    are NEVER folded into a regenerated baseline — db-01's "regenerate,
--    don't port" licence expired here.
-- 3. The vector column is NULLABLE on purpose: keyword-only installs are a
--    normal state, not a failure, and `prisma db push` accepts an
--    Unsupported type only when it allows NULL.

-- AlterTable
ALTER TABLE "ReplyDraft" ADD COLUMN     "autoDelivered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sources" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "textStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "textError" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "ownerId" TEXT NOT NULL,
    "collectionId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "locator" JSONB NOT NULL,
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "embedding" vector(1536),
    "embeddingModel" TEXT NOT NULL DEFAULT '',
    "embeddingDims" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEdge" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbGrant" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "collectionId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'READ',
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentId_index_key" ON "DocumentChunk"("documentId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_name_key" ON "Collection"("name");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEdge_fromId_toId_kind_key" ON "KnowledgeEdge"("fromId", "toId", "kind");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEdge" ADD CONSTRAINT "KnowledgeEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEdge" ADD CONSTRAINT "KnowledgeEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbGrant" ADD CONSTRAINT "KbGrant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbGrant" ADD CONSTRAINT "KbGrant_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbGrant" ADD CONSTRAINT "KbGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Everything below is what schema.prisma cannot say (trap 2).
-- ---------------------------------------------------------------------------

-- KbGrant: exactly one target per row, and one grant per (target, subject).
-- NULLs are distinct under both UNIQUE and the Prisma @@unique, so the
-- real constraints are partial indexes plus a CHECK.
CREATE UNIQUE INDEX "KbGrant_doc_subject_key" ON "KbGrant"("documentId", "subjectType", "subjectId") WHERE "documentId" IS NOT NULL;
CREATE UNIQUE INDEX "KbGrant_coll_subject_key" ON "KbGrant"("collectionId", "subjectType", "subjectId") WHERE "collectionId" IS NOT NULL;
ALTER TABLE "KbGrant" ADD CONSTRAINT "KbGrant_one_target" CHECK (num_nonnulls("documentId", "collectionId") = 1);

-- Full-text candidates: a STORED generated column + GIN. There is no
-- LIKE-fallback mode anywhere — keyword selection is index-backed at every
-- install (trap 1 for the config choice).
ALTER TABLE "DocumentChunk"
  ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "text")) STORED;
CREATE INDEX "DocumentChunk_tsv_idx" ON "DocumentChunk" USING gin ("tsv");
CREATE INDEX "DocumentChunk_keywords_idx" ON "DocumentChunk" USING gin ("keywords" jsonb_path_ops);
CREATE INDEX "DocumentChunk_embedding_hnsw_idx" ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
