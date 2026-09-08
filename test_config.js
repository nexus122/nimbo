// Check minimo de loadConfig/saveConfig: `node test_config.js`
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, saveConfig } = require('./config');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opie-config-test-'));

// --- fichero inexistente: primera ejecucion, config por defecto ---
const p1 = path.join(dir, 'no-existe.json');
const c1 = loadConfig(p1);
assert.ok(Array.isArray(c1.wheels) && c1.wheels.length === 1);
assert.strictEqual(c1.wheels[0].name, 'Principal');
assert.ok(fs.existsSync(p1), 'debe crear el fichero en la primera ejecucion');

// --- fichero valido: se devuelve tal cual, sin tocarlo ---
const p2 = path.join(dir, 'valido.json');
const valido = { wheels: [{ id: 'w1', name: 'Otra', shortcut: 'Alt+Space', items: [] }], theme: 'dark' };
fs.writeFileSync(p2, JSON.stringify(valido));
const c2 = loadConfig(p2);
assert.deepStrictEqual(c2, valido);

// --- fichero corrupto: NO se pierde, se renombra aparte ---
const p3 = path.join(dir, 'corrupto.json');
fs.writeFileSync(p3, '{ "wheels": [ esto no es JSON');
const before = fs.readdirSync(dir);
const c3 = loadConfig(p3);
assert.ok(Array.isArray(c3.wheels), 'debe arrancar con la config por defecto');
const after = fs.readdirSync(dir);
const nuevos = after.filter((f) => !before.includes(f));
assert.strictEqual(nuevos.length, 1, 'debe aparecer exactamente un fichero nuevo (el respaldo)');
assert.match(nuevos[0], /^corrupto\.corrupto-\d+\.json$/);
assert.strictEqual(
  fs.readFileSync(path.join(dir, nuevos[0]), 'utf-8'),
  '{ "wheels": [ esto no es JSON',
  'el contenido original debe seguir intacto en el respaldo'
);
assert.ok(fs.existsSync(p3), 'debe quedar una config por defecto nueva en la ruta original');

// --- migracion desde el formato viejo (pinned -> wheels) ---
const p4 = path.join(dir, 'legacy.json');
fs.writeFileSync(
  p4,
  JSON.stringify({
    pinned: [{ name: 'Notepad', execPath: 'C:\\notepad.exe', icon: null, toggleClose: false }],
  })
);
const c4 = loadConfig(p4);
assert.strictEqual(c4.wheels.length, 1);
assert.strictEqual(c4.wheels[0].items.length, 1);
assert.strictEqual(c4.wheels[0].items[0].name, 'Notepad');
assert.strictEqual(c4.wheels[0].items[0].execPath, 'C:\\notepad.exe');
assert.strictEqual(c4.wheels[0].items[0].toggleClose, false);

// --- un campo extra (theme) sobrevive a un guardado ---
const p5 = path.join(dir, 'theme.json');
saveConfig(p5, { wheels: [], theme: 'dark' });
const guardado = { ...loadConfig(p5), wheels: [{ id: 'w2', name: 'X', shortcut: '', items: [] }] };
saveConfig(p5, guardado);
const c5 = loadConfig(p5);
assert.strictEqual(c5.theme, 'dark');
assert.strictEqual(c5.wheels[0].name, 'X');

// --- escritura atomica: no debe quedar ningun .tmp suelto ---
assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no deben quedar ficheros .tmp');

fs.rmSync(dir, { recursive: true, force: true });
console.log('ok: config (carga, corrupcion, migracion, guardado)');
