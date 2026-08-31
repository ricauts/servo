// Avatar colours are DATA, not theme: each User row carries its own colour
// (prisma/schema.prisma `color`), and these are the seed/fallback values.
// They deliberately live outside src/app and src/components so the
// no-hardcoded-hex lint (ds-01) can treat every hex in those trees as a
// styling violation — a colour here is a stored value, never a style.

/** Fallback when a user row has no colour set (mirrors the schema default). */
export const AVATAR_FALLBACK_COLOR = "#165A56";

/** Colour for a ticket with no assignee (a neutral marker, not a person). */
export const UNASSIGNED_COLOR = "#888888";

/** First-admin and system AI agent colours written by first-run setup. */
export const SETUP_ADMIN_COLOR = "#4A3AA7";
export const AI_AGENT_COLORS = {
  TRIAGE: "#0A6E66",
  RESOLVER: "#14625D",
  QA: "#52514E",
} as const;
