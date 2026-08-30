-- dcl-01: extractor provenance on Document. Nullable-or-defaulted ADD COLUMN only
-- — additive by construction, so scripts/migration-guard.mjs classifies it additive.
ALTER TABLE "Document"
  ADD COLUMN "extractor" TEXT NOT NULL DEFAULT 'baseline',
  ADD COLUMN "extractorVersion" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "extractorFallback" TEXT,
  ADD COLUMN "extractedAt" TIMESTAMP(3);
