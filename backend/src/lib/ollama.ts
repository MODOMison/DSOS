// Ollama backend for Oracle — speaks Ollama's /api/chat with tools, parses
// the NDJSON stream, and emits our shared SSE event shape so the frontend
// is identical regardless of which brain is running.
//
// Tool format: Ollama uses OpenAI-style function tools. We convert our
// Anthropic.Tool[] definitions on the fly.

import type Anthropic from "@anthropic-ai/sdk";
import { executeTool } from "./tools.js";

type ClientMsg = { role: "user" | "assistant"; content: string };

// What we ship up to Ollama. Content is always a string here; for tool
// results we use role: "tool".
type OllamaMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls: { function: { name: string; arguments: unknown } }[];
    }
  | { role: "tool"; content: string };

interface OllamaStreamChunk {
  message?: {
    role: string;
    content?: string;
    tool_calls?: { function: { name: string; arguments: unknown } }[];
  };
  done?: boolean;
  error?: string;
}

export interface OllamaConfig {
  url: string;
  model: string;
  systemPrompt: string;
  port: number;
  tools: Anthropic.Tool[];
  userId?: string;
}

type Sender = (event: string, data: unknown) => void;

function toOllamaTools(tools: Anthropic.Tool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export async function probeOllama(url: string): Promise<{
  available: boolean;
  models: string[];
  reason?: string;
}> {
  try {
    const r = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) {
      return {
        available: false,
        models: [],
        reason: `Ollama returned ${r.status} at ${url}`,
      };
    }
    const data = (await r.json()) as { models?: { name: string }[] };
    return {
      available: true,
      models: (data.models ?? []).map((m) => m.name),
    };
  } catch (e) {
    return {
      available: false,
      models: [],
      reason: `Ollama not reachable at ${url} — install from https://ollama.com and run 'ollama serve'`,
    };
  }
}

export async function streamOllama(
  cfg: OllamaConfig,
  clientMessages: ClientMsg[],
  send: Sender
): Promise<void> {
  const messages: OllamaMessage[] = [
    { role: "system", content: cfg.systemPrompt },
    ...clientMessages.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (let iter = 0; iter < 8; iter++) {
    let res: Response;
    try {
      res = await fetch(`${cfg.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          tools: toOllamaTools(cfg.tools),
          stream: true,
          options: { num_predict: 800, temperature: 0.7 },
        }),
      });
    } catch (e) {
      send("error", {
        message: `Could not reach Ollama at ${cfg.url}. Is 'ollama serve' running?`,
      });
      return;
    }

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      // Surface "model not found" specifically — it's the most common error.
      if (/not found|does not exist/i.test(errText)) {
        send("error", {
          message: `Model '${cfg.model}' not pulled. Run: ollama pull ${cfg.model}`,
        });
      } else {
        send("error", {
          message: `Ollama returned ${res.status}: ${errText.slice(0, 200)}`,
        });
      }
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let assistantContent = "";
    let toolCalls: { function: { name: string; arguments: unknown } }[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // NDJSON — one JSON object per line.
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let chunk: OllamaStreamChunk;
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }
        if (chunk.error) {
          send("error", { message: chunk.error });
          return;
        }
        const msg = chunk.message;
        if (msg?.content) {
          assistantContent += msg.content;
          send("text", { delta: msg.content });
        }
        if (msg?.tool_calls && msg.tool_calls.length > 0) {
          toolCalls = msg.tool_calls;
        }
      }
    }

    // Loop exit condition: no tool calls → assistant finished a normal turn.
    if (toolCalls.length === 0) {
      send("done", { stop_reason: "end_turn" });
      return;
    }

    // Persist the assistant turn (with its tool calls) so the next round of
    // the loop has context for tool_result messages.
    messages.push({
      role: "assistant",
      content: assistantContent,
      tool_calls: toolCalls,
    });

    // Run every tool the model requested this turn.
    for (const tc of toolCalls) {
      const id = `call_${Math.random().toString(36).slice(2, 10)}`;
      const args =
        typeof tc.function.arguments === "string"
          ? safeParse(tc.function.arguments)
          : (tc.function.arguments as Record<string, unknown>);
      send("tool_start", {
        id,
        name: tc.function.name,
        input: args,
      });
      const result = await executeTool(tc.function.name, args, cfg.port, cfg.userId);
      send("tool_result", {
        id,
        name: tc.function.name,
        ok: result.ok,
        preview: result.output.slice(0, 400),
      });
      messages.push({
        role: "tool",
        content: result.output,
      });
    }
  }

  send("error", { message: "agent loop hit the 8-turn ceiling" });
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
