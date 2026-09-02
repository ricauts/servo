"use client";

// External MCP servers (cnp-02). The admin surface for registering a server,
// syncing its tool list, and seeing what that sync quarantined.
//
// Copy discipline: this release REGISTERS and GOVERNS connector tools — it
// does not make them callable. Every synced tool lands as a disabled,
// approval-required, HIGH-risk policy row, and nothing on this screen may
// suggest an agent can run one yet.
//
// Colour comes from semantic tokens only (`text-critical`, `text-warn`,
// `divide-border`, …) — never a raw hex, per §0.5 and the ds-01 lint.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import Badge from "@/components/common/Badge";
import Spinner from "@/components/common/Spinner";

export interface McpServerToolView {
  name: string;
  description: string;
  declaredRiskLevel: string | null;
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
  const [headers, setHeaders] = useState('{"Authorization":"Bearer {secret}"}');
  const [secret, setSecret] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await api("/api/mcp-servers", "POST", {
      slug: slug.trim(),
      name: name.trim(),
      transport: "http",
      url: url.trim(),
      headers,
      secret,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? null);
      return;
    }
    setSlug("");
    setName("");
    setUrl("");
    setSecret("");
    setCreating(false);
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

  async function remove(id: string) {
    setBusy(true);
    const res = await api(`/api/mcp-servers/${id}`, "DELETE");
    setBusy(false);
    setConfirmDelete(null);
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
    const created = (res.data?.created as string[] | undefined) ?? [];
    const requarantined = (res.data?.requarantined as string[] | undefined) ?? [];
    const parts = [`${created.length} new tool${created.length === 1 ? "" : "s"} quarantined`];
    if (requarantined.length > 0) {
      parts.push(`${requarantined.length} re-quarantined after a definition change`);
    }
    toast(parts.join(", "));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 font-sans">
      <p className="text-xs text-muted-foreground">
        Servo connects to external MCP servers over Streamable HTTP and syncs their
        tool list. Every synced tool is registered as{" "}
        <code className="font-mono text-[11px]">mcp__&lt;slug&gt;__&lt;tool&gt;</code> with a
        policy row that is disabled, approval-required and HIGH risk — a risk level the
        server declares is recorded and ignored. Agents cannot call these tools yet;
        this release registers and governs them, and the enable switch only records
        that a server is meant to be live — nothing reads it until execution ships.
        Requests leave through the outbound allowlist above, so a server on a private
        address must be named there exactly.
      </p>

      {servers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No MCP servers yet — add one to pull its tool catalogue into the registry.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {servers.map((server) => (
            <li key={server.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">
                  {server.name}{" "}
                  <code className="font-mono text-[11px] text-muted-foreground">
                    mcp__{server.slug}__
                  </code>
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                  {server.url}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge tone="neutral">{server.transport}</Badge>
                  <Badge tone={server.tools.length > 0 ? "brand" : "neutral"}>
                    {server.tools.length} tool{server.tools.length === 1 ? "" : "s"}
                  </Badge>
                  <Badge tone="warn">quarantined</Badge>
                  {server.secretSet && <Badge tone="neutral">secret set</Badge>}
                  {server.lastSyncAt === null && <Badge tone="neutral">never synced</Badge>}
                </span>
              </span>
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
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-[13px] text-critical">{error}</p>}

      <Button type="button" className="self-start" onClick={() => setCreating(true)}>
        <Plus size={15} />
        New MCP server
      </Button>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New MCP server</DialogTitle>
            <DialogDescription>
              Streamable HTTP only. The server arrives disabled; syncing its tools
              never enables anything.
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
                Becomes the tool prefix, and cannot be changed once tools are synced.
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
              <Label htmlFor="mcp-headers">Headers</Label>
              <Input
                id="mcp-headers"
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
                disabled={busy}
                className="font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                A JSON object. <code className="font-mono">{"{secret}"}</code> is
                substituted from the stored secret at request time.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-secret">Secret</Label>
              <Input
                id="mcp-secret"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                disabled={busy}
                className="font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Encrypted at rest with AES-256-GCM when SERVO_ENCRYPTION_KEY is set,
                and never returned by the API.
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
                  <Plug size={15} />
                )}
                Add server
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
