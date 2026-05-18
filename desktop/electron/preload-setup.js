const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('setupBridge', {
  saveEnv: (vars) => ipcRenderer.invoke('setup:saveEnv', vars),
  checkOllama: () => ipcRenderer.invoke('setup:checkOllama'),
  openOllamaDownload: () => ipcRenderer.invoke('setup:openOllamaDownload'),
  pullModel: (model) => ipcRenderer.invoke('setup:pullModel', model),
  launchApp: () => ipcRenderer.invoke('setup:launchApp'),
  onPullProgress: (cb) => ipcRenderer.on('setup:pullProgress', (_e, data) => cb(data)),
})
