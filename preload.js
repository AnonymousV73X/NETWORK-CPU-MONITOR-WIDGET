const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  stats: () => ipcRenderer.invoke("stats"),
  quit: () => ipcRenderer.invoke("do-quit"),
  moveWindow: (delta) => ipcRenderer.send("move-window", delta),
  setDragStatus: (status) => ipcRenderer.send("drag-status", status),
  setConfirmStatus: (status) => ipcRenderer.send("confirm-status", status),
  setWindowPosition: (pos) => ipcRenderer.send("set-window-position", pos),
  resetPosition: () => ipcRenderer.send("reset-position"),
});
