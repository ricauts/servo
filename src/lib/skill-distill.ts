// Deterministic ticket→skill distillation prefill (spec reb-05). NO model
// call anywhere: name from the ticket title, categories [ticket.category],
// body scaffold from the recorded resolution. This is deliberately the only
// variant whose happy path is testable offline — same input, same markdown,
// and the mock provider is never consulted.
//
// The created skill lands DISABLED (enforced server-side in POST
// /api/skills when a sourceTicketId rides the request): nothing
// auto-enables; a human reads the scaffold and flips the switch.

import type { Ticket, AgentRun } from "@prisma/client";

export interface DistillSource {
  number: number;
  title: string;
  category: string;
  /** The resolver's recorded summary, when the run left one. */
  runSummary: string | null;
}

/** Pure: ticket + run → the SKILL.md markdown the editor opens with. */
export function distillPrefill(ticket: DistillSource): string {
  const name = ticket.title.trim().slice(0, 60) || `Runbook for ticket #${ticket.number}`;
  const description = `How the desk resolved ticket #${ticket.number}: ${ticket.title.trim()}`;
  const whatWorked = ticket.runSummary?.trim()
    ? ticket.runSummary.trim()
    : "Describe what actually resolved this ticket — the steps, the tool, the command.";
  return [
    "---",
    `name: ${name}`,
    `description: ${description.replace(/\n+/g, " ").slice(0, 140)}`,
    `categories: ["${ticket.category}"]`,
    "enabled: false",
    "---",
    "",
    `Distilled from ticket #${ticket.number}.`,
    "",
    "## What worked",
    "",
    whatWorked,
    "",
    "## Procedure",
    "",
    "1. ",
    "",
    "## Never",
    "",
    "- ",
    "",
  ].join("\n");
}

/** The resolution of record for a ticket: the latest COMPLETED resolver
 *  run's summary — the machine's own account of what it did — or null when
 *  a human closed the ticket without a run. */
export function resolutionOfRecord(runs: Pick<AgentRun, "kind" | "status" | "summary">[]): string | null {
  const completed = runs.filter((r) => r.kind === "RESOLVE" && r.status === "COMPLETED" && r.summary);
  return completed.length > 0 ? completed[completed.length - 1].summary ?? null : null;
}

export type { Ticket };
