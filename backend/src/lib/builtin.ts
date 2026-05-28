// Built-in GGUF backend for Oracle.
//
// Loads a local GGUF model file into a CHILD PROCESS via node-llama-cpp.
// User drops a .gguf file into backend/models/ and we auto-pick it (or pin
// an explicit path via the builtinModelPath setting).
//
// Why a child process? node-llama-cpp is a native addon. `await import`ing
// it blocks the Node event loop, and under `tsx watch` on Windows that
// block never releases — the whole backend wedges (see
// reference-dsos-dev-server memory). The child process runs under plain
// `node` (not tsx), so the native addon can't touch the main event loop:
// settings, status, and other routes stay responsive even while the 7GB
// model is loading or generating tokens.
//
// node-llama-cpp is an OPTIONAL dependency. If it isn't installed,
// probeBuiltin returns available=false with a friendly reason and the
// worker is never spawned.

import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { Readable, Writable } from "node:stream";

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
  // Check that node-llama-cpp is installed WITHOUT executing it. A bare
  // `await import("node-llama-cpp")` loads the native addon, which blocks the
  // Node event loop synchronously under tsx on Windows (freezing every other
  // request). require.resolve only does a path lookup — instant. The real
  // (heavy) import happens in the worker child process.
  try {
    createRequire(import.meta.url).resolve("node-llama-cpp");
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
// Worker spawn + IPC.
//
// Singleton on globalThis so it survives module re-evaluation if tsx ever
// reloads this file without killing the whole process. tsx-watch normally
// kills the parent on file change → the worker's stdin closes → worker
// self-terminates (handled in builtinWorker.mjs) → no orphan 7GB process.
// ──────────────────────────────────────────────────────────────────

type WorkerMsg =
  | { type: "ready" }
  | { type: "loading"; modelPath: string }
  | { type: "loaded"; ms: number }
  | { type: "text"; id: string; delta: string }
  | { type: "done"; id: string }
  | { type: "error"; id: string; message: string }
  | { type: "pong" };

interface WorkerHandle {
  child: ChildProcessByStdio<Writable, Readable, Readable>;
  pending: Map<string, (msg: WorkerMsg) => void>;
  ready: Promise<void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __dsos_builtin_worker: WorkerHandle | undefined;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_SCRIPT = path.resolve(__dirname, "builtinWorker.mjs");

function getWorker(): WorkerHandle {
  const existing = globalThis.__dsos_builtin_worker;
  if (existing && existing.child.exitCode === null && !existing.child.killed) {
    return existing;
  }

  // CRITICAL: spawn with the same node binary that's running us
  // (process.execPath), NOT tsx. The whole point of the worker is to keep
  // the native addon's blocking import out of the tsx-watched main process.
  const child = spawn(process.execPath, [WORKER_SCRIPT], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }) as ChildProcessByStdio<Writable, Readable, Readable>;

  const pending = new Map<string, (msg: WorkerMsg) => void>();
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));

  const handle: WorkerHandle = { child, pending, ready };
  globalThis.__dsos_builtin_worker = handle;

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: WorkerMsg;
    try {
      msg = JSON.parse(trimmed) as WorkerMsg;
    } catch {
      return;
    }
    if (msg.type === "ready") {
      console.log("[builtin] worker ready");
      resolveReady();
      return;
    }
    if (msg.type === "loading") {
      console.log(`[builtin] worker loading ${path.basename(msg.modelPath)}...`);
      return;
    }
    if (msg.type === "loaded") {
      console.log(`[builtin] worker loaded model in ${(msg.ms / 1000).toFixed(1)}s`);
      return;
    }
    if (msg.type === "text" || msg.type === "done" || msg.type === "error") {
      const cb = pending.get(msg.id);
      if (cb) cb(msg);
    }
  });

  // Surface worker stderr (its own logs) prefixed.
  child.stderr.on("data", (buf: Buffer) => {
    process.stderr.write(buf);
  });

  child.on("exit", (code, signal) => {
    console.log(`[builtin] worker exited code=${code} signal=${signal}`);
    if (globalThis.__dsos_builtin_worker === handle) {
      globalThis.__dsos_builtin_worker = undefined;
    }
    // Fail any in-flight chats so the SSE stream closes cleanly.
    for (const [id, cb] of pending) {
      cb({ type: "error", id, message: `builtin worker exited (code=${code}, signal=${signal})` });
    }
    pending.clear();
  });

  // Parent exit → kill worker (stdin close also triggers worker self-exit;
  // this is belt-and-suspenders for SIGINT/SIGTERM under tsx watch).
  const killChild = () => {
    try { child.kill(); } catch { /* ignore */ }
  };
  process.once("exit", killChild);
  process.once("SIGINT", killChild);
  process.once("SIGTERM", killChild);

  return handle;
}

export async function streamBuiltin(
  cfg: BuiltinConfig,
  clientMessages: ClientMsg[],
  send: Sender
): Promise<void> {
  let handle: WorkerHandle;
  try {
    handle = getWorker();
    await handle.ready;
  } catch (e) {
    send("error", { message: `Failed to start built-in worker: ${(e as Error).message}` });
    return;
  }

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await new Promise<void>((resolve) => {
    handle.pending.set(id, (msg) => {
      if (msg.type === "text") {
        if (msg.delta) send("text", { delta: msg.delta });
      } else if (msg.type === "done") {
        send("done", { stop_reason: "end_turn" });
        handle.pending.delete(id);
        resolve();
      } else if (msg.type === "error") {
        send("error", { message: msg.message });
        handle.pending.delete(id);
        resolve();
      }
    });
    const req = {
      type: "chat" as const,
      id,
      modelPath: cfg.modelPath,
      systemPrompt: cfg.systemPrompt,
      messages: clientMessages,
    };
    try {
      handle.child.stdin.write(JSON.stringify(req) + "\n");
    } catch (e) {
      send("error", { message: `Failed to send to worker: ${(e as Error).message}` });
      handle.pending.delete(id);
      resolve();
    }
  });
}
