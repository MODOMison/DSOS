import { Router } from "express";
import {
  ANTHROPIC_MODELS,
  OLLAMA_MODELS,
  loadSettings,
  saveSettings,
  type OracleSettings,
} from "../lib/settings.js";
import { probeOllama } from "../lib/ollama.js";
import { probeBuiltin } from "../lib/builtin.js";
import { probeOpenAICompat } from "../lib/openaiCompat.js";

export const settingsRouter = Router();

// GET /api/settings — returns current settings (sans the API key, which is
// write-only from the UI perspective) + status info for both backends + the
// curated model lists.
settingsRouter.get("/", async (_req, res) => {
  const s = await loadSettings();
  // builtin + openai-compat probes only fire when the user actually selected
  // that backend (or "auto"). Probing builtin unconditionally would load the
  // node-llama-cpp native addon on every settings load, which blocks the Node
  // event loop under tsx and freezes the whole settings panel on "loading...".
  const probeBuiltinNeeded = s.backend === "builtin" || s.backend === "auto";
  const [ollama, builtin] = await Promise.all([
    probeOllama(s.ollamaUrl),
    probeBuiltinNeeded
      ? probeBuiltin(s.builtinModelPath || undefined)
      : Promise.resolve({ available: false as const, reason: undefined }),
  ]);
  const openaiCompat =
    s.backend === "openai-compat"
      ? await probeOpenAICompat(s.openaiCompatUrl)
      : { available: false as const, models: [] as string[], reason: undefined };

  res.json({
    settings: {
      backend: s.backend,
      anthropicKey: s.anthropicKey ? "***" + s.anthropicKey.slice(-4) : "",
      hasAnthropicKey: !!s.anthropicKey,
      anthropicModel: s.anthropicModel,
      ollamaUrl: s.ollamaUrl,
      ollamaModel: s.ollamaModel,
      builtinModelPath: s.builtinModelPath,
      openaiCompatUrl: s.openaiCompatUrl,
      openaiCompatModel: s.openaiCompatModel,
      hasOpenaiCompatKey: !!s.openaiCompatKey,
    },
    catalog: {
      anthropic: ANTHROPIC_MODELS,
      ollama: OLLAMA_MODELS,
    },
    ollamaStatus: {
      available: ollama.available,
      reason: ollama.reason,
      installedModels: ollama.models,
    },
    builtinStatus: {
      available: builtin.available,
      modelName: builtin.modelName,
      modelPath: builtin.modelPath,
      reason: builtin.reason,
    },
    openaiCompatStatus: {
      available: openaiCompat.available,
      models: openaiCompat.models,
      reason: openaiCompat.reason,
    },
  });
});

// POST /api/settings — partial update. Pass anthropicKey:"" to clear it.
settingsRouter.post("/", async (req, res) => {
  const body = (req.body ?? {}) as Partial<OracleSettings>;
  // Validate enum
  if (
    body.backend &&
    !["anthropic", "builtin", "ollama", "openai-compat", "auto"].includes(body.backend)
  ) {
    return res.status(400).json({ error: "invalid backend" });
  }
  // Don't blindly persist masked values from the GET response.
  if (typeof body.anthropicKey === "string" && body.anthropicKey.includes("***")) {
    delete body.anthropicKey;
  }
  const updated = await saveSettings(body);
  res.json({
    backend: updated.backend,
    anthropicModel: updated.anthropicModel,
    ollamaModel: updated.ollamaModel,
    ollamaUrl: updated.ollamaUrl,
    hasAnthropicKey: !!updated.anthropicKey,
  });
});

// POST /api/settings/pull-ollama-model { model: "qwen2.5:7b" }
// Streams Ollama's /api/pull progress back as SSE. Front-end shows a bar.
settingsRouter.post("/pull-ollama-model", async (req, res) => {
  const model = String(req.body?.model ?? "").trim();
  if (!model) {
    return res.status(400).json({ error: "model is required" });
  }
  const s = await loadSettings();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let pullRes: Response;
  try {
    pullRes = await fetch(`${s.ollamaUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
    });
  } catch (e) {
    send("error", { message: `Could not reach Ollama at ${s.ollamaUrl}` });
    return res.end();
  }

  if (!pullRes.ok || !pullRes.body) {
    const txt = await pullRes.text().catch(() => "");
    send("error", { message: `Ollama returned ${pullRes.status}: ${txt.slice(0, 200)}` });
    return res.end();
  }

  const reader = pullRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const chunk = JSON.parse(line);
        send("progress", chunk);
      } catch {
        /* skip malformed */
      }
    }
  }

  send("done", { model });
  res.end();
});
