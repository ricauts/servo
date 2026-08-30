"use client";

// Connected MCP servers (cnp-02). Every colour here resolves to a design-system
// token through the Tailwind theme (servo_design_system/tokens/*.css) — there
// is no hex literal in this file, and scripts/no-hex-lint.mjs enforces that.
//
// The copy states the mechanism next to the control, per the design system's
// content rules: a synced tool is disabled, HIGH-risk and approval-gated until
// a human says otherwise, and the panel says so rather than implying a
// connection is ready to run.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import Badge from "@/components/legacy/Badge";
import Spinner from "@/components/legacy/Spinner";

export interface McpServerToolView {
  name: string;
  policyName: string;
  description: string;
}

export interface McpServerView {
  id: string;
  slug: string;
  name: string;
  transport: string;
  url: string;
  enabled: boolean;
  secretSet: boolean;
  lastSyncAt: string | null;
  tools: McpServerToolView[];
}

async function api(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data };
    return { ok: false, error: (data.error as string) ?? `Request failed (${res.status}).` };
  } catch {
    return { ok: false, error: "Network error — nothing was changed." };
  }
}

export default function McpServersManager({ servers }: { servers: McpServerView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await api("/api/mcp-servers", "POST", {
      slug: slug.trim(),
      name: name.trim(),
      url: url.trim(),
      // The Authorization header is the v1 auth story: a static bearer token,
      // sealed at rest and substituted only when the client sends a request.
      headers: secret.trim() ? JSON.stringify({ Authorization: "Bearer {secret}" }) : "{}",
      secret: secret.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? null);
      return;
    }
    setCreating(false);
    setSlug("");
    setName("");
    setUrl("");
    setSecret("");
    router.refresh();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await api(`/api/mcp-servers/${id}`, "PATCH", body);
    setBusy(false);
    if (!res.ok) setError(res.error ?? null);
    else router.refresh();
  }

  async function sync(id: string) {
    setBusy(true);
    setError(null);
    const res = await api(`/api/mcp-servers/${id}?action=sync`, "POST");
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? null);
      return;
    }
    const result = res.data?.sync as
      | { seen: number; created: string[]; requarantined: string[] }
      | undefined;
    toast(
      `${result?.seen ?? 0} tools listed — ${result?.created.length ?? 0} new, quarantined; ` +
        `${result?.requarantined.length ?? 0} re-quarantined after a change`,
    );
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await api(`/api/mcp-servers/${id}`, "DELETE");
    setBusy(false);
    setConfirmDelete(null);
    if (!res.ok) setError(res.error ?? null);
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 font-sans">
      <p className="text-xs text-muted-foreground">
        Servo connects out to Model Context Protocol servers over Streamable
        HTTP and lists what they offer. Every listed tool arrives{" "}
        <strong>disabled, HIGH risk and approval-gated</strong>; an admin turns
        one on per tool in Settings → Tools. Requests go through the outbound
        allowlist, so a server on a private address must be named there exactly.
      </p>

      {servers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No MCP servers connected yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {servers.map((server) => (
            <li key={server.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-center gap-3">
                <Server size={15} className="text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">
                    {server.name}{" "}
                    <code className="font-mono text-[11px] text-muted-foreground">
                      mcp__{server.slug}__
                    </code>
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {server.url}
                  </span>
                </span>
                <Badge tone={server.secretSet ? "good" : "neutral"}>
                  {server.secretSet ? "token set" : "no token"}
                </Badge>
                <Switch
                  checked={server.enabled}
                  disabled={busy}
                  onCheckedChange={(v) => void patch(server.id, { enabled: v })}
                  aria-label="MCP server enabled"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void sync(server.id)}
                >
                  <RefreshCw size={13} />
                  Sync tools
                </Button>
                {confirmDelete === server.id ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => void remove(server.id)}
                  >
                    Confirm
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete MCP server"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDelete(server.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
              {server.tools.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-7">
                  {server.tools.map((tool) => (
                    <Badge key={tool.policyName} tone="neutral">
                      {tool.policyName}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="pl-7 font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">
                {server.lastSyncAt
                  ? `last sync ${new Date(server.lastSyncAt).toISOString().slice(0, 16).replace("T", " ")} · ${server.tools.length} tools`
                  : "never synced"}
              </p>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-[13px] text-critical">{error}</p>}

      <Button type="button" className="self-start" onClick={() => setCreating(true)}>
        <Plus size={15} />
        Connect a server
      </Button>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect an MCP server</DialogTitle>
            <DialogDescription>
              The connection is created switched off, and so is every tool its
              first sync finds.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-slug">Slug</Label>
              <Input
                id="mcp-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="acme-crm"
                disabled={busy}
                className="font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Tools become <code className="font-mono">mcp__{slug || "slug"}__&lt;tool&gt;</code>. It
                cannot be changed later.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-name">Name</Label>
              <Input
                id="mcp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme CRM"
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-url">Endpoint URL</Label>
              <Input
                id="mcp-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                disabled={busy}
                className="font-mono text-[13px]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-secret">Bearer token</Label>
              <Input
                id="mcp-secret"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Optional"
                disabled={busy}
                className="font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Encrypted at rest and never returned by the API. Sent as{" "}
                <code className="font-mono">Authorization: Bearer …</code>.
              </p>
            </div>
            {error && <p className="text-[13px] text-critical">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreating(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void create()}
                disabled={busy || !slug.trim() || !name.trim() || !url.trim()}
              >
                {busy ? (
                  <Spinner size={14} className="text-primary-foreground" />
                ) : (
                  <Server size={15} />
                )}
                Connect
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
