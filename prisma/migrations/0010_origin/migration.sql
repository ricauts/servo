-- cnp-06: plugin provenance. Nullable-or-defaulted ADD COLUMN only (additive).
-- Exactly two columns, both here; there is no third provenance column.
ALTER TABLE "Skill"
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "AgentProfile"
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'local';
