# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm start                # arranca en desarrollo (electron .) - no abre ventana, vive en la bandeja
npm test                 # los cuatro checks: radial, appscanner, config, processutils
node test_config.js      # un solo check (assert de node, sin framework)
npm run pack             # dist/win-unpacked/Nimbo.exe (el camino normal)
npm run dist             # ademas instalador NSIS - necesita Modo desarrollador o terminal admin
```

Cierra la app antes de compilar; `check-not-running.js` lo verifica y aborta si no.

## Arquitectura

Electron sin ventana principal: vive en la bandeja y abre dos ventanas bajo demanda.

- **`main.js`** — unico punto con estado global (`radialWindow`, `settingsWindow`, `activeWheelId`). Registra los atajos globales, construye la bandeja y expone **todos** los handlers IPC. Los renderers no tocan nada del sistema: cualquier capacidad nueva pasa por un `ipcMain.handle` aqui + una linea en `preload.js`.
- **`preload.js`** — el unico puente (`window.nimbo`, `contextIsolation: true`). Es la superficie completa de la API para los dos renderers.
- **`config.js`, `appScanner.js`, `processUtils.js`** — logica pura/de sistema, fuera del proceso principal. `config.js` recibe la ruta como parametro (no importa `electron`) precisamente para poder probarlo con `node` a secas; `appScanner.js` si importa `electron` (usa `app.getFileIcon`) y por eso su test solo cubre la parte que no lo necesita.
- **`renderer/radial.js`** — la rueda. Exporta las funciones puras (`nextIndex`, `shortestAngle`, `sectorStart`) cuando se carga desde node y arranca contra el DOM cuando no; asi `test_radial.js` prueba la navegacion sin navegador.
- **`renderer/settings.js`** — la ventana de configuracion, el fichero mas grande. Manda un arbol completo de `wheels` por IPC al guardar.

### Modelo de datos

`%APPDATA%\Nimbo\config.json`: `{ wheels: [...], theme, wheelSize }`. Cada rueda es `{ id, name, shortcut, items }`; cada item es `type: 'app' | 'link' | 'folder' | 'macro' | 'script'` (carpetas y macros anidan via `items`). Maximo 8 items por nivel (`MAX_ITEMS` en `settings.js`) — es un limite de diseno de la rueda, no arbitrario.

Una macro es una carpeta que en vez de navegar hacia dentro, al activarla lanza sus `items` (solo `app`/`link`/`script`; una carpeta u otra macro anidada se ignora, `macroSteps` en `radial.js` las descarta) de uno en uno, con `MACRO_STEP_MS` de espera entre cada uno. Vive entera en el renderer: reutiliza `launchApp`/`openLink`, que ya cierran la rueda y validan cada elemento; no hay handler IPC nuevo.

Un `script` es texto de PowerShell que escribe el usuario (`item.command`); se lanza con el handler `run-script` (unico sitio nuevo de IPC que anadio esto, en `main.js` + `preload.js`), separado de `launch-app`/`open-link` porque ejecuta lo que sea, no un ejecutable conocido. **Sin `detached`, a proposito** (comentario `ponytail:` junto al handler): con `detached:true` el proceso se crea pero el script no llega a ejecutar ni su primera linea, sin ningun error — probado lanzandolo de verdad, no es una suposicion. `launchCommand()` en `treeMove.js` (junto a `moveTreeItem`, testeable con node) traduce un item `app`/`link` a su equivalente en PowerShell (`Start-Process ...`) solo para mostrarlo como referencia al escribir un script; no es lo que Nimbo ejecuta de verdad para esos dos tipos.

Al escribir el config, **conserva siempre el resto** (`saveConfig({ ...loadConfig(), wheels })`): escribir `{ wheels }` a secas se lleva por delante tema y tamano.

### Puntos de paso obligados

Cuando toques estas zonas, entra por la funcion que ya existe en vez de duplicar:

- **Ocultar la rueda** → `hideRadial()` en `main.js` (guarda el caso de ventana ya destruida).
- **Anadir un programa** desde cualquier via (dialogo, drag&drop, pegar ruta) → `appFromPath()` en `appScanner.js`, donde vive toda la validacion.
- **Leer un `.lnk`** → PowerShell en `appScanner.js`, nunca `shell.readShortcutLink()` (tumba el proceso entero).
- **Tamanos y radios de la rueda** → `--wheel-scale` sobre el diseno de 480 px. No recalcules geometrias por separado.
- **Colores** → `renderer/theme.css`. Un tema nuevo son un bloque `[data-theme='...']` ahi y una entrada en `THEMES` de `settings.js`; no hay colores escritos a mano fuera.

`preview/themes.html` abre las paletas en el navegador sin arrancar la app.

## Convenciones

- Codigo e identificadores en ingles; **comentarios, commits y textos de interfaz en castellano**. Los comentarios y mensajes de commit van **sin tildes** (ASCII); los textos que ve el usuario si las llevan.
- Los comentarios explican *por que*, no *que*: casi todos documentan una decision contraintuitiva con su motivo. Manten ese estilo y no borres uno sin entenderlo — la seccion "Notas de implementacion" del README recoge las principales (crash de occlusion nativa, escritura atomica del config, cierre forzado solo para procesos sin ventana, autoarranque escrito a mano en el registro...). **Leelas antes de "simplificar" algo que parezca raro.**
- Solo Windows: `reg`, `tasklist`, `taskkill`, PowerShell y el menu Inicio estan asumidos.
- Sin dependencias de runtime. Solo `electron` y `electron-builder` como devDependencies; los tests son `assert` de node.
