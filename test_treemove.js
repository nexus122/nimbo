const assert = require('assert');
const { moveTreeItem, containsList } = require('./renderer/treeMove');

const MAX = 8;
const names = (list) => list.map((i) => i.name).join(',');

// Arbol de partida: a, F(x, y), b
function tree() {
  return [
    { id: '1', type: 'app', name: 'a' },
    { id: '2', type: 'folder', name: 'F', items: [{ id: '3', type: 'app', name: 'x' }, { id: '4', type: 'app', name: 'y' }] },
    { id: '5', type: 'app', name: 'b' },
  ];
}

// Reordenar hacia abajo en el mismo nivel: el indice del destino se corre al
// sacar el item, y es justo donde mas facil es equivocarse.
let t = tree();
assert.strictEqual(moveTreeItem(t, 0, t, t[2], 'after', MAX), null);
assert.strictEqual(names(t), 'F,b,a');

// Reordenar hacia arriba
t = tree();
assert.strictEqual(moveTreeItem(t, 2, t, t[0], 'before', MAX), null);
assert.strictEqual(names(t), 'b,a,F');

// Meter en una carpeta
t = tree();
assert.strictEqual(moveTreeItem(t, 0, t, t[1], 'inside', MAX), null);
assert.strictEqual(names(t), 'F,b');
assert.strictEqual(names(t[0].items), 'x,y,a');

// Sacar de una carpeta al nivel de arriba
t = tree();
assert.strictEqual(moveTreeItem(t[1].items, 0, t, t[0], 'after', MAX), null);
assert.strictEqual(names(t), 'a,x,F,b');
assert.strictEqual(names(t[2].items), 'y');

// Una carpeta dentro de una descendiente suya se rechaza sin tocar nada
t = tree();
const inner = { id: '6', type: 'folder', name: 'G', items: [] };
t[1].items.push(inner);
assert.match(moveTreeItem(t, 1, t[1].items, inner, 'inside', MAX), /dentro de sí misma/);
assert.match(moveTreeItem(t, 1, t[1].items, inner, 'before', MAX), /dentro de sí misma/);
assert.strictEqual(names(t), 'a,F,b');
assert.strictEqual(names(t[1].items), 'x,y,G');

// El tope solo aplica al cambiar de nivel: reordenar en un nivel lleno vale
t = tree();
assert.match(moveTreeItem(t, 0, t, t[1], 'inside', 2), /máximo/);
assert.strictEqual(names(t), 'a,F,b');
assert.strictEqual(moveTreeItem(t, 0, t, t[2], 'after', 2), null);
assert.strictEqual(names(t), 'F,b,a');

// Soltar sobre uno mismo no es un error, simplemente no hace nada
t = tree();
assert.strictEqual(moveTreeItem(t, 0, t, t[0], 'before', MAX), null);
assert.strictEqual(names(t), 'a,F,b');

// 'end': mover a otra lista entera (a otra rueda), sin item de destino
t = tree();
const otra = [{ id: '9', type: 'app', name: 'z' }];
assert.strictEqual(moveTreeItem(t, 1, otra, null, 'end', MAX), null);
assert.strictEqual(names(t), 'a,b');
assert.strictEqual(names(otra), 'z,F');
assert.match(moveTreeItem(t, 0, otra, null, 'end', 2), /máximo/);
assert.strictEqual(names(t), 'a,b');

// containsList: nietos incluidos
const outer = { type: 'folder', items: [{ type: 'folder', items: [] }] };
assert.strictEqual(containsList(outer, outer.items[0].items), true);
assert.strictEqual(containsList(outer, []), false);
assert.strictEqual(containsList({ type: 'app' }, []), false);

console.log('test_treemove: OK');
