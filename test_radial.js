// Check minimo de la navegacion por teclado de la rueda: `node test_radial.js`
const assert = require('assert');
const { nextIndex } = require('./renderer/radial.js');

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

console.log('ok: navegacion de la rueda');
