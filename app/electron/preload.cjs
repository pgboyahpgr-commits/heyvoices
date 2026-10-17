const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('heyvoice', {
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showItem: (p) => ipcRenderer.invoke('show-item', p),
  backendUrl: () => ipcRenderer.invoke('backend-url'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
})
