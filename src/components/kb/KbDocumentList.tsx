import Link from "next/link";
import { FileText } from "lucide-react";

export interface KbDocumentRow {
  id: string;
  name: string;
  contentType: string;
  byteSize: number;
  textStatus: string;
  textError: string | null;
  summary: string;
  visibility: string;
  updatedAt: Date;
}

/** The three ingest states, distinguishable and actionable (kb-16). */
export function statusCopy(doc: Pick<KbDocumentRow, "textStatus" | "textError">): { label: string; tone: string; hint?: string } {
  switch (doc.textStatus) {
    case "EXTRACTED":
      return { label: "Indexed", tone: "var(--good-chip-ink)" };
    case "EXTRACTING":
    case "PENDING":
      return { label: "Processing…", tone: "var(--text-muted)" };
    case "FAILED":
      return {
        label: "Failed",
        tone: "var(--critical-chip-ink)",
        hint: doc.textError ?? "Extraction failed — re-upload the file to retry.",
      };
    case "UNSUPPORTED":
      return {
        label: "Stored, not searchable",
        tone: "var(--warn-chip-ink)",
        hint: doc.textError ?? "No extractor for this format yet — the file is stored and shareable.",
      };
    default:
      return { label: doc.textStatus, tone: "var(--text-muted)" };
  }
}

function kb(size: number): string {
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export default function KbDocumentList({
  documents,
  anyAgentGrant,
}: {
  documents: KbDocumentRow[];
  /** Drives the deliberate "dark to automation" empty state (spec kb-16). */
  anyAgentGrant: boolean;
}) {
  return (
    <div className="mt-6 flex flex-col gap-2">
      {!anyAgentGrant && documents.length > 0 && (
        <p
          className="rounded-md border px-3 py-2 font-mono text-[11.5px]"
          style={{
            borderColor: "var(--warn-chip-line)",
            background: "var(--warn-chip)",
            color: "var(--warn-chip-ink)",
          }}
        >
          No agent can read anything here yet — a fresh knowledge base is dark
          to automation by design. Share a document with an agent to light it up.
        </p>
      )}
      {documents.map((doc) => {
        const status = statusCopy(doc);
        return (
          <Link
            key={doc.id}
            href={`/kb/${doc.id}`}
            className="group rounded-md border border-border bg-card p-3.5 transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center gap-2.5">
              <FileText size={15} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-heading text-[14px] font-medium">
                {doc.name}
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                {doc.visibility} · {kb(doc.byteSize)}
              </span>
              <span
                className="rounded-full border px-1.5 py-px font-mono text-[10.5px] leading-4"
                style={{ color: status.tone, borderColor: "var(--line)" }}
              >
                {status.label}
              </span>
            </div>
            {status.hint ? (
              <p className="mt-1 pl-6 text-xs text-muted-foreground">{status.hint}</p>
            ) : (
              doc.summary && (
                <p className="mt-1 line-clamp-1 pl-6 text-xs text-muted-foreground">{doc.summary}</p>
              )
            )}
          </Link>
        );
      })}
    </div>
  );
}
