// Built-in GGUF backend for Oracle.
//
// Loads a local GGUF model file directly into the DSOS Express process via
// node-llama-cpp. No external server (Ollama, text-gen-webui) required —
// the inference engine and model live inside this Node process.
//
// User drops a .gguf file into backend/models/ and we auto-pick it. They
// can also pin an explicit path via the builtinModelPath setting.
//
// node-llama-cpp is declared as an OPTIONAL dependency in package.json, so
// users who don't want the built-in path don't pay the install cost. All
// access goes through lazy dynamic imports — if the package isn't installed,
// probeBuiltin returns available=false with a friendly reason.

import fs from "node:fs";
import path from "node:path";

type ClientMsg = { role: "user" | "assistant"; content: string };
type Sender = (event: string, data: unknown) => void;

export interface BuiltinConfig {
  modelPath: string;
  systemPrompt: string;
}

const MODELS_DIR = path.resolve(process.cwd(), "models");

export function findBuiltinModel(explicitPath?: string): string | null {
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;
  if (!fs.existsSync(MODELS_DIR)) return null;

  // Walk up to 3 levels deep so users can keep models organized in
  // per-model subfolders (e.g. models/TheBloke_MythoMax-L2-13B-GGUF/*.gguf
  // or models/llama-3.1-8b/Q4_K_M.gguf). Skip node_modules + dotfolders.
  const candidates: string[] = [];
  function walk(dir: string, depth: number) {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".gguf")) {
        candidates.push(full);
      }
    }
  }
  walk(MODELS_DIR, 0);

  // Smallest first — assume smaller quant = faster on the user's hardware.
  candidates.sort((a, b) => {
    try {
      return fs.statSync(a).size - fs.statSync(b).size;
    } catch {
      return 0;
    }
  });
  return candidates[0] ?? null;
}

export interface BuiltinProbeResult {
  available: boolean;
  modelPath?: string;
  modelName?: string;
  reason?: string;
}

export async function probeBuiltin(explicitPath?: string): Promise<BuiltinProbeResult> {
  // Check that node-llama-cpp is installed
  try {
    // @ts-ignore optional dependency
    await import("node-llama-cpp");
  } catch {
    return {
      available: false,
      reason:
        "Built-in inference unavailable. Install the optional dependency: `npm --prefix backend install node-llama-cpp`",
    };
  }
  const modelPath = findBuiltinModel(explicitPath);
  if (!modelPath) {
    return {
      available: false,
      reason: `No .gguf model found in backend/models/. Drop a model file there (e.g. MythoMax-L2-13B-Q4_K_M.gguf from huggingface.co/TheBloke/MythoMax-L2-13B-GGUF) and refresh.`,
    };
  }
  return {
    available: true,
    modelPath,
    modelName: path.basename(modelPath),
  };
}

// ──────────────────────────────────────────────────────────────────
// Model + context cache.
//
// Loading a 7-13B GGUF takes 5-30s. We load once at first request, hold
// in memory, and create a fresh chat session per conversation.
// Re-importing the module per request would also reset this — to keep it
// across hot reloads in dev we stash it on globalThis.
// ──────────────────────────────────────────────────────────────────

interface BuiltinModelHandle {
  model: unknown;
  llama: unknown;
  modelPath: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __dsos_builtin_model: BuiltinModelHandle | undefined;
}

async function ensureModelLoaded(modelPath: string): Promise<BuiltinModelHandle> {
  if (globalThis.__dsos_builtin_model?.modelPath === modelPath) {
    return globalThis.__dsos_builtin_model;
  }
  // Dispose old model if path changed.
  if (globalThis.__dsos_builtin_model) {
    try {
      const m = globalThis.__dsos_builtin_model.model as { dispose?: () => Promise<void> };
      await m.dispose?.();
    } catch {
      /* ignore */
    }
    globalThis.__dsos_builtin_model = undefined;
  }

  // @ts-ignore optional dependency
  const lib = (await import("node-llama-cpp")) as unknown as {
    getLlama: () => Promise<{
      loadModel: (opts: { modelPath: string }) => Promise<unknown>;
    }>;
  };
  const llama = await lib.getLlama();
  console.log(`[builtin] loading ${path.basename(modelPath)}...`);
  const t0 = Date.now();
  const model = await llama.loadModel({ modelPath });
  console.log(`[builtin] loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  globalThis.__dsos_builtin_model = { model, llama, modelPath };
  return globalThis.__dsos_builtin_model;
}

export async function streamBuiltin(
  cfg: BuiltinConfig,
  clientMessages: ClientMsg[],
  send: Sender
): Promise<void> {
  let handle: BuiltinModelHandle;
  try {
    handle = await ensureModelLoaded(cfg.modelPath);
  } catch (e) {
    send("error", {
      message: `Failed to load GGUF at ${cfg.modelPath}: ${(e as Error).message}`,
    });
    return;
  }

  try {
    // @ts-ignore optional dependency
    const lib = (await import("node-llama-cpp")) as unknown as {
      LlamaChatSession: new (args: {
        contextSequence: unknown;
        systemPrompt: string;
        chatWrapper?: unknown;
      }) => {
        prompt: (
          text: string,
          opts: { onTextChunk: (chunk: string) => void; maxTokens?: number }
        ) => Promise<string>;
      };
      AlpacaChatWrapper: new () => unknown;
      Llama2ChatWrapper: new () => unknown;
      Llama3ChatWrapper: new () => unknown;
      Llama3_1ChatWrapper: new () => unknown;
      GeneralChatWrapper: new () => unknown;
    };

    // Pick a chat template based on filename heuristics. Most fiction-tuned
    // models (MythoMax, Mythalion, Pygmalion variants, Wizard models) are
    // Llama-2 + Alpaca. Modern Llama 3+ uses its own template. Without the
    // right template the model emits EOS after one token.
    const fname = cfg.modelPath.toLowerCase();
    let chatWrapper: unknown;
    if (/llama-?3\.1|llama_?3_?1/.test(fname)) {
      chatWrapper = new lib.Llama3_1ChatWrapper();
    } else if (/llama-?3|llama_?3/.test(fname)) {
      chatWrapper = new lib.Llama3ChatWrapper();
    } else if (/mytho|alpaca|wizard|mythal|pygmalion|nous-hermes-2-yi/.test(fname)) {
      chatWrapper = new lib.AlpacaChatWrapper();
    } else if (/llama-?2|llama_?2|l2-/.test(fname)) {
      chatWrapper = new lib.Llama2ChatWrapper();
    } else {
      chatWrapper = new lib.GeneralChatWrapper();
    }
    console.log(`[builtin] using chat wrapper: ${chatWrapper?.constructor?.name ?? "unknown"}`);

    const model = handle.model as {
      createContext: (opts?: { contextSize?: number }) => Promise<{
        getSequence: () => unknown;
        dispose?: () => Promise<void>;
      }>;
    };
    const context = await model.createContext({ contextSize: 4096 });
    const sequence = context.getSequence();

    const session = new lib.LlamaChatSession({
      contextSequence: sequence,
      systemPrompt: cfg.systemPrompt,
      chatWrapper,
    });

    // Replay prior turns so the session has context.
    for (let i = 0; i < clientMessages.length - 1; i++) {
      const msg = clientMessages[i];
      if (msg.role === "user") {
        // Feed past user turns silently (no streaming) to build history.
        await session.prompt(msg.content, { onTextChunk: () => {}, maxTokens: 1 });
      }
    }
    const finalUser = clientMessages[clientMessages.length - 1];
    if (!finalUser || finalUser.role !== "user") {
      send("error", { message: "Last message must be from user." });
      try { await context.dispose?.(); } catch { /* ignore */ }
      return;
    }

    await session.prompt(finalUser.content, {
      maxTokens: 800,
      onTextChunk: (chunk) => {
        if (chunk) send("text", { delta: chunk });
      },
    });

    send("done", { stop_reason: "end_turn" });
    try { await context.dispose?.(); } catch { /* ignore */ }
  } catch (e) {
    send("error", {
      message: `Built-in inference error: ${(e as Error).message}`,
    });
  }
}
