-- ux-03: ticket channel provenance. WEB is the default and the historical
-- truth for every pre-existing row — a documented inaccuracy only for
-- tickets that actually arrived by email before the column existed.
ALTER TABLE "Ticket" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'WEB';
