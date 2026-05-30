// DSOS Electron main process.
// - Spawns one full-desktop window (the existing DSOS SPA).
// - Spawns one frameless, transparent, always-on-top Companion window
//   that renders just Shadows. Toggle with Ctrl+Shift+O.
//
// Dev mode points both windows at the Vite dev server on :5173.
// Backend (Express on :4000) is expected to be running separately —
// `npm run dev:desktop` at the repo root starts everything together.

const path = require("node:path");
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
} = require("electron");

const DEV_URL = process.env.DSOS_DEV_URL || "http://localhost:5173";
const IS_DEV = !app.isPackaged;

/** @type {BrowserWindow | null} */
let mainWin = null;
/** @type {BrowserWindow | null} */
let companionWin = null;

function createMainWindow() {
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

  mainWin.loadURL(DEV_URL);
  if (IS_DEV) {
    // mainWin.webContents.openDevTools({ mode: "detach" });
  }

  mainWin.on("closed", () => {
    mainWin = null;
  });
}

function createCompanionWindow() {
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
  companionWin.loadURL(`${DEV_URL}/?mode=companion`);

  companionWin.on("closed", () => {
    companionWin = null;
  });
}

function toggleCompanion() {
  if (!companionWin) {
    createCompanionWindow();
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

app.whenReady().then(() => {
  createMainWindow();
  createCompanionWindow();

  // Show the companion shortly after boot so the user sees it exists.
  setTimeout(() => companionWin?.show(), 1200);

  globalShortcut.register("Control+Shift+O", toggleCompanion);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// Preload bridge endpoints.
ipcMain.handle("dsos:hide-companion", () => {
  companionWin?.hide();
});
ipcMain.handle("dsos:show-companion", () => {
  if (!companionWin) createCompanionWindow();
  companionWin?.show();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
