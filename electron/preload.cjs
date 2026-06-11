// Renderer-side bridge. Exposes a tiny `window.dsos` API for things the
// renderer can't do itself (close/hide/move/resize the companion window,
// and a main→companion app-awareness channel).

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dsos", {
  hideCompanion: () => ipcRenderer.invoke("dsos:hide-companion"),
  showCompanion: () => ipcRenderer.invoke("dsos:show-companion"),
  isElectron: true,

  // --- Companion window control (Desktop-Mate-style physical interaction) ---
  // Read the companion window rect, move it (drag/throw), resize it
  // (scroll-to-scale), and read the current display's work area (edge snap).
  companionGetBounds: () => ipcRenderer.invoke("dsos:companion-get-bounds"),
  companionSetPos: (x, y) => ipcRenderer.invoke("dsos:companion-set-pos", x, y),
  companionSetSize: (w, h) =>
    ipcRenderer.invoke("dsos:companion-set-size", w, h),
  companionGetWorkArea: () => ipcRenderer.invoke("dsos:companion-get-workarea"),

  // --- App-awareness: the main desktop announces, the companion listens. ---
  notifyAppOpen: (appId, title) =>
    ipcRenderer.invoke("dsos:app-open", appId, title),
  onAppEvent: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("dsos:app-event", handler);
    return () => ipcRenderer.removeListener("dsos:app-event", handler);
  },

  // --- Panel riding: the main desktop reports the focused window's rect (in
  // its own content coordinates); the main process converts to screen coords
  // and forwards to the companion so the Shadow can perch on it. ---
  reportPanel: (rect) => ipcRenderer.send("dsos:panel", rect),
  onPanel: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("dsos:panel-screen", handler);
    return () => ipcRenderer.removeListener("dsos:panel-screen", handler);
  },

  // Temporary diagnostics: surface renderer-side events in the main-process
  // terminal log so we can see what the companion is actually doing.
  debug: (msg) => ipcRenderer.send("dsos:debug", msg),
});
