// Built-in GGUF inference worker.
//
// Runs as a child process spawned with plain `node` (NOT under tsx). This is
// the whole point: `await import("node-llama-cpp")` loads a native addon
// that blocks the Node event loop, and under tsx-watch on Windows the block
// never unblocks (see reference-dsos-dev-server). By isolating inference in
// a plain-node subprocess, the main backend's event loop is never touched
// by the native addon — settings, /ai/status, recon, etc. all stay snappy
// even while the 7GB MythoMax model is loading or generating tokens.
//
// Protocol — line-delimited JSON, stdin (in) / stdout (out). Logs go to stderr.
//
//   parent → child:
//     {"type":"chat","id":"<corr>","modelPath":"...","systemPrompt":"...","messages":[{role,content}...]}
//     {"type":"ping"}
//
//   child → parent:
//     {"type":"ready"}                                    once at boot
//     {"type":"loading","modelPath":"..."}                first chat
//     {"type":"loaded","ms":1234}                         after model load
//     {"type":"text","id":"<corr>","delta":"..."}         streamed tokens
//     {"type":"done","id":"<corr>"}
//     {"type":"error","id":"<corr>","message":"..."}
//     {"type":"pong"}

import readline from "node:readline";
import path from "node:path";

const log = (...args) => console.error("[builtin-worker]", ...args);
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

let lib = null;
let llama = null;
let model = null;
let loadedModelPath = null;

async function ensureLib() {
  if (lib) return lib;
  log("importing node-llama-cpp (one-time native addon load)");
  lib = await import("node-llama-cpp");
  log("getLlama()");
  llama = await lib.getLlama();
  log("llama ready");
  return lib;
}

async function ensureModel(modelPath) {
  await ensureLib();
  if (loadedModelPath === modelPath && model) return model;
  if (model) {
    try { await model.dispose?.(); } catch { /* ignore */ }
    model = null;
    loadedModelPath = null;
  }
  send({ type: "loading", modelPath });
  const t0 = Date.now();
  model = await llama.loadModel({ modelPath });
  const ms = Date.now() - t0;
  loadedModelPath = modelPath;
  log(`loaded ${path.basename(modelPath)} in ${ms}ms`);
  send({ type: "loaded", ms });
  return model;
}

function pickChatWrapper(fname) {
  const f = fname.toLowerCase();
  if (/llama-?3\.1|llama_?3_?1/.test(f)) return new lib.Llama3_1ChatWrapper();
  if (/llama-?3|llama_?3/.test(f)) return new lib.Llama3ChatWrapper();
  if (/mytho|alpaca|wizard|mythal|pygmalion|nous-hermes-2-yi/.test(f)) return new lib.AlpacaChatWrapper();
  if (/llama-?2|llama_?2|l2-/.test(f)) return new lib.Llama2ChatWrapper();
  return new lib.GeneralChatWrapper();
}

let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn, fn);
  return queue;
}

async function handleChat(req) {
  const { id, modelPath, systemPrompt, messages } = req;
  try {
    const m = await ensureModel(modelPath);
    const chatWrapper = pickChatWrapper(path.basename(modelPath));
    const context = await m.createContext({ contextSize: 4096 });
    const sequence = context.getSequence();
    const session = new lib.LlamaChatSession({
      contextSequence: sequence,
      systemPrompt: systemPrompt ?? "",
      chatWrapper,
    });
    // Replay prior user turns silently so the session has context.
    for (let i = 0; i < messages.length - 1; i++) {
      const msg = messages[i];
      if (msg.role === "user") {
        await session.prompt(msg.content, { onTextChunk: () => {}, maxTokens: 1 });
      }
    }
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") {
      send({ type: "error", id, message: "last message must be user" });
      try { await context.dispose?.(); } catch { /* ignore */ }
      return;
    }
    await session.prompt(last.content, {
      maxTokens: 800,
      onTextChunk: (delta) => { if (delta) send({ type: "text", id, delta }); },
    });
    send({ type: "done", id });
    try { await context.dispose?.(); } catch { /* ignore */ }
  } catch (e) {
    send({ type: "error", id, message: String(e?.message ?? e) });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); } catch { log("bad json line:", trimmed.slice(0, 80)); return; }
  if (req.type === "chat") {
    // Serialize chats — node-llama-cpp model handle is not safe for parallel
    // contexts on the same sequence pool.
    enqueue(() => handleChat(req));
  } else if (req.type === "ping") {
    send({ type: "pong" });
  }
});
// Parent died → stdin closes → we exit. Prevents 7GB zombie processes.
rl.on("close", () => process.exit(0));

send({ type: "ready" });
log("worker ready (pid", process.pid + ")");
