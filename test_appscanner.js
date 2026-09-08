// Check de appFromPath(), por donde pasan las tres formas de anadir un
// programa a mano (examinar, pegar ruta, arrastrar). `node test_appscanner.js`
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { appFromPath } = require('./appScanner');

// Fuera de Electron no existe app.getFileIcon, asi que veras un aviso por cada
// ruta valida y el icono saldra vacio. Es justo lo que hace el try/catch de
// appFromPath: el resto de la validacion no depende del icono.

const NOTEPAD = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'notepad.exe');
assert.ok(fs.existsSync(NOTEPAD), 'hace falta notepad.exe para este check');

// El nombre del .lnk lleva apostrofo a proposito: la ruta se interpola dentro
// de una cadena de PowerShell, y si el escapado se rompe este es el caso que
// lo cantaria.
const LNK = path.join(os.tmpdir(), "Prueba d'atajo.lnk");

function makeShortcut(target, lnkPath) {
  const script = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g, "''")}');$s.TargetPath='${target}';$s.Save()`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: 'ignore' });
}

(async () => {
  // rutas que hay que rechazar, cada una por un motivo distinto
  assert.match((await appFromPath('')).error, /vacía/);
  assert.match((await appFromPath('   ')).error, /vacía/);
  assert.match((await appFromPath('C:\Windows\win.ini')).error, /Sólo se pueden añadir/);
  assert.match((await appFromPath('C:\no\existe\cosa.exe')).error, /No existe/);
  assert.match((await appFromPath('C:\no\existe\cosa.lnk')).error, /No existe/);

  // un .exe normal: el nombre sale del fichero, sin extension
  const ok = await appFromPath(NOTEPAD);
  assert.ok(!ok.error, `no deberia fallar: ${ok.error}`);
  assert.strictEqual(ok.app.name, 'notepad');
  assert.strictEqual(ok.app.execPath, NOTEPAD);

  // pegar una ruta suele traer comillas y espacios de propina
  const pasted = await appFromPath(`  "${NOTEPAD}"  `);
  assert.strictEqual(pasted.app.execPath, NOTEPAD);

  // un acceso directo: el destino se resuelve, pero el nombre es el del .lnk
  // (arrastras "Google Chrome", no quieres que se llame "chrome")
  makeShortcut(NOTEPAD, LNK);
  try {
    const viaLnk = await appFromPath(LNK);
    assert.ok(!viaLnk.error, `el .lnk no deberia fallar: ${viaLnk.error}`);
    assert.strictEqual(viaLnk.app.name, "Prueba d'atajo");
    assert.strictEqual(viaLnk.app.execPath.toLowerCase(), NOTEPAD.toLowerCase());
  } finally {
    fs.unlinkSync(LNK);
  }

  console.log('ok: appFromPath (exe, .lnk, comillas y rechazos)');
})();
