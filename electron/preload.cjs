// Renderer-side bridge. Exposes a tiny `window.dsos` API for things the
// renderer can't do itself (close/hide the companion window, etc.).

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dsos", {
  hideCompanion: () => ipcRenderer.invoke("dsos:hide-companion"),
  showCompanion: () => ipcRenderer.invoke("dsos:show-companion"),
  isElectron: true,
});
