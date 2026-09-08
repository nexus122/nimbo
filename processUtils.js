const { execFileSync, execFile } = require('child_process');
const util = require('util');
const path = require('path');

const execFileAsync = util.promisify(execFile);

// Devuelve los procesos vivos cuyo .exe coincide con execPath, indicando si
// tienen una ventana principal visible (MainWindowHandle != 0). Lo usamos
// para decidir si un cierre puede ser forzado sin riesgo (apps de bandeja
// tipo NVDA, sin documentos que perder) o si debe ser un cierre normal
// (apps con ventana, que pueden tener cambios sin guardar).
//
// Asincrona (execFile, no execFileSync): esto se llama en cada lanzamiento
// desde el proceso principal, y un PowerShell sincrono congelaba la interfaz
// 200-500ms cada vez.
async function findRunningProcesses(execPath) {
  const escaped = execPath.replace(/'/g, "''");
  // Comprobado en esta maquina: Get-Process no lanza excepcion con procesos
  // protegidos (SYSTEM, o de otro usuario elevado), simplemente $_.Path sale
  // vacio/nulo en silencio, asi que el filtro por ruta exacta nunca los
  // encuentra. Ademas de filtrar por ruta, guardamos aparte cualquier proceso
  // cuyo NOMBRE coincida pero cuya ruta no se haya podido leer, para poder
  // avisar en vez de fallar mudo (ver aviso mas abajo).
  const baseName = path.basename(execPath, path.extname(execPath)).replace(/'/g, "''");
  const script = `
$target = '${escaped}'
$baseName = '${baseName}'
Get-Process | ForEach-Object {
  $p = $null
  try { $p = $_.Path } catch {}
  if ($p -and $p -eq $target) {
    "MATCH,$($_.Id),$([int]$_.MainWindowHandle)"
  } elseif (-not $p -and $_.ProcessName -eq $baseName) {
    "BLIND,$($_.Id)"
  }
}
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  let out;
  try {
    const result = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { encoding: 'utf8' }
    );
    out = result.stdout;
  } catch (err) {
    console.error('[processUtils] fallo al listar procesos:', err.message);
    return [];
  }

  const matches = [];
  const blind = [];
  out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split(',');
      if (parts[0] === 'MATCH') {
        matches.push({ pid: Number(parts[1]), hasWindow: Number(parts[2]) !== 0 });
      } else if (parts[0] === 'BLIND') {
        blind.push(parts[1]);
      }
    });

  if (blind.length > 0) {
    // Get-Process y Get-CimInstance (probados a mano) fallan igual desde una
    // sesion sin elevar: ninguno de los dos puede leer la ruta de un proceso
    // que corre como administrador u otro usuario, asi que "cerrar si ya
    // esta abierto" no puede confirmarlos ni cerrarlos. No hay arreglo real
    // sin elevar Opie entero, pero al menos que se sepa por que en vez de
    // que el reintento parezca no hacer nada.
    console.warn(
      `[processUtils] ${blind.length} proceso(s) con nombre "${baseName}" pero ruta no legible (PIDs ${blind.join(', ')}); probablemente corren elevados y no se pueden confirmar ni cerrar desde aqui.`
    );
  }

  return matches.filter((p) => Number.isFinite(p.pid));
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

// Parte una cadena de argumentos al estilo Windows (las mismas reglas que
// CommandLineToArgvW): los espacios separan salvo dentro de comillas, y las
// barras invertidas solo son especiales cuando preceden a una comilla (2n
// barras + comilla = n barras literales y la comilla actua de delimitador;
// 2n+1 barras + comilla = n barras literales y una comilla literal). Sin
// esto un argumento como --perfil "C:\ruta con espacios" se partiria mal.
function parseWindowsArgs(str) {
  const s = String(str || '');
  const args = [];
  let current = '';
  let hasArg = false;
  let inQuotes = false;
  let i = 0;

  while (i < s.length) {
    const c = s[i];

    if (c === '\\') {
      let count = 0;
      while (s[i] === '\\') {
        count++;
        i++;
      }
      if (s[i] === '"') {
        current += '\\'.repeat(Math.floor(count / 2));
        hasArg = true;
        if (count % 2 === 1) {
          current += '"'; // barra impar: comilla literal, no delimita
        } else {
          inQuotes = !inQuotes; // barras pares: la comilla si delimita
        }
        i++;
      } else {
        current += '\\'.repeat(count);
        if (count > 0) hasArg = true;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = !inQuotes;
      hasArg = true;
      i++;
      continue;
    }

    if (/\s/.test(c) && !inQuotes) {
      if (hasArg) {
        args.push(current);
        current = '';
        hasArg = false;
      }
      i++;
      continue;
    }

    current += c;
    hasArg = true;
    i++;
  }

  if (hasArg) args.push(current);
  return args;
}

module.exports = { findRunningProcesses, closeProcesses, parseWindowsArgs };
