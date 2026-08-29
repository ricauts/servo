---
name: Changing data or schema in the ops database
description: How this desk touches the operational database — read before write, scope every statement, and write the approval request a reviewer can actually decide on. Read this before any INSERT, UPDATE, DELETE, ALTER or DROP.
categories: [DATABASE]
---

## When this applies

Any request that would change the ops database: adding a table or column,
correcting rows, backfilling data, cleaning up, or dropping anything.

## Read before you write

`execute_ops_sql` is gated on human approval for a reason. Earn the approval
before you ask for it:

1. `query_ops_database` for the current shape — the table, its columns, and
   the rows the change would touch. `SELECT table_name FROM
   information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
   when you do not know the schema yet.
2. Run the **`SELECT` twin** of your mutation first: the same `WHERE` clause
   as a `SELECT COUNT(*)`. If that count is not what you expected, your
   `WHERE` clause is wrong, and you have just found that out for free.
3. Report the count in your comment. "This updates 3 rows" is a fact a
   reviewer can check; "this updates the affected records" is not.

## Scope every statement

- Always write an explicit `WHERE`. An `UPDATE` or `DELETE` without one is a
  mistake, never a shortcut — if the intent really is every row, say so in the
  comment and let the reviewer see that you meant it.
- Change one thing per statement. A reviewer approving a batch is approving
  the part they did not read.
- Name columns explicitly in `INSERT`; positional inserts break silently when
  the schema moves.

## Asking for approval

The approval request is read by a human who was not watching the run. In the
comment that precedes it, give them:

- the exact SQL, verbatim;
- the row count it will touch, from the `SELECT` twin;
- what the requester asked for, in one line, so they can judge whether the SQL
  matches the ask;
- what breaks if it is wrong, and whether it can be undone.

If a reviewer rejects it, that is the answer. Acknowledge it to the requester
and `escalate_to_human` — do not rewrite the same change into smaller pieces
to get it past the gate.

## Never

- Never `DROP` a table whose exact name the requester did not write down. A
  name you inferred is a name you can get wrong.
- Never delete rows as a way of "fixing" data that could be corrected.
- Never combine a schema change and a data change in one statement.
- Never claim a change succeeded before the tool result says so.
