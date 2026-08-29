-- reb-05: provenance for distilled skills. Nullable bare FK — a skill
-- handwritten or loaded from skills/ has no source; one distilled from a
-- resolved ticket points at it, and the KPIs (reb-06) count this column.
ALTER TABLE "Skill" ADD COLUMN "sourceTicketId" TEXT;
