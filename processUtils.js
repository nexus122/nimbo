const { execFileSync, execFile } = require('child_process');
const util = require('util');
const path = require('path');

const execFileAsync = util.promisify(execFile);

// Devuelve { running, mismatched }:
//
//  - running: procesos sobre los que se puede actuar, con si tienen ventana
//    principal (MainWindowHandle != 0). Sirve para decidir si el cierre puede
//    ser forzado sin riesgo (apps de bandeja tipo NVDA, sin documentos que
//    perder) o debe ser normal (apps con ventana y cambios sin guardar).
//  - mismatched: procesos con el MISMO nombre pero otra ruta. Tambien se
//    cierran (en la practica es el mismo programa movido de sitio o
//    actualizado a otra carpeta), pero van aparte para poder avisar: en teoria
//    podria ser otro programa que se llame igual, y ademas el elemento se ha
//    quedado apuntando a una ruta que ya no sirve.
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
  // Las rutas se comparan normalizadas: un acceso directo puede guardar el
  // nombre corto ("C:\PROGRA~2\NVDA\nvda.exe") y Get-Process devuelve siempre
  // el largo, asi que con -eq a secas eran distintas y el programa parecia no
  // estar abierto. Get-Item resuelve el corto al largo (comprobado); el resto
  // de la comparacion sigue siendo exacta, sin adivinar por nombre.
  const script = `
$target = '${escaped}'
$baseName = '${baseName}'
try { $target = (Get-Item -LiteralPath $target -ErrorAction Stop).FullName } catch {}
Get-Process | ForEach-Object {
  $p = $null
  try { $p = $_.Path } catch {}
  $win = [int]$_.MainWindowHandle
  if ($p -and $p -eq $target) {
    "MATCH,$($_.Id),$win"
  } elseif ($_.ProcessName -eq $baseName) {
    if (-not $p) {
      "BLIND,$($_.Id),$win"
    } else {
      # Mismo nombre y otra ruta: normalizamos tambien la suya (solo para los
      # pocos que se llaman igual, que hacerlo con todos serian 200 accesos a
      # disco) antes de darla por distinta.
      $full = $null
      try { $full = (Get-Item -LiteralPath $p -ErrorAction Stop).FullName } catch {}
      if ($full -and $full -eq $target) { "MATCH,$($_.Id),$win" } else { "OTHER,$($_.Id),$win,$p" }
    }
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
    return { running: [], mismatched: [] };
  }

  const matches = [];
  const blind = [];
  const mismatched = [];
  out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split(',');
      if (parts[0] === 'MATCH') {
        matches.push({ pid: Number(parts[1]), hasWindow: Number(parts[2]) !== 0 });
      } else if (parts[0] === 'BLIND') {
        blind.push({ pid: Number(parts[1]), hasWindow: Number(parts[2]) !== 0, blind: true });
      } else if (parts[0] === 'OTHER') {
        // La ruta puede llevar comas; el resto de la linea es la ruta entera.
        mismatched.push({ pid: Number(parts[1]), hasWindow: Number(parts[2]) !== 0, path: parts.slice(3).join(',') });
      }
    });

  if (blind.length > 0) {
    // Get-Process y Get-CimInstance (probados a mano) fallan igual desde una
    // sesion sin elevar: ninguno de los dos puede leer la ruta de un proceso
    // que corre como administrador u otro usuario, asi que "cerrar si ya
    // esta abierto" no puede confirmarlos ni cerrarlos. No hay arreglo real
    // sin elevar Nimbo entero, pero al menos que se sepa por que en vez de
    // que el reintento parezca no hacer nada.
    console.warn(
      `[processUtils] ${blind.length} proceso(s) con nombre "${baseName}" pero ruta no legible (PIDs ${blind
        .map((p) => p.pid)
        .join(', ')}); probablemente corren elevados. Se intenta cerrarlos igual.`
    );
  }

  if (mismatched.length > 0) {
    console.warn(
      `[processUtils] hay ${mismatched.length} proceso(s) "${baseName}" abiertos desde otra ruta (${mismatched
        .map((p) => p.path)
        .join(', ')}); el elemento apunta a "${execPath}".`
    );
  }

  // Los ciegos van con los buenos, marcados. Antes se descartaban, y quien
  // llama se encontraba con una lista vacia y volvia a LANZAR el programa:
  // pedir "cierralo" y que se abra otra vez es el peor resultado posible.
  // Coincide el nombre del ejecutable, no la ruta, asi que en teoria podria
  // ser otro programa que se llame igual; aun asi es mejor apuesta que
  // relanzar, y el cierre respeta lo mismo que el resto (nunca forzado si
  // tiene ventana).
  return {
    running: [...matches, ...blind].filter((p) => Number.isFinite(p.pid)),
    mismatched: mismatched.filter((p) => Number.isFinite(p.pid)),
  };
}

// Devuelve false si taskkill no acepto el cierre: puede ser que el proceso ya
// no existiera (inofensivo) o que no tengamos permiso (un proceso elevado), y
// eso segundo si merece contarselo a quien lo pidio.
function closeProcesses(pids, force) {
  if (!pids.length) return true;
  const args = force ? ['/F'] : [];
  pids.forEach((pid) => args.push('/PID', String(pid)));
  try {
    execFileSync('taskkill.exe', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
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
