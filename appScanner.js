const { app } = require('electron');
const { execFile } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = util.promisify(execFile);

function getStartMenuDirs() {
  const dirs = [];
  if (process.env.APPDATA) {
    dirs.push(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  }
  if (process.env.ProgramData) {
    dirs.push(path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  }
  return dirs.filter((d) => fs.existsSync(d));
}

// Resolvemos los .lnk con PowerShell (WScript.Shell) en vez de con
// shell.readShortcutLink() de Electron: esa API nativa crashea el proceso
// entero (fallo NOTREACHED de Chromium, no capturable con try/catch) ante
// ciertos accesos directos mal formados (p.ej. IconLocation vacío). Al
// resolverlos en un proceso aparte, un shortcut raro como mucho falla solo
// para si mismo.
async function resolveShortcutsViaPowerShell(dirs) {
  const dirsLiteral = dirs.map((d) => `'${d.replace(/'/g, "''")}'`).join(',');
  const script = `
$dirs = @(${dirsLiteral})
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$sh = New-Object -ComObject WScript.Shell
$results = New-Object System.Collections.ArrayList
foreach ($dir in $dirs) {
  if (Test-Path -LiteralPath $dir) {
    Get-ChildItem -LiteralPath $dir -Filter *.lnk -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $sc = $sh.CreateShortcut($_.FullName)
        [void]$results.Add([PSCustomObject]@{ path = $_.FullName; target = $sc.TargetPath; args = $sc.Arguments })
      } catch {}
    }
  }
}
$out = [PSCustomObject]@{ apps = $results }
$out | ConvertTo-Json -Compress -Depth 5
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  console.log('[appScanner] lanzando PowerShell para resolver shortcuts...');
  let stdout;
  try {
    const result = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 }
    );
    stdout = result.stdout;
  } catch (err) {
    console.error('[appScanner] PowerShell fallo:', err.message);
    return [];
  }
  const cleaned = stdout.replace(/^﻿/, '').trim();
  if (!cleaned) return [];

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('[appScanner] no se pudo parsear la salida de PowerShell:', err.message);
    return [];
  }
  const apps = parsed && parsed.apps ? parsed.apps : [];
  const list = Array.isArray(apps) ? apps : [apps];
  console.log('[appScanner] PowerShell devolvio', list.length, 'shortcuts');
  return list;
}

// Resuelve un unico .lnk. Usamos PowerShell por el mismo motivo que el
// escaneo masivo de arriba: shell.readShortcutLink() de Electron tumba el
// proceso entero ante accesos directos mal formados, y aqui el fichero lo
// elige el usuario, asi que puede ser cualquier cosa.
async function resolveShortcutTarget(lnkPath) {
  const literal = `'${lnkPath.replace(/'/g, "''")}'`;
  const script = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$sh = New-Object -ComObject WScript.Shell
$sh.CreateShortcut(${literal}).TargetPath
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { encoding: 'utf8' }
    );
    return stdout.replace(/^﻿/, '').trim() || null;
  } catch (err) {
    console.error('[appScanner] no se pudo resolver el acceso directo:', err.message);
    return null;
  }
}

// Convierte una ruta suelta en un item de la rueda. Es el punto por el que
// pasan TODAS las formas de anadir un programa a mano (dialogo de archivos,
// arrastrar y soltar, pegar la ruta), asi que la validacion vive aqui una
// sola vez. Devuelve { app } o { error } con un mensaje para el usuario.
async function appFromPath(rawPath) {
  let target = String(rawPath || '').trim().replace(/^"(.*)"$/, '$1');
  if (!target) return { error: 'Ruta vacía.' };

  // El nombre sale del fichero que ha elegido el usuario, no del destino: un
  // acceso directo llamado "Google Chrome" apunta a "chrome.exe", y el nombre
  // bueno es el primero.
  const name = path.basename(target, path.extname(target));

  if (target.toLowerCase().endsWith('.lnk')) {
    if (!fs.existsSync(target)) return { error: `No existe: ${target}` };
    const resolved = await resolveShortcutTarget(target);
    if (!resolved) return { error: 'No se ha podido leer ese acceso directo.' };
    target = resolved;
  }

  if (!target.toLowerCase().endsWith('.exe')) {
    return { error: 'Sólo se pueden añadir programas (.exe) o accesos directos (.lnk).' };
  }
  if (!fs.existsSync(target)) return { error: `No existe: ${target}` };

  let icon = '';
  try {
    icon = (await app.getFileIcon(target, { size: 'large' })).toDataURL();
  } catch (err) {
    console.log('[appScanner] getFileIcon fallo para', target, ':', err.message);
  }
  return { app: { name, execPath: target, icon } };
}

async function scanApps() {
  const dirs = getStartMenuDirs();
  console.log('[scanApps] directorios:', dirs);

  console.time('[scanApps] powershell');
  const shortcuts = await resolveShortcutsViaPowerShell(dirs);
  console.timeEnd('[scanApps] powershell');

  // Filtramos y deduplicamos primero (sincrono, instantaneo), y despues
  // pedimos todos los iconos en paralelo en vez de uno a uno: cada peticion
  // es una llamada nativa independiente, así que hacerlas en serie
  // desperdiciaba varios segundos sin necesidad.
  const seen = new Set();
  const candidates = [];
  for (const s of shortcuts) {
    const target = s.target;
    if (!target || !fs.existsSync(target)) continue;
    if (!target.toLowerCase().endsWith('.exe')) continue;
    if (target.toLowerCase().includes('\\windowsapps\\')) continue;

    const name = path.basename(s.path, '.lnk');
    if (/uninstall|read ?me|help|website|documentation/i.test(name)) continue;

    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({ name, execPath: target, args: s.args || '' });
  }

  console.time('[scanApps] iconos');
  const apps = await Promise.all(
    candidates.map(async (c) => {
      let icon = '';
      try {
        const img = await app.getFileIcon(c.execPath, { size: 'large' });
        icon = img.toDataURL();
      } catch (err) {
        console.log('[scanApps] getFileIcon fallo para', c.execPath, ':', err.message);
      }
      return { ...c, icon };
    })
  );
  console.timeEnd('[scanApps] iconos');

  apps.sort((a, b) => a.name.localeCompare(b.name));
  console.log('[scanApps] terminado, total apps validas:', apps.length);
  return apps;
}

module.exports = { scanApps, appFromPath };
