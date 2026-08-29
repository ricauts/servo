-- db-03: ticket numbers move from max(number)+1 to a Postgres sequence.
-- max+1 races under concurrency: two creates read the same max and one dies
-- on the unique constraint. A sequence hands out distinct numbers by
-- construction; the allocator is src/lib/tickets.ts#nextTicketNumber.
CREATE SEQUENCE ticket_number_seq START 1001;

-- Upgrades: an existing database already holds explicit numbers (a demo
-- install seeds #1001.. by hand), so push the sequence past every live
-- number — COALESCE 1000 keeps a fresh install at the START 1001 default,
-- making the first nextval on either shape strictly greater than any row.
SELECT setval('ticket_number_seq', (SELECT COALESCE(MAX("number"), 1000) FROM "Ticket"));
