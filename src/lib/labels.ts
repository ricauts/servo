// Central label + tone maps so every surface renders statuses identically.
// Tones map to the Badge component's `tone` prop.

import type {
  ApprovalStatus,
  Category,
  MemberTier,
  Priority,
  RiskLevel,
  RunStatus,
  TicketStatus,
} from "@/lib/types";

// The ds status vocabulary: good / warn / serious / critical / info / neutral
// (+ brand). `violet` is the legacy name of `info` and renders identically.
export type BadgeTone =
  | "neutral"
  | "brand"
  | "good"
  | "warn"
  | "serious"
  | "critical"
  | "info"
  | "violet";

export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "Open",
  TRIAGED: "Triaged",
  IN_PROGRESS: "In progress",
  WAITING_APPROVAL: "Waiting approval",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  OPEN: "serious",
  TRIAGED: "brand",
  IN_PROGRESS: "info",
  WAITING_APPROVAL: "warn",
  RESOLVED: "good",
  CLOSED: "neutral",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  LOW: "neutral",
  MEDIUM: "brand",
  HIGH: "serious",
  URGENT: "critical",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  ACCESS: "Access & identity",
  HARDWARE: "Hardware",
  SOFTWARE: "Software",
  DATABASE: "Database",
  DEVOPS: "DevOps & cloud",
  NETWORK: "Network",
  OTHER: "Other",
};

export const SENIORITY_LABEL: Record<MemberTier, string> = {
  JUNIOR: "Junior",
  MID: "Mid",
  SENIOR: "Senior",
  STANDALONE: "Standalone",
};

export const SENIORITY_TONE: Record<MemberTier, BadgeTone> = {
  JUNIOR: "neutral",
  MID: "info",
  SENIOR: "serious",
  STANDALONE: "brand",
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: "Low risk",
  MEDIUM: "Medium risk",
  HIGH: "High risk",
};

export const RISK_TONE: Record<RiskLevel, BadgeTone> = {
  LOW: "good",
  MEDIUM: "warn",
  HIGH: "critical",
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  RUNNING: "Running",
  WAITING_APPROVAL: "Waiting approval",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export const RUN_STATUS_TONE: Record<RunStatus, BadgeTone> = {
  RUNNING: "info",
  WAITING_APPROVAL: "warn",
  COMPLETED: "good",
  FAILED: "critical",
};

export const APPROVAL_STATUS_TONE: Record<ApprovalStatus, BadgeTone> = {
  PENDING: "warn",
  APPROVED: "good",
  REJECTED: "critical",
};

/** A 0..1 share as a percentage string; null is "n/a" — the not-applicable
 *  case (no runs, no enabled skills) is a WORD, never NaN (reb-06). */
export function shareAsPct(share: number | null): string {
  return share === null ? "n/a" : `${Math.round(share * 100)}%`;
}
