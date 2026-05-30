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
const { spawn } = require("node:child_process");
const http = require("node:http");
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
  backendProc = spawn(process.execPath, [backendEntry], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(BACKEND_PORT),
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  backendProc.stdout?.on("data", (b) => process.stdout.write(`[backend] ${b}`));
  backendProc.stderr?.on("data", (b) => process.stderr.write(`[backend] ${b}`));
  backendProc.on("exit", (code) => {
    console.log(`[dsos] backend exited with code ${code}`);
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
