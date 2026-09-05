"use client";

// The inline .md editor Skills and Agents share: one mono textarea over the
// whole document (frontmatter included — the file is the source of truth),
// an optional help line, the error line and a Cancel / Save row. The parent
// owns the request: `onSave` resolves to null on success (the parent then
// closes the editor) or to the message to show.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** The document without its YAML frontmatter — for the read-only render. */
export function stripFrontmatter(markdown: string): string {
  // A leading byte-order mark (U+FEFF) would hide the opening fence.
  const text = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").trim();
}

export default function MarkdownEditor({
  initial,
  saveLabel,
  help,
  autoFocus = false,
  onCancel,
  onSave,
}: {
  initial: string;
  saveLabel: string;
  help?: string;
  autoFocus?: boolean;
  onCancel: () => void;
  onSave: (markdown: string) => Promise<string | null>;
}) {
  const [markdown, setMarkdown] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const err = await onSave(markdown);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className="flex flex-col gap-3">
      {help && <p className="text-[12.5px] text-muted-foreground">{help}</p>}
      <Textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        rows={18}
        spellCheck={false}
        autoFocus={autoFocus}
        className="font-mono text-[12.5px] leading-relaxed"
      />
      {error && <p className="text-[13px] text-critical">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={busy || !markdown.trim()}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
