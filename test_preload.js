// Coherencia entre main.js y los renderers, que node no puede comprobar solo:
// los dos lados hablan por nombres sueltos (canales IPC, constantes repetidas)
// y desincronizarlos no falla al arrancar, falla el dia que alguien pulsa el
// boton. Se cruzan leyendo los ficheros como texto.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const channels = (src, re) => new Set([...src.matchAll(re)].map((m) => m[1]));

const asked = channels(read('preload.js'), /ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g);
const served = channels(read('main.js'), /ipcMain\.(?:handle|on)\(\s*'([^']+)'/g);

// Si un cambio de estilo dejara las expresiones sin encontrar nada, las dos
// listas saldrian vacias y el test pasaria sin comprobar nada.
assert.ok(asked.size >= 10, `solo ${asked.size} canales en preload.js: la expresion ya no casa`);
assert.ok(served.size >= 10, `solo ${served.size} canales en main.js: la expresion ya no casa`);

const missing = [...asked].filter((c) => !served.has(c));
assert.deepStrictEqual(missing, [], `preload.js pide canales que main.js no atiende: ${missing.join(', ')}`);

const dead = [...served].filter((c) => !asked.has(c));
assert.deepStrictEqual(dead, [], `main.js atiende canales que nadie pide desde preload.js: ${dead.join(', ')}`);

// Los tamanos de rueda estan escritos en los dos sitios: main.js valida contra
// su lista y ajustes pinta la suya. Anadir uno solo en ajustes lo dejaria
// elegible pero rechazado, sin ningun aviso.
const sizes = (src) => [...src.matchAll(/\b(\d{3})\b/g)].map((m) => m[1]);
const mainSizes = sizes(/const WHEEL_SIZES = \[([^\]]+)\]/.exec(read('main.js'))[1]);
const uiSizes = sizes(/const WHEEL_SIZES = \[([^\]]+)\]/.exec(read('renderer/settings.js'))[1]);
assert.ok(mainSizes.length >= 2, 'no se ha encontrado WHEEL_SIZES en main.js');
assert.deepStrictEqual(uiSizes, mainSizes, 'WHEEL_SIZES no coincide entre main.js y settings.js');

console.log(`ok: puente preload <-> main (${asked.size} canales, ${mainSizes.length} tamanos)`);
