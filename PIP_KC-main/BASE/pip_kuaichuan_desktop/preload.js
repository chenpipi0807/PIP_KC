const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pipAPI", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  updateConfig: (patch) => ipcRenderer.invoke("config:update", patch),
  restartServer: () => ipcRenderer.invoke("server:restart"),
  downloadFile: (payload) => ipcRenderer.invoke("download:file", payload),
});
