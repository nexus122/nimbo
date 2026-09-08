// Check minimo de la navegacion por teclado de la rueda: `node test_radial.js`
const assert = require('assert');
const { nextIndex, shortestAngle } = require('./renderer/radial.js');

// sin items no hay nada que seleccionar
assert.strictEqual(nextIndex(-1, 1, 0), -1);
assert.strictEqual(nextIndex(-1, -1, 0), -1);

// sin seleccion previa se entra por un extremo u otro segun la direccion
assert.strictEqual(nextIndex(-1, 1, 5), 0);
assert.strictEqual(nextIndex(-1, -1, 5), 4);

// avance y retroceso normales
assert.strictEqual(nextIndex(0, 1, 5), 1);
assert.strictEqual(nextIndex(3, 1, 5), 4);
assert.strictEqual(nextIndex(3, -1, 5), 2);

// el anillo da la vuelta por los dos extremos (aqui es donde un % a secas falla)
assert.strictEqual(nextIndex(4, 1, 5), 0);
assert.strictEqual(nextIndex(0, -1, 5), 4);

// un solo item: cualquier movimiento se queda donde esta
assert.strictEqual(nextIndex(0, 1, 1), 0);
assert.strictEqual(nextIndex(0, -1, 1), 0);

// --- el sector de luz gira siempre por el camino corto ---

// avance normal, sin vuelta
assert.strictEqual(shortestAngle(0, 45), 45);
assert.strictEqual(shortestAngle(45, 0), 0);

// del ultimo item al primero: 315 grados hacia delante son 45 hacia atras,
// que es justo el caso por el que existe esta funcion
assert.strictEqual(shortestAngle(0, 315), -45);
assert.strictEqual(shortestAngle(315, 360), 360);

// el angulo acumulado no se normaliza: tras varias vueltas sigue creciendo,
// y lo que importa es que el salto nunca supere media vuelta
let a = 0;
for (const t of [45, 90, 135, 180, 225, 270, 315, 0, 45]) {
  const next = shortestAngle(a, t);
  assert.ok(Math.abs(next - a) <= 180, `salto demasiado largo: ${a} -> ${next}`);
  assert.strictEqual((((next % 360) + 360) % 360), t % 360);
  a = next;
}
assert.ok(a > 360, 'tras dar la vuelta entera el angulo acumulado debe pasar de 360');

console.log('ok: navegacion de la rueda');
