import { Router } from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { requireAuth } from "../lib/auth.js";
import { probeBuiltin } from "../lib/builtin.js";

export const installRouter = Router();

// Tracks whether an install is already in flight so we don't fire off
// concurrent npm processes from racey UI clicks.
let inflight = false;

/**
 * GET /api/install/builtin-status
 * Lightweight probe: is node-llama-cpp present yet?
 */
installRouter.get("/builtin-status", requireAuth, async (_req, res) => {
  const probe = await probeBuiltin();
  res.json({
    installed: probe.available || /No \.gguf model found/.test(probe.reason ?? ""),
    inflight,
    reason: probe.reason,
  });
});

/**
 * POST /api/install/builtin
 * Streams an `npm install node-llama-cpp` as SSE so the UI can show progress.
 * Events:
 *   log   { line }   — one line of stdout/stderr from npm
 *   done  { ok }     — install finished (ok=true on success)
 *   error { message }
 */
installRouter.post("/builtin", requireAuth, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  req.socket?.setNoDelay(true);
  res.flushHeaders?.();
  res.write(": stream-open\n\n");

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  if (inflight) {
    send("error", { message: "An install is already in progress." });
    return res.end();
  }
  inflight = true;

  // Backend dir is one level up from the compiled dist/ or the src/ root —
  // either way, the package.json with our optional dep lives at cwd().
  const backendDir = process.cwd();
  const isWindows = process.platform === "win32";
  const npmCmd = isWindows ? "npm.cmd" : "npm";

  send("log", { line: `Installing node-llama-cpp into ${backendDir}...` });
  send("log", { line: `(this downloads prebuilt CUDA/Metal/CPU binaries, ~100MB, can take 5-10 min)` });

  const child = spawn(npmCmd, ["install", "node-llama-cpp"], {
    cwd: backendDir,
    shell: isWindows,
    env: { ...process.env, NODE_LLAMA_CPP_SKIP_DOWNLOAD: "false" },
  });

  child.stdout.on("data", (chunk: Buffer) => {
    const lines = chunk.toString("utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) send("log", { line });
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const lines = chunk.toString("utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) send("log", { line });
  });

  child.on("error", (err) => {
    inflight = false;
    send("error", { message: `Failed to start npm: ${err.message}` });
    res.end();
  });

  child.on("close", async (code) => {
    inflight = false;
    if (code === 0) {
      // Re-probe so the UI knows it's actually loadable now.
      const probe = await probeBuiltin();
      send("done", {
        ok: true,
        canLoad: probe.available,
        reason: probe.reason,
      });
    } else {
      send("done", { ok: false, exitCode: code });
    }
    res.end();
  });

  // Client disconnect: best-effort cleanup. We let the npm process keep
  // running (cancelling mid-install would leave the node_modules in a
  // broken state). inflight stays true until npm exits.
  res.on("close", () => {
    if (!child.killed && child.exitCode === null) {
      send("log", { line: "(client disconnected — install continues in background)" });
    }
  });
});
