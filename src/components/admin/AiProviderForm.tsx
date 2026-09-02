"use client";

import { useState } from "react";
import { AlertTriangle, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import Spinner from "@/components/common/Spinner";

export interface AiSettingsView {
  provider: string; // "anthropic" | "openai" | "mock" (as configured)
  baseUrl: string;
  model: string;
  autoTriage: boolean;
  autoDraft: boolean;
  qaEnabled: boolean;
  apiKeySet: boolean;
  keySource: "env" | "db" | "none";
  /** True when the configured provider currently falls back to mock. */
  fallingBackToMock: boolean;
}

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic (or compatible)" },
  { value: "zai", label: "Z.AI (GLM)" },
  { value: "openai", label: "OpenAI-compatible" },
  { value: "mock", label: "Mock (offline)" },
];

// Quick-fill presets for common BYOK setups. Values land in the form; the
// admin still pastes their own key and hits Save.
const PRESETS: {
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  model: string;
}[] = [
  { id: "anthropic", label: "Anthropic", provider: "anthropic", baseUrl: "", model: "claude-opus-5" },
  { id: "zai", label: "Z.AI GLM", provider: "zai", baseUrl: "", model: "glm-5.2" },
  { id: "openai", label: "OpenAI", provider: "openai", baseUrl: "", model: "gpt-5.1" },
  { id: "azure", label: "Azure OpenAI", provider: "openai", baseUrl: "https://<resource>.openai.azure.com/openai/v1", model: "<deployment-name>" },
  { id: "ollama", label: "Ollama (local, keyless)", provider: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.3" },
];

const ENV_VAR: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  zai: "ZAI_API_KEY",
  openai: "OPENAI_API_KEY",
};

export default function AiProviderForm({ initial }: { initial: AiSettingsView }) {
  const [provider, setProvider] = useState(initial.provider);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [autoTriage, setAutoTriage] = useState(initial.autoTriage);
  const [autoDraft, setAutoDraft] = useState(initial.autoDraft);
  const [qaEnabled, setQaEnabled] = useState(initial.qaEnabled);
  const [apiKeySet, setApiKeySet] = useState(initial.apiKeySet);
  const [keySource, setKeySource] = useState(initial.keySource);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setProvider(preset.provider);
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setTestResult(null);
  }

  async function save(extra?: { apiKey: string }) {
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      provider,
      baseUrl,
      model,
      autoTriage,
      autoDraft,
      qaEnabled,
    };
    if (extra) {
      body.apiKey = extra.apiKey;
    } else if (apiKey.trim() !== "") {
      body.apiKey = apiKey.trim();
    }
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        apiKeySet?: boolean;
        keySource?: "env" | "db" | "none";
      };
      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      if (typeof data.apiKeySet === "boolean") setApiKeySet(data.apiKeySet);
      if (data.keySource) setKeySource(data.keySource);
      setApiKey("");
      toast("Settings saved");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          baseUrl,
          model,
          ...(apiKey.trim() !== "" ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        latencyMs?: number;
        reply?: string;
        note?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setTestResult(null);
        setError(data.error ?? `Connection test failed (${res.status}).`);
        return;
      }
      const summary =
        data.note ??
        `Connected — ${data.latencyMs} ms, model ${model}, reply "${data.reply}"`;
      setTestResult(summary);
      toast("Connection OK");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setTesting(false);
    }
  }

  const busy = saving || testing;
  const envVar = ENV_VAR[provider];
  const keyDescription =
    keySource === "env"
      ? `A key is set via the ${envVar} environment variable — it takes precedence over any key saved here.`
      : keySource === "db"
        ? "A key is stored in Settings."
        : provider === "openai"
          ? `No key configured. Set ${envVar}, paste a key here, or use a keyless local endpoint via the base URL (e.g. Ollama).`
          
          : provider === "zai"
            ? `No key configured. Set ${envVar} or paste your Z.AI key here — until then Servo runs on the mock provider.`
          : provider === "anthropic"
            ? `No key configured. Set ${envVar} or paste a key here — until then Servo runs on the mock provider.`
            : "The mock provider needs no key.";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-4 font-sans"
    >
      {initial.fallingBackToMock && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>
            The configured provider has no usable credentials — Servo is
            currently running on the mock provider.
          </AlertTitle>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-preset" className="font-heading">
            Preset
          </Label>
          <Select onValueChange={applyPreset} disabled={busy}>
            <SelectTrigger id="ai-preset" className="w-full">
              <SelectValue placeholder="Quick-fill a known setup…" />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
              <SelectSeparator />
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Fills provider, base URL and model — you still paste your key.
              </div>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-provider" className="font-heading">
            Provider
          </Label>
          <Select
            value={provider}
            onValueChange={(value) => {
              setProvider(value);
              setTestResult(null);
            }}
            disabled={busy}
          >
            <SelectTrigger id="ai-provider" className="w-full">
              <SelectValue placeholder="Select a provider" />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-model" className="font-heading">
            Model
          </Label>
          <Input
            id="ai-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={provider === "openai" ? "gpt-5.1" : provider === "zai" ? "glm-5.2" : "claude-opus-5"}
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-base-url" className="font-heading">
            Base URL{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="ai-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={
              provider === "openai"
                ? "https://api.openai.com/v1"
                : provider === "zai"
                  ? "https://api.z.ai/api/anthropic (default)"
                  : "https://api.anthropic.com"
            }
            disabled={busy}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-api-key" className="font-heading">
          API key
        </Label>
        <Input
          id="ai-api-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            apiKeySet
              ? "•••••••• (key configured)"
              : provider === "anthropic"
                ? "sk-ant-…"
                : "sk-…"
          }
          disabled={busy}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{keyDescription}</p>
        {keySource === "db" && (
          <button
            type="button"
            onClick={() => void save({ apiKey: "" })}
            disabled={busy}
            className="self-start text-xs font-medium text-primary-strong hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            Clear stored key
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-6">
        <div className="flex items-center gap-2">
          <Switch
            id="ai-auto-triage"
            checked={autoTriage}
            onCheckedChange={(checked) => setAutoTriage(checked)}
            disabled={busy}
          />
          <Label htmlFor="ai-auto-triage" className="font-heading">
            Auto-triage new tickets
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="ai-auto-draft"
            checked={autoDraft}
            onCheckedChange={(checked) => setAutoDraft(checked)}
            disabled={busy}
          />
          <Label htmlFor="ai-auto-draft" className="font-heading">
            Draft replies for inbound email
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="ai-qa-enabled"
            checked={qaEnabled}
            onCheckedChange={(checked) => setQaEnabled(checked)}
            disabled={busy}
          />
          <Label htmlFor="ai-qa-enabled" className="font-heading">
            QA review after risky runs
          </Label>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
      {testResult && (
        <p className="text-sm text-primary-strong">{testResult}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy} className="font-heading">
          {saving && <Spinner size={14} className="text-primary-foreground" />}
          Save settings
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || provider === "mock"}
          onClick={() => void testConnection()}
          className="font-heading"
        >
          {testing ? <Spinner size={14} /> : <PlugZap size={15} />}
          Test connection
        </Button>
      </div>

      <Separator />
      <p className="font-body text-sm text-muted-foreground">
        Mock mode needs no key: a deterministic offline provider drives triage
        and resolution so the whole demo works without network access. Bring
        your own key for the Anthropic API or any Anthropic-compatible or
        OpenAI-compatible endpoint (OpenAI, Azure OpenAI, Z.AI, Ollama, vLLM…)
        — the agent loop, approvals and QA behave identically on all of them.
      </p>
    </form>
  );
}
