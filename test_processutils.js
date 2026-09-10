// Check de parseWindowsArgs() (partir una cadena de argumentos al estilo
// Windows) y humo de findRunningProcesses(). `node test_processutils.js`
const assert = require('assert');
const { parseWindowsArgs, findRunningProcesses } = require('./processUtils');

// el caso de la tarea: comillas para proteger espacios, args sueltos alrededor
assert.deepStrictEqual(
  parseWindowsArgs('--perfil "C:\\ruta con espacios" -x'),
  ['--perfil', 'C:\\ruta con espacios', '-x']
);

// sin argumentos
assert.deepStrictEqual(parseWindowsArgs(''), []);
assert.deepStrictEqual(parseWindowsArgs('   '), []);

// varios argumentos simples separados por espacios
assert.deepStrictEqual(parseWindowsArgs('--foo --bar baz'), ['--foo', '--bar', 'baz']);

// comilla vacia = argumento vacio valido (p.ej. --title "")
assert.deepStrictEqual(parseWindowsArgs('--title ""'), ['--title', '']);

// comilla escapada con barra impar dentro de comillas: barra + comilla
// literal, sin cerrar las comillas (regla de CommandLineToArgvW)
assert.deepStrictEqual(parseWindowsArgs('"foo\\"bar"'), ['foo"bar']);

// barras dobles antes de comilla: se quedan como barras literales y la
// comilla si delimita (no se escapa)
assert.deepStrictEqual(parseWindowsArgs('"C:\\\\" --flag'), ['C:\\', '--flag']);

// barras que no preceden a una comilla nunca son especiales
assert.deepStrictEqual(parseWindowsArgs('C:\\Users\\juan\\app.exe'), ['C:\\Users\\juan\\app.exe']);

(async () => {
  // humo: una ruta que no existe como proceso no debe explotar, solo dar []
  const result = await findRunningProcesses('C:\\ruta\\que\\no\\existe\\nada.exe');
  assert.deepStrictEqual(result, { running: [], mismatched: [] });

  // El propio node si esta corriendo: debe encontrarse a si mismo y traer la
  // forma que espera main.js para decidir como cerrar cada proceso.
  const self = await findRunningProcesses(process.execPath);
  assert.ok(self.running.length > 0, 'deberia encontrar el proceso de node en marcha');
  self.running.forEach((p) => {
    assert.ok(Number.isFinite(p.pid), 'cada proceso trae su pid');
    assert.strictEqual(typeof p.hasWindow, 'boolean', 'cada proceso dice si tiene ventana');
  });

  // El mismo ejecutable escrito en formato corto (8.3) tiene que encontrarse
  // igual: es el caso que dejaba "cerrar si abierto" sin efecto, porque un
  // acceso directo puede guardar la ruta asi y Get-Process la da larga.
  const short = process.execPath.replace(/\\Program Files\\/i, '\\PROGRA~1\\');
  if (short !== process.execPath) {
    const viaShort = await findRunningProcesses(short);
    assert.ok(viaShort.running.length > 0, 'la ruta en formato corto debe encontrar el mismo proceso');
  }

  console.log('ok: parseWindowsArgs y findRunningProcesses (humo)');
})();
