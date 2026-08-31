// Chat provider abstraction. The engine only ever talks to a ChatProvider;
// getProvider() picks a real client (BYOK: Anthropic-compatible or
// OpenAI-compatible) or the deterministic mock, so every flow works
// identically with or without an API key.

import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, ConversationMessage } from "@/lib/types";
import { MockProvider, type MockContext } from "./mock";
import {
  providerUsable,
  ZAI_DEFAULT_BASE_URL,
  ZAI_DEFAULT_MODEL,
  type AiSettings,
} from "./settings";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AssistantTurn {
  text: string;
  toolCalls: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    /** Mock scripting identity (fed-04): which script-step key fired this
     *  call — real providers leave it absent and nothing reads it. */
    stepKey?: string;
  }[];
  /** Token accounting when the provider reports it (real providers do). */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatProvider {
  complete(p: {
    system: string;
    messages: ConversationMessage[];
    tools: ToolSpec[];
    maxTokens?: number;
  }): Promise<AssistantTurn>;
}

class AnthropicProvider implements ChatProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(settings: AiSettings) {
    this.client = new Anthropic({
      apiKey: settings.apiKey,
      baseURL: settings.baseUrl || undefined,
    });
    this.model = settings.model;
  }

  async complete(p: {
    system: string;
    messages: ConversationMessage[];
    tools: ToolSpec[];
    maxTokens?: number;
  }): Promise<AssistantTurn> {
    // Our ConversationMessage[] mirrors the Messages API shape, so it maps
    // directly. No temperature: removed on modern models.
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: p.maxTokens ?? 4096,
      system: p.system,
      messages: p.messages as Anthropic.MessageParam[],
      tools: p.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      })),
    });

    let text = "";
    const toolCalls: AssistantTurn["toolCalls"] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }
    return {
      text,
      toolCalls,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  }
}

// -- OpenAI-compatible provider ----------------------------------------------
// Speaks the Chat Completions dialect (OpenAI, Azure OpenAI v1, Ollama, vLLM,
// Z.AI's OpenAI-style endpoint, …) over plain fetch — no extra SDK. Our
// conversation format mirrors the Anthropic Messages shape, so this adapter
// translates blocks <-> chat messages and tool_use <-> function tool_calls.

type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function toOpenAiMessages(
  system: string,
  messages: ConversationMessage[],
): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const text = msg.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      const toolCalls = msg.content
        .filter(
          (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
            b.type === "tool_use",
        )
        .map((b) => ({
          id: b.id,
          type: "function" as const,
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // User messages carry either plain text or tool results (one message
      // per result in the OpenAI dialect).
      const text = msg.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (text) out.push({ role: "user", content: text });
      for (const block of msg.content) {
        if (block.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: block.content,
          });
        }
      }
    }
  }
  return out;
}

class OpenAiCompatibleProvider implements ChatProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(settings: AiSettings) {
    this.apiKey = settings.apiKey;
    this.baseUrl = (settings.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.model = settings.model;
  }

  async complete(p: {
    system: string;
    messages: ConversationMessage[];
    tools: ToolSpec[];
    maxTokens?: number;
  }): Promise<AssistantTurn> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAiMessages(p.system, p.messages),
        ...(p.tools.length > 0
          ? {
              tools: p.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
            }
          : {}),
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      throw new Error(`OpenAI-compatible endpoint returned ${res.status}: ${detail}`);
    }
    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: {
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("OpenAI-compatible endpoint returned no choices.");

    const toolCalls: AssistantTurn["toolCalls"] = [];
    for (const [i, call] of (message.tool_calls ?? []).entries()) {
      if (!call.function?.name) continue;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* leave {} — the tool will report invalid input */
      }
      toolCalls.push({ id: call.id ?? `call_${i}`, name: call.function.name, input });
    }
    return {
      text: message.content ?? "",
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/**
 * A real (non-mock) provider for the given settings, or null when the
 * configuration cannot work (no key / no base URL). Used by the connection
 * test, which must not silently fall back to the mock.
 */
export function getRealProvider(settings: AiSettings): ChatProvider | null {
  if (!providerUsable(settings)) return null;
  if (settings.provider === "anthropic") return new AnthropicProvider(settings);
  if (settings.provider === "zai") {
    // Z.AI is a first-class provider with its own defaults; it speaks the
    // Anthropic wire dialect under the hood.
    return new AnthropicProvider({
      ...settings,
      baseUrl: settings.baseUrl || ZAI_DEFAULT_BASE_URL,
      model: settings.model || ZAI_DEFAULT_MODEL,
    });
  }
  if (settings.provider === "openai") return new OpenAiCompatibleProvider(settings);
  return null;
}

export function getProvider(settings: AiSettings, ctx: MockContext): ChatProvider {
  return getRealProvider(settings) ?? new MockProvider(ctx);
}
