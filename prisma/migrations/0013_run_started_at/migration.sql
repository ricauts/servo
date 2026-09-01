-- xds-05: the run stamp on crawled documents. Nullable ADD COLUMN (additive).
ALTER TABLE "Document"
  ADD COLUMN "runStartedAt" TIMESTAMP(3);
