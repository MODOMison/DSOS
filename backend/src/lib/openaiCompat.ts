// OpenAI-compatible backend for Shadows.
// Works with text-generation-webui (--api --extensions openai), vLLM,
// LM Studio's local server, llama-cpp-server, KoboldCPP, and anything else
// that speaks /v1/chat/completions with SSE streaming.
//
// Tools are intentionally DISABLED here — most fiction/roleplay-tuned
// local models (MythoMax, Pygmalion, Mythalion, etc.) either ignore the
// tools field or hallucinate calls in chat text. For tool-use you want
// Anthropic or a tool-trained model via Ollama (Qwen, Llama 3.1).

type ClientMsg = { role: "user" | "assistant"; content: string };
type Sender = (event: string, data: unknown) => void;

export interface OpenAICompatConfig {
  url: string;       // e.g. http://localhost:5000/v1
  model: string;     // model name the server expects
  apiKey?: string;   // optional bearer token
  systemPrompt: string;
}

export async function probeOpenAICompat(url: string): Promise<{
  available: boolean;
  models: string[];
  reason?: string;
}> {
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) {
      return {
        available: false,
        models: [],
        reason: `OpenAI-compat server returned ${r.status} at ${url}`,
      };
    }
    const data = (await r.json()) as { data?: { id: string }[] };
    return {
      available: true,
      models: (data.data ?? []).map((m) => m.id),
    };
  } catch (e) {
    return {
      available: false,
      models: [],
      reason: `OpenAI-compat server not reachable at ${url} (${(e as Error).message})`,
    };
  }
}

export async function streamOpenAICompat(
  cfg: OpenAICompatConfig,
  clientMessages: ClientMsg[],
  send: Sender
): Promise<void> {
  const url = `${cfg.url.replace(/\/$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: cfg.systemPrompt },
          ...clientMessages,
        ],
        stream: true,
        max_tokens: 800,
        temperature: 0.8,
      }),
    });
  } catch (e) {
    send("error", {
      message: `Could not reach OpenAI-compat server at ${cfg.url}: ${(e as Error).message}`,
    });
    return;
  }

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    send("error", {
      message: `Server returned ${res.status}: ${txt.slice(0, 300)}`,
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // OpenAI SSE: "data: {json}\n\n" frames, terminated by "data: [DONE]"
    let nl;
    while ((nl = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") {
          send("done", { stop_reason: "end_turn" });
          return;
        }
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            send("text", { delta });
          }
          const finish = chunk.choices?.[0]?.finish_reason;
          if (finish && finish !== "null") {
            send("done", { stop_reason: finish });
            return;
          }
        } catch {
          /* skip malformed */
        }
      }
    }
  }

  send("done", { stop_reason: "end_turn" });
}
