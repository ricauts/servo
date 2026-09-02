"use client";

import { useState } from "react";
import { AlertTriangle, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Spinner from "@/components/common/Spinner";

export interface GithubSettingsView {
  owner: string;
  tokenSet: boolean;
  tokenSource: "env" | "db" | "none";
}

export default function GithubForm({ initial }: { initial: GithubSettingsView }) {
  const [token, setToken] = useState("");
  const [owner, setOwner] = useState(initial.owner);
  const [tokenSet, setTokenSet] = useState(initial.tokenSet);
  const [tokenSource, setTokenSource] = useState(initial.tokenSource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function save(extra?: { githubToken: string }) {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { githubOwner: owner.trim() };
    if (extra) body.githubToken = extra.githubToken;
    else if (token.trim() !== "") body.githubToken = token.trim();
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        githubTokenSet?: boolean;
        githubTokenSource?: "env" | "db" | "none";
      };
      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      if (typeof data.githubTokenSet === "boolean") setTokenSet(data.githubTokenSet);
      if (data.githubTokenSource) setTokenSource(data.githubTokenSource);
      setToken("");
      toast("GitHub settings saved");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(token.trim() !== "" ? { token: token.trim() } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        login?: string;
        latencyMs?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Test failed (${res.status}).`);
        return;
      }
      setTestResult(`Authenticated as ${data.login} in ${data.latencyMs} ms.`);
      toast("GitHub token OK");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(false);
    }
  }

  const tokenDescription =
    tokenSource === "env"
      ? "A token is set via the GITHUB_TOKEN environment variable — it takes precedence over any token saved here."
      : tokenSource === "db"
        ? "A token is stored in Settings (never displayed)."
        : "No token configured — the GitHub tools run in simulated mode.";

  return (
    <div className="flex flex-col gap-4 font-sans">
      <p className="text-xs text-muted-foreground">
        With a token, <code className="font-mono">github_create_repo</code> and{" "}
        <code className="font-mono">github_open_pr</code> hit the real GitHub
        API (behind their usual risk levels and approval gates). Without one
        they stay simulated so the offline demo keeps working.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-token" className="font-heading">
            Personal access token
          </Label>
          <Input
            id="gh-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tokenSet ? "•••••••• (token configured)" : "ghp_… / github_pat_…"}
            disabled={busy}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">{tokenDescription}</p>
          {tokenSource === "db" && (
            <button
              type="button"
              onClick={() => void save({ githubToken: "" })}
              disabled={busy}
              className="self-start text-xs font-medium text-primary-strong hover:underline disabled:pointer-events-none disabled:opacity-50"
            >
              Clear stored token
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-owner" className="font-heading">
            Default owner{" "}
            <span className="font-normal text-muted-foreground">(user or org)</span>
          </Label>
          <Input
            id="gh-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="acme-inc"
            disabled={busy}
          />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
      {testResult && <p className="text-sm text-primary-strong">{testResult}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="font-heading"
        >
          {busy && <Spinner size={14} className="text-primary-foreground" />}
          Save GitHub settings
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void testConnection()}
          disabled={busy}
          className="font-heading"
        >
          <GitBranch size={15} />
          Test token
        </Button>
      </div>
    </div>
  );
}
