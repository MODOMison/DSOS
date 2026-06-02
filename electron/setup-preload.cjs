// Preload bridge for the first-run setup window (setup.html).
// Exposes a tiny, allow-listed API so the progress page can receive download
// updates from main and send back retry/continue actions.
const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED = ["setup:start", "setup:progress", "setup:done", "setup:error"];

contextBridge.exposeInMainWorld("dsosSetup", {
  on: (channel, cb) => {
    if (!ALLOWED.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
  retry: () => ipcRenderer.send("setup:retry"),
  continue: () => ipcRenderer.send("setup:continue"),
});
