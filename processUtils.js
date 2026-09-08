const { execFileSync } = require('child_process');

// Devuelve los procesos vivos cuyo .exe coincide con execPath, indicando si
// tienen una ventana principal visible (MainWindowHandle != 0). Lo usamos
// para decidir si un cierre puede ser forzado sin riesgo (apps de bandeja
// tipo NVDA, sin documentos que perder) o si debe ser un cierre normal
// (apps con ventana, que pueden tener cambios sin guardar).
function findRunningProcesses(execPath) {
  const escaped = execPath.replace(/'/g, "''");
  const script = `
Get-Process | Where-Object { $_.Path -eq '${escaped}' } | ForEach-Object {
  "$($_.Id),$([int]$_.MainWindowHandle)"
}
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  let out;
  try {
    out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { encoding: 'utf8' }
    );
  } catch {
    return [];
  }
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, handle] = line.split(',');
      return { pid: Number(pid), hasWindow: Number(handle) !== 0 };
    })
    .filter((p) => Number.isFinite(p.pid));
}

function closeProcesses(pids, force) {
  if (!pids.length) return;
  const args = force ? ['/F'] : [];
  pids.forEach((pid) => args.push('/PID', String(pid)));
  try {
    execFileSync('taskkill.exe', args, { stdio: 'ignore' });
  } catch {
    // taskkill devuelve codigo de error si el proceso ya no existe o no
    // acepta el cierre normal; no es un caso que debamos tratar como fallo.
  }
}

module.exports = { findRunningProcesses, closeProcesses };
