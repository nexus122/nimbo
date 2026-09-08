const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opie', {
  getActiveWheel: () => ipcRenderer.invoke('get-active-wheel'),
  getWheelsConfig: () => ipcRenderer.invoke('get-wheels-config'),
  saveWheelsConfig: (wheels) => ipcRenderer.invoke('save-wheels-config', wheels),
  scanApps: () => ipcRenderer.invoke('scan-apps'),
  checkShortcut: (accelerator) => ipcRenderer.invoke('check-shortcut', accelerator),
  pickIconFile: () => ipcRenderer.invoke('pick-icon-file'),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enabled) => ipcRenderer.invoke('set-autostart', enabled),
  launchApp: (execPath, toggleClose) => ipcRenderer.invoke('launch-app', execPath, toggleClose),
  openLink: (url) => ipcRenderer.invoke('open-link', url),
  closeRadial: () => ipcRenderer.invoke('close-radial'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
});
