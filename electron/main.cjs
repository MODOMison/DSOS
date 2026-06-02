// DSOS Electron main process.
//
// Two windows: a full DSOS desktop window + a frameless transparent
// always-on-top Companion that renders just Shadows (toggle Ctrl+Shift+O).
//
// Dev mode: assumes Vite (:5173) and the backend (:4000) are already
// running. `npm run dev:desktop` starts everything together.
//
// Packaged mode (app.isPackaged): spawn the bundled backend as a child
// process, wait for it to listen on :4000, then load the windows from
// http://localhost:4000/ (backend serves the frontend dist in prod).

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const http = require("node:http");
const https = require("node:https");
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
} = require("electron");

const IS_DEV = !app.isPackaged;
const BACKEND_PORT = 4000;
const DEV_URL = process.env.DSOS_DEV_URL || "http://localhost:5173";
const PROD_URL = `http://localhost:${BACKEND_PORT}`;

// Default built-in model. Mirrors backend/scripts/download-model.* — keep the
// filename in sync with what those scripts fetch so dev and packaged agree.
const MODEL = {
  fileName: "mythomax-l2-13b.Q4_K_M.gguf",
  url: "https://huggingface.co/TheBloke/MythoMax-L2-13B-GGUF/resolve/main/mythomax-l2-13b.Q4_K_M.gguf",
  approxGB: 7.4,
};

// The model is too big to bundle in the installer, so it lives in a writable
// per-user dir and is downloaded on first launch. The backend is told where
// via DSOS_MODELS_DIR (see backend/src/lib/builtin.ts).
function getModelsDir() {
  return path.join(app.getPath("userData"), "models");
}

function hasAnyModel(dir) {
  try {
    return fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith(".gguf"));
  } catch {
    return false;
  }
}

// Capture any unhandled main-process error to a file we can actually find.
// Default Electron behavior shows a modal dialog and gives no log on disk.
function crashLog(label, err) {
  try {
    const dir = app.isReady() ? app.getPath("userData") : path.dirname(process.execPath);
    fs.mkdirSync(dir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${label}: ${err?.stack ?? err}\n`;
    fs.appendFileSync(path.join(dir, "main-crash.log"), line);
  } catch {
    /* logging itself failed — nothing left to do */
  }
}
process.on("uncaughtException", (e) => crashLog("uncaughtException", e));
process.on("unhandledRejection", (e) => crashLog("unhandledRejection", e));

/** @type {BrowserWindow | null} */
let mainWin = null;
/** @type {BrowserWindow | null} */
let companionWin = null;
/** @type {import("node:child_process").ChildProcess | null} */
let backendProc = null;

// Probe :PORT once via a tiny GET. Resolves true if the server answered.
function pingBackend(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: 1000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForBackend(port, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pingBackend(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Stream a URL to disk, following redirects, reporting progress as bytes come
// in. Rejects on any non-200 final status or network error. The caller writes
// to a ".part" path and renames on success so a crash never leaves a truncated
// file that looks complete.
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let downloaded = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      file.destroy();
      reject(err);
    };

    const get = (u, redirects) => {
      if (redirects > 5) return fail(new Error("too many redirects"));
      const req = https.get(
        u,
        { headers: { "User-Agent": "DSOS-installer" } },
        (res) => {
          const code = res.statusCode || 0;
          // HuggingFace 302-redirects to a CDN; follow it.
          if (code >= 300 && code < 400 && res.headers.location) {
            res.resume();
            return get(new URL(res.headers.location, u).toString(), redirects + 1);
          }
          if (code !== 200) {
            res.resume();
            return fail(new Error(`download failed: HTTP ${code}`));
          }
          const total = Number(res.headers["content-length"] || 0);
          res.on("data", (chunk) => {
            downloaded += chunk.length;
            onProgress(downloaded, total);
          });
          res.pipe(file);
          file.on("finish", () =>
            file.close(() => {
              if (!settled) {
                settled = true;
                resolve();
              }
            })
          );
        }
      );
      req.on("error", fail);
    };

    file.on("error", fail);
    get(url, 0);
  });
}

// First-run model bootstrap. If no .gguf is present in the per-user models
// dir, open a small setup window and download the default model with a live
// progress bar before the rest of the app boots. Resolves once a model is in
// place, or when the user chooses to continue without one (Shadow then runs
// in cloud/Ollama mode, or stays dormant until configured).
async function ensureModel() {
  const dir = getModelsDir();
  fs.mkdirSync(dir, { recursive: true });
  if (hasAnyModel(dir)) return;

  const setupWin = new BrowserWindow({
    width: 540,
    height: 380,
    resizable: false,
    backgroundColor: "#0a0506",
    title: "DSOS — first-run setup",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "setup-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await setupWin.loadFile(path.join(__dirname, "setup.html"));

  const dest = path.join(dir, MODEL.fileName);
  const part = `${dest}.part`;

  const send = (channel, payload) => {
    if (!setupWin.isDestroyed()) setupWin.webContents.send(channel, payload);
  };

  // Throttle progress UI to ~4 updates/sec (data fires thousands of times/sec).
  let lastTick = 0;
  const onProgress = (downloaded, total) => {
    const now = Date.now();
    if (now - lastTick < 250 && downloaded !== total) return;
    lastTick = now;
    send("setup:progress", { downloaded, total });
  };

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ipcMain.removeAllListeners("setup:retry");
      ipcMain.removeAllListeners("setup:continue");
      if (!setupWin.isDestroyed()) setupWin.close();
      resolve();
    };

    const run = () => {
      send("setup:start", {
        fileName: MODEL.fileName,
        approxGB: MODEL.approxGB,
      });
      downloadFile(MODEL.url, part, onProgress)
        .then(() => {
          fs.renameSync(part, dest);
          send("setup:done", {});
          setTimeout(finish, 800);
        })
        .catch((err) => {
          try {
            if (fs.existsSync(part)) fs.unlinkSync(part);
          } catch {
            /* leftover .part; harmless, next run overwrites */
          }
          send("setup:error", {
            message: String(err && err.message ? err.message : err),
          });
        });
    };

    ipcMain.on("setup:retry", run);
    ipcMain.on("setup:continue", finish);
    // Closing the window = "continue without the model".
    setupWin.on("closed", finish);

    run();
  });
}

function spawnBackend() {
  if (backendProc) return;
  // Packaged layout (electron-builder extraResources):
  //   resources/
  //     backend/dist/index.js          ← entry
  //     backend/node_modules/...       ← runtime deps including native
  // process.resourcesPath points at resources/ inside the .app or unpacked.
  const backendEntry = path.join(
    process.resourcesPath,
    "backend",
    "dist",
    "index.js"
  );

  // Route backend stdout/stderr to a log file. process.stdout/stderr aren't
  // attached to a terminal in a packaged GUI app, so writing to them throws
  // EPIPE and crashes main. The log file is also actually useful — users
  // can paste it when reporting issues.
  const logDir = app.getPath("logs");
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    /* logs dir already exists or unwritable; either way carry on */
  }
  const logPath = path.join(logDir, "backend.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`\n=== backend spawn ${new Date().toISOString()} ===\n`);

  backendProc = spawn(process.execPath, [backendEntry], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(BACKEND_PORT),
      ELECTRON_RUN_AS_NODE: "1",
      // Point the built-in GGUF loader at the writable per-user models dir
      // that ensureModel() downloaded into. Without this the backend would
      // look in process.cwd()/models, which is wrong in a packaged app.
      DSOS_MODELS_DIR: getModelsDir(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  backendProc.stdout?.on("data", (b) => {
    try {
      logStream.write(b);
    } catch {
      /* log write failed; nothing to do from here */
    }
  });
  backendProc.stderr?.on("data", (b) => {
    try {
      logStream.write(b);
    } catch {
      /* log write failed; nothing to do from here */
    }
  });
  backendProc.on("exit", (code) => {
    try {
      logStream.write(`\n=== backend exited code=${code} ===\n`);
      logStream.end();
    } catch {
      /* ignore */
    }
    backendProc = null;
  });
}

function createMainWindow(url) {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0506",
    title: "DSOS",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin.loadURL(url);
  mainWin.on("closed", () => {
    mainWin = null;
  });
}

function createCompanionWindow(url) {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const w = 420;
  const h = 560;

  companionWin = new BrowserWindow({
    width: w,
    height: h,
    x: sw - w - 24,
    y: sh - h - 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    backgroundColor: "#00000000",
    title: "Shadows",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  companionWin.setAlwaysOnTop(true, "floating");
  companionWin.loadURL(`${url}/?mode=companion`);
  companionWin.on("closed", () => {
    companionWin = null;
  });
}

function toggleCompanion(url) {
  if (!companionWin) {
    createCompanionWindow(url);
    companionWin.once("ready-to-show", () => companionWin?.show());
    return;
  }
  if (companionWin.isVisible()) {
    companionWin.hide();
  } else {
    companionWin.show();
    companionWin.focus();
  }
}

async function boot() {
  const baseUrl = IS_DEV ? DEV_URL : PROD_URL;

  if (!IS_DEV) {
    // First launch: make sure the model is downloaded before the backend
    // starts looking for it. Shows the setup window if needed.
    await ensureModel();
    spawnBackend();
    const ready = await waitForBackend(BACKEND_PORT);
    if (!ready) {
      console.error("[dsos] backend never came up — aborting launch");
      app.quit();
      return;
    }
  }

  createMainWindow(baseUrl);
  createCompanionWindow(baseUrl);
  setTimeout(() => companionWin?.show(), 1200);

  globalShortcut.register("Control+Shift+O", () => toggleCompanion(baseUrl));
}

app.whenReady().then(boot);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    boot();
  }
});

// Preload bridge endpoints.
ipcMain.handle("dsos:hide-companion", () => {
  companionWin?.hide();
});
ipcMain.handle("dsos:show-companion", () => {
  if (!companionWin) {
    const baseUrl = IS_DEV ? DEV_URL : PROD_URL;
    createCompanionWindow(baseUrl);
  }
  companionWin?.show();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (backendProc && !backendProc.killed) {
    backendProc.kill();
    backendProc = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
