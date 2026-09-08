const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('opie', {
  getActiveWheel: () => ipcRenderer.invoke('get-active-wheel'),
  getWheelsConfig: () => ipcRenderer.invoke('get-wheels-config'),
  saveWheelsConfig: (wheels) => ipcRenderer.invoke('save-wheels-config', wheels),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  getWheelSize: () => ipcRenderer.invoke('get-wheel-size'),
  setWheelSize: (size) => ipcRenderer.invoke('set-wheel-size', size),
  scanApps: () => ipcRenderer.invoke('scan-apps'),
  pickAppFile: () => ipcRenderer.invoke('pick-app-file'),
  appFromPath: (filePath) => ipcRenderer.invoke('app-from-path', filePath),
  // Un File soltado en la ventana ya no lleva .path (Electron lo quito): la
  // ruta real solo se puede sacar aqui, desde el preload.
  pathForFile: (file) => webUtils.getPathForFile(file),
  checkShortcut: (accelerator) => ipcRenderer.invoke('check-shortcut', accelerator),
  pickIconFile: () => ipcRenderer.invoke('pick-icon-file'),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enabled) => ipcRenderer.invoke('set-autostart', enabled),
  launchApp: (execPath, toggleClose, args) => ipcRenderer.invoke('launch-app', execPath, toggleClose, args),
  openLink: (url) => ipcRenderer.invoke('open-link', url),
  closeRadial: () => ipcRenderer.invoke('close-radial'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
});
