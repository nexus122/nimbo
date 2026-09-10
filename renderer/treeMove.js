// La aritmetica de mover un item dentro del arbol de la rueda. Vive fuera de
// settings.js, y sin tocar el DOM, por el mismo motivo que config.js: asi
// test_treemove.js la prueba con node a secas. settings.js lo carga con un
// <script> antes que a si mismo, asi que aqui son funciones globales.

// Una carpeta no puede acabar dentro de si misma (ni de una descendiente):
// el arbol quedaria en ciclo y dibujar la rueda no terminaria nunca.
function containsList(item, list) {
  if (item.type !== 'folder' || !Array.isArray(item.items)) return false;
  return item.items === list || item.items.some((child) => containsList(child, list));
}

// Mueve src[srcIdx] junto a destItem. `zone` es 'before' | 'after' (hermano
// dentro de `dest`), 'inside' (dentro de destItem, que ha de ser carpeta) o
// 'end' (al final de `dest`, sin destItem: mover a otra rueda entera).
// Devuelve un mensaje de error si no se puede, o null habiendolo aplicado.
function moveTreeItem(src, srcIdx, dest, destItem, zone, max) {
  const item = src[srcIdx];
  if (item === destItem) return null; // soltado sobre si mismo: no es un error
  const target = zone === 'inside' ? destItem.items : dest;
  if (containsList(item, target)) return 'Una carpeta no puede ir dentro de sí misma.';
  if (target !== src && target.length >= max) return `Ese nivel ya tiene el máximo de ${max} elementos.`;

  src.splice(srcIdx, 1);
  // El indice del destino se calcula DESPUES de sacar el item: si venia del
  // mismo nivel y estaba delante, todo lo de detras se ha corrido un puesto.
  const at =
    zone === 'before' || zone === 'after'
      ? target.indexOf(destItem) + (zone === 'after' ? 1 : 0)
      : target.length;
  target.splice(at, 0, item);
  return null;
}

if (typeof module !== 'undefined') module.exports = { moveTreeItem, containsList };
