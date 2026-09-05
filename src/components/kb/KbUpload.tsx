"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { BTN_PRIMARY } from "@/components/kb/kb-controls";

/** The upload control (kb-16). The 25 MB cap is enforced server-side before
 *  anything touches the database; the client offers the same courtesy. */
export default function KbUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/kb/documents", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Upload failed.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {/* The page's one primary action: a flat brand fill, no glow — shadows
          belong to floating surfaces only. */}
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={BTN_PRIMARY}
      >
        <Upload size={14} />
        {busy ? "Uploading…" : "Upload document"}
      </button>
      {error && <span className="font-mono text-[11px] text-(--critical-chip-ink)">{error}</span>}
    </span>
  );
}
