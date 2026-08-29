// db-03: ticket numbers come from the Postgres sequence ticket_number_seq.
// 20 CONCURRENT creates must produce 20 distinct consecutive numbers with
// zero unique-constraint errors — max+1 cannot, and to prove this test
// detects that failure mode (rather than asserting it by comment), the OLD
// implementation is kept here as a fixture and run under the same
// concurrency: it is EXPECTED to break.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));

import { nextTicketNumber } from "@/lib/tickets";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let requester: { id: string };

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
});

/** The OLD allocator, verbatim (src/lib/tickets.ts before db-03): a fixture
 *  of the implementation this item replaces, so the test can demonstrate
 *  mechanically that it fails under exactly this concurrency. */
async function oldMaxPlusOne(): Promise<number> {
  const agg = await db.ticket.aggregate({ _max: { number: true } });
  return (agg._max.number ?? 1000) + 1;
}

const CONCURRENT = 20;

async function concurrentCreates(allocate: () => Promise<number>) {
  const outcomes = await Promise.allSettled(
    Array.from({ length: CONCURRENT }, () =>
      (async () => {
        const number = await allocate();
        return db.ticket.create({
          data: { number, title: "concurrent", description: "race probe", requesterId: requester.id },
        });
      })(),
    ),
  );
  const errors = outcomes.filter((o) => o.status === "rejected") as PromiseRejectedResult[];
  const numbers = (outcomes.filter((o) => o.status === "fulfilled") as PromiseFulfilledResult<{ number: number }>[])
    .map((o) => o.value.number);
  return { errors, numbers };
}

describe("nextTicketNumber — the sequence (db-03)", () => {
  it("20 concurrent creates get 20 distinct consecutive numbers, zero errors", async () => {
    const { errors, numbers } = await concurrentCreates(nextTicketNumber);
    expect(errors).toHaveLength(0);
    expect(numbers).toHaveLength(CONCURRENT);
    const sorted = [...numbers].sort((a, b) => a - b);
    // Distinct and consecutive: 1001..1020 on a fresh database.
    expect(new Set(sorted).size).toBe(CONCURRENT);
    expect(sorted[0]).toBe(1001);
    expect(sorted[sorted.length - 1]).toBe(1000 + CONCURRENT);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBe(1);
  });

  it("the OLD max+1 fixture under the SAME concurrency fails — this test detects the race", async () => {
    const { errors, numbers } = await concurrentCreates(oldMaxPlusOne);
    // Either the unique constraint rejects duplicates (errors), or — on a
    // database without it — duplicates would appear; Ticket.number is
    // @unique, so errors are the expected failure shape, and the survivors
    // can never be 20 distinct numbers.
    const duplicates = CONCURRENT - new Set(numbers).size - errors.length;
    expect(errors.length + duplicates).toBeGreaterThan(0);
    expect(new Set(numbers).size).toBeLessThan(CONCURRENT);
  });
});
