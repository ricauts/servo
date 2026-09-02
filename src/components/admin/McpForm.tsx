"use client";

// MCP server card: one bearer token guards POST /api/mcp, which serves
// Servo's tool registry to any Model Context Protocol client.

import { useState } from "react";
import { AlertTriangle, Plug2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Spinner from "@/components/common/Spinner";

export interface McpSettingsView {
  tokenSet: boolean;
  tokenSource: "env" | "db" | "none";
}

export default function McpForm({ initial }: { initial: McpSettingsView }) {
  const [token, setToken] = useState("");
  const [tokenSet, setTokenSet] = useState(initial.tokenSet);
  const [tokenSource, setTokenSource] = useState(initial.tokenSource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(extra?: { mcpToken: string }) {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {};
    if (extra) body.mcpToken = extra.mcpToken;
    else if (token.trim() !== "") body.mcpToken = token.trim();
    else {
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mcpTokenSet?: boolean;
        mcpTokenSource?: "env" | "db" | "none";
      };
      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      if (typeof data.mcpTokenSet === "boolean") setTokenSet(data.mcpTokenSet);
      if (data.mcpTokenSource) setTokenSource(data.mcpTokenSource);
      setToken("");
      toast("MCP settings saved");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(false);
    }
  }

  const tokenDescription =
    tokenSource === "env"
      ? "A token is set via MCP_TOKEN — it takes precedence over any token saved here."
      : tokenSource === "db"
        ? "A token is stored in Settings (never displayed)."
        : "No token configured — the MCP endpoint refuses every request until one is set.";

  return (
    <div className="flex flex-col gap-4 font-sans">
      <p className="text-xs text-muted-foreground">
        Servo speaks the Model Context Protocol: any MCP client (Claude Code,
        Claude Desktop, other agents) can file and search tickets and operate
        Servo&rsquo;s tools. Point the client at{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          POST {"<your-servo-url>"}/api/mcp
        </code>{" "}
        with the token as a Bearer authorization header. Ticket-bound core
        tools and policy-disabled tools are never served.
      </p>

      <div className="flex max-w-md flex-col gap-1.5">
        <Label htmlFor="mcp-token" className="font-heading">
          Access token
        </Label>
        <Input
          id="mcp-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={tokenSet ? "•••••••• (token configured)" : "a long random string"}
          disabled={busy}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{tokenDescription}</p>
        {tokenSource === "db" && (
          <button
            type="button"
            onClick={() => void save({ mcpToken: "" })}
            disabled={busy}
            className="self-start text-xs font-medium text-primary-strong hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            Disable MCP (clear token)
          </button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      <Button
        type="button"
        onClick={() => void save()}
        disabled={busy || token.trim() === ""}
        className="self-start font-heading"
      >
        {busy ? <Spinner size={14} className="text-primary-foreground" /> : <Plug2 size={15} />}
        Save MCP token
      </Button>
    </div>
  );
}
