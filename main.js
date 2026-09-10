const { app, BrowserWindow, globalShortcut, screen, ipcMain, shell, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const { scanApps, appFromPath } = require('./appScanner');
const { findRunningProcesses, closeProcesses, parseWindowsArgs } = require('./processUtils');
const configFile = require('./config');

// Evita un crash nativo conocido de Electron en Windows 10/11: la feature
// "Native Window Occlusion" choca con ventanas transparentes + always-on-top.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Dos instancias no pueden convivir: los atajos globales los coge la primera,
// asi que la segunda arranca con la rueda muda y dos iconos en la bandeja, sin
// ninguna pista de por que. La segunda se retira y le pide a la primera que
// abra los ajustes, que es lo unico util que podia querer quien la lanzo.
// Ojo en desarrollo: `npm start` con la version instalada abierta se cierra
// solo, y es correcto — comparten config y atajos.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
else app.on('second-instance', () => createSettingsWindow());

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
// Tamano al que esta dibujado el CSS de la rueda. No se toca: para agrandarla
// se escala el diseno entero (ver --wheel-scale en radial.js), en vez de
// recalcular radios, iconos y etiquetas por separado, que es donde se
// desincronizan las cosas.
const DESIGN_SIZE = 480;
const WHEEL_SIZES = [380, 480, 620, 780];
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
// La bandeja tiene su propio PNG transparente: el icono de aplicacion lleva
// fondo solido y a 16 px se leeria como un cuadrado, no como la marca.
const TRAY_ICON = nativeImage
  .createFromPath(path.join(__dirname, 'assets', 'tray.png'))
  .resize({ width: 16, height: 16 });

let radialWindow = null;
let settingsWindow = null;
let tray = null;
let activeWheelId = null;

// La logica de lectura/escritura vive en config.js (recibe la ruta como
// parametro) para poder probarla con node a secas, fuera de Electron.
function loadConfig() {
  return configFile.loadConfig(CONFIG_PATH);
}

function saveConfig(config) {
  configFile.saveConfig(CONFIG_PATH, config);
}

// Ocultar la rueda pasa por aqui SIEMPRE. Cualquier cosa que la cierre
// (perder el foco, lanzar una app, abrir ajustes) puede llegar cuando la
// ventana ya esta destruida, y llamar a .hide() sobre una ventana destruida
// lanza excepcion. Una sola guarda aqui cubre a todos los que la ocultan.
function hideRadial() {
  if (radialWindow && !radialWindow.isDestroyed()) radialWindow.hide();
}

function wheelSize() {
  const saved = loadConfig().wheelSize;
  return WHEEL_SIZES.includes(saved) ? saved : DESIGN_SIZE;
}

// Devuelve tamano y posicion a la vez porque uno depende del otro: la rueda no
// puede ser mas grande que la pantalla donde va a salir, asi que si no cabe se
// recorta antes de centrarla.
function getPlacement() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const size = Math.min(wheelSize(), width, height);
  return {
    size,
    x: Math.round(x + width / 2 - size / 2),
    y: Math.round(y + height / 2 - size / 2),
  };
}

function createRadialWindow() {
  const pos = getPlacement();
  radialWindow = new BrowserWindow({
    width: pos.size,
    height: pos.size,
    x: pos.x,
    y: pos.y,
    icon: ICON_PATH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  radialWindow.setAlwaysOnTop(true, 'floating');
  radialWindow.loadFile(path.join(__dirname, 'renderer', 'radial.html'));
  radialWindow.once('ready-to-show', () => {
    radialWindow.show();
    radialWindow.focus();
  });
  radialWindow.on('blur', hideRadial);
}

function toggleWheel(wheelId) {
  const alreadyShowingThis =
    radialWindow && !radialWindow.isDestroyed() && radialWindow.isVisible() && activeWheelId === wheelId;

  if (alreadyShowingThis) {
    radialWindow.hide();
    return;
  }

  activeWheelId = wheelId;

  if (!radialWindow || radialWindow.isDestroyed()) {
    createRadialWindow();
  } else {
    // El tamano puede haber cambiado en ajustes desde la ultima vez, y la
    // ventana ya existente conserva el de entonces.
    const pos = getPlacement();
    radialWindow.setBounds({ x: pos.x, y: pos.y, width: pos.size, height: pos.size });
    radialWindow.webContents.reload();
    radialWindow.show();
    radialWindow.focus();
  }
}

// Devuelve la lista de atajos que no se han podido registrar, para que la
// ventana de ajustes pueda avisar al usuario en vez de fallar en silencio.
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const failed = [];
  loadConfig().wheels.forEach((wheel) => {
    if (!wheel.shortcut) return;
    let ok = false;
    try {
      ok = globalShortcut.register(wheel.shortcut, () => toggleWheel(wheel.id));
    } catch {
      ok = false; // acelerador con sintaxis que Electron no acepta
    }
    if (!ok) {
      console.error(`[shortcuts] no se pudo registrar "${wheel.shortcut}" para la rueda "${wheel.name}"`);
      failed.push({ wheel: wheel.name, shortcut: wheel.shortcut });
    }
  });
  return failed;
}

// Lo que el renderer nos ha dicho la ultima vez sobre si el arbol tiene
// cambios sin guardar. Se pregunta al cerrar: el arbol solo se persiste al
// pulsar Guardar, y un aspa por error se llevaba por delante todo el rato.
let settingsDirty = false;
ipcMain.on('settings-dirty', (_evt, dirty) => {
  settingsDirty = dirty;
});

// Los avisos van por globo de la bandeja: en la app instalada no hay consola
// donde leer un console.error, asi que un fallo se vivia como que Nimbo
// simplemente no hacia nada.
function notify(title, content) {
  console.error(`[${title}] ${content}`);
  if (tray && !tray.isDestroyed()) tray.displayBalloon({ icon: ICON_PATH, title, content });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsDirty = false;
  settingsWindow = new BrowserWindow({
    width: 820,
    height: 680,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));

  // El dialogo lo pone el proceso principal, no un confirm() del renderer:
  // Chromium ignora los dialogos lanzados desde beforeunload, asi que alli la
  // pregunta no llegaria a verse y la respuesta seria siempre "no".
  settingsWindow.on('close', (e) => {
    if (!settingsDirty) return;
    const choice = dialog.showMessageBoxSync(settingsWindow, {
      type: 'warning',
      buttons: ['Cerrar sin guardar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Nimbo',
      message: 'Hay cambios sin guardar.',
      detail: 'Si cierras ahora se pierden los cambios en las ruedas.',
    });
    if (choice === 1) e.preventDefault();
    else settingsDirty = false;
  });
}

const AUTOSTART_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const AUTOSTART_REG_VALUE = 'Nimbo';

function getAutostart() {
  if (app.isPackaged) {
    return app.getLoginItemSettings().openAtLogin;
  }
  // En desarrollo escribimos la entrada del registro a mano (ver applyAutostart).
  try {
    execFileSync('reg', ['query', AUTOSTART_REG_KEY, '/v', AUTOSTART_REG_VALUE], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function applyAutostart(enabled) {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return;
  }

  // En desarrollo ("electron ."), electron.exe no sabe que carpeta cargar por
  // si solo: hay que pasarle la ruta del proyecto como argumento. Escribimos
  // la entrada del registro nosotros mismos (en vez de usar
  // app.setLoginItemSettings con path/args personalizados) porque esa API no
  // pone comillas alrededor de rutas con espacios, lo que rompe el arranque
  // en cualquier cuenta de Windows cuyo nombre de usuario tenga un espacio.
  if (enabled) {
    const command = `"${process.execPath}" "${app.getAppPath()}"`;
    execFileSync('reg', ['add', AUTOSTART_REG_KEY, '/v', AUTOSTART_REG_VALUE, '/t', 'REG_SZ', '/d', command, '/f']);
  } else {
    try {
      execFileSync('reg', ['delete', AUTOSTART_REG_KEY, '/v', AUTOSTART_REG_VALUE, '/f']);
    } catch {
      // no existia, nada que borrar
    }
  }
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return; // esta instancia ya se esta cerrando
  const failed = registerShortcuts();

  tray = new Tray(TRAY_ICON);
  tray.setToolTip('Nimbo');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Configurar...', click: createSettingsWindow },
      {
        label: 'Iniciar con Windows',
        type: 'checkbox',
        checked: getAutostart(),
        click: (menuItem) => applyAutostart(menuItem.checked),
      },
      { type: 'separator' },
      { label: 'Salir', click: () => app.quit() },
    ])
  );

  // En la app instalada no hay consola donde leer el error de registerShortcuts:
  // sin este globo, un atajo que tiene cogido otro programa se vive como que
  // Nimbo simplemente no hace nada al arrancar.
  if (failed.length > 0) {
    notify(
      'Nimbo: atajo no disponible',
      failed.map((f) => `${f.shortcut} — rueda "${f.wheel}"`).join('\n') +
        '\nLo tiene cogido otro programa. Cambia el atajo en Configurar...'
    );
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // seguir vivo en la bandeja del sistema
});

ipcMain.handle('get-active-wheel', () => {
  const config = loadConfig();
  return config.wheels.find((w) => w.id === activeWheelId) || config.wheels[0] || null;
});

ipcMain.handle('get-wheels-config', () => {
  const config = loadConfig();
  return { wheels: config.wheels, degraded: !!config.degraded };
});

ipcMain.handle('save-wheels-config', (_evt, wheels) => {
  const current = loadConfig();
  // Si el config no se ha podido leer en este arranque, lo que se ha estado
  // editando son las ruedas vacias por defecto: guardarlas machacaria las de
  // verdad, que siguen enteras en disco. No se guarda y se dice por que.
  if (current.degraded) {
    return {
      error:
        'No se guarda: config.json no se ha podido leer en este arranque y guardarlo ahora borraría tus ruedas. Cierra Nimbo y vuelve a abrirlo.',
      failed: [],
    };
  }
  // Conservamos el resto del config (el tema, y lo que venga despues): antes
  // esto escribia { wheels } a secas y se llevaba por delante lo demas.
  saveConfig({ ...current, wheels });
  return { failed: registerShortcuts() };
});

ipcMain.handle('get-theme', () => loadConfig().theme || 'auto');

ipcMain.handle('get-wheel-size', () => wheelSize());

ipcMain.handle('set-wheel-size', (_evt, size) => {
  saveConfig({ ...loadConfig(), wheelSize: size });
  return wheelSize();
});

ipcMain.handle('set-theme', (_evt, theme) => {
  saveConfig({ ...loadConfig(), theme });
  // La rueda no necesita aviso: se recarga cada vez que se abre.
  return theme;
});

// Windows no ofrece ninguna forma de listar los atajos globales que ya estan
// cogidos: lo unico que se puede hacer es intentar registrar uno y ver si
// entra. Eso es lo que hacemos aqui, y lo deshacemos acto seguido.
// Soltamos antes los nuestros porque si no, un atajo que sigue en el config
// guardado (aunque el usuario lo acabe de cambiar en la ventana de ajustes)
// se reportaria como ocupado por culpa de nosotros mismos.
ipcMain.handle('check-shortcut', (_evt, accelerator) => {
  globalShortcut.unregisterAll();
  let free = false;
  try {
    free = globalShortcut.register(accelerator, () => {});
    if (free) globalShortcut.unregister(accelerator);
  } catch {
    free = false; // acelerador invalido
  }
  registerShortcuts();
  return free;
});

ipcMain.handle('scan-apps', () => scanApps());

// Las tres formas de anadir un programa sin escanear nada: elegirlo en el
// dialogo de archivos, soltarlo sobre la ventana, o pegar su ruta. Las tres
// acaban en appFromPath(), que es quien valida.
ipcMain.handle('pick-app-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Elegir programa',
    properties: ['openFile'],
    filters: [
      { name: 'Programas y accesos directos', extensions: ['exe', 'lnk'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return appFromPath(result.filePaths[0]);
});

ipcMain.handle('app-from-path', (_evt, filePath) => appFromPath(filePath));

// De una lista de rutas devuelve las que ya no existen. Un programa
// desinstalado se quedaba mudo en la rueda sin decir por que; asi los ajustes
// pueden marcarlo. Va en bloque para no hacer un ida y vuelta por item.
ipcMain.handle('missing-paths', (_evt, paths) => paths.filter((p) => !fs.existsSync(p)));

ipcMain.handle('get-autostart', () => getAutostart());
ipcMain.handle('set-autostart', (_evt, enabled) => {
  applyAutostart(enabled);
  return getAutostart();
});

const ICON_MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

ipcMain.handle('pick-icon-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Elegir icono',
    properties: ['openFile'],
    filters: [{ name: 'Imagenes', extensions: Object.keys(ICON_MIME_BY_EXT) }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ICON_MIME_BY_EXT[ext] || 'application/octet-stream';
  const buffer = fs.readFileSync(filePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
});

ipcMain.handle('launch-app', async (_evt, execPath, toggleClose = true, args = '') => {
  hideRadial();

  const running = toggleClose ? await findRunningProcesses(execPath) : [];
  if (running.length > 0) {
    // Apps sin ventana (bandeja, ej. NVDA): no pueden tener dialogos de
    // "guardar cambios", asi que cerrarlas forzado es seguro.
    const headless = running.filter((p) => !p.hasWindow).map((p) => p.pid);
    // Apps con ventana: cierre normal (como pulsar la X), nunca forzado,
    // para no perder cambios sin guardar.
    const windowed = running.filter((p) => p.hasWindow).map((p) => p.pid);
    closeProcesses(headless, true);
    closeProcesses(windowed, false);
    return;
  }

  if (args) {
    // shell.openPath no sabe pasar argumentos, asi que con argumentos usamos
    // spawn desligado (detached + stdio ignore + unref) para que el programa
    // sobreviva aunque Nimbo se cierre. Sin argumentos NO tocamos esto: dejamos
    // shell.openPath, que es el camino comun y maneja mejor los casos raros
    // (UAC, tipos de fichero asociados, etc).
    try {
      const child = spawn(execPath, parseWindowsArgs(args), { detached: true, stdio: 'ignore' });
      child.on('error', (err) => notify('Nimbo: no se pudo abrir', `${execPath}\n${err.message}`));
      child.unref();
    } catch (err) {
      notify('Nimbo: no se pudo abrir', `${execPath}\n${err.message}`);
    }
    return;
  }

  const result = await shell.openPath(execPath);
  if (result) notify('Nimbo: no se pudo abrir', `${execPath}\n${result}`);
});

ipcMain.handle('close-radial', hideRadial);

ipcMain.handle('open-link', async (_evt, url) => {
  hideRadial();
  // Lo que no trae esquema (http://, mailto:...) es una ruta local: una
  // carpeta o un fichero, y eso lo abre el explorador, no el navegador. El
  // esquema pide dos caracteres o mas: con uno, "D:" pasaria por esquema.
  if (!/^[a-z][a-z0-9+.-]+:/i.test(url)) {
    const err = await shell.openPath(url);
    if (err) notify('Nimbo: no se pudo abrir', `${url}\n${err}`);
    return;
  }
  await shell.openExternal(url);
});

ipcMain.handle('open-settings', () => {
  if (radialWindow && !radialWindow.isDestroyed()) {
    radialWindow.destroy();
  }
  radialWindow = null;
  createSettingsWindow();
});
