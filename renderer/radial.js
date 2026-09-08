let wheelName = '';
let stack = []; // pila de arrays de items: cada push() es entrar en una carpeta
let slices = []; // los elementos DOM del nivel actual, en el mismo orden que los items
let selected = -1; // indice seleccionado con el teclado; -1 = nada seleccionado

async function init() {
  const wheel = await window.opie.getActiveWheel();
  if (!wheel) {
    renderEmpty();
    return;
  }
  wheelName = wheel.name || '';
  stack = [Array.isArray(wheel.items) ? wheel.items : []];
  renderLevel();
}

function renderEmpty() {
  const wheelEl = document.getElementById('wheel');
  wheelEl.innerHTML = '';
  const ring = document.createElement('div');
  ring.className = 'ring';
  wheelEl.appendChild(ring);

  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.textContent = 'No hay ninguna rueda configurada todavía.';
  wheelEl.appendChild(hint);
}

// Abre un item. Comparten camino el click y el Enter del teclado, para que
// las dos formas de navegar no se puedan desincronizar.
function activate(item) {
  if (item.type === 'folder') {
    stack.push(Array.isArray(item.items) ? item.items : []);
    renderLevel();
  } else if (item.type === 'link') {
    window.opie.openLink(item.url);
  } else {
    window.opie.launchApp(item.execPath, item.toggleClose !== false);
  }
}

function goBack() {
  if (stack.length > 1) {
    stack.pop();
    renderLevel();
  } else {
    window.opie.closeRadial();
  }
}

function select(index) {
  slices.forEach((el, i) => el.classList.toggle('selected', i === index));
  selected = index;
}

// Siguiente indice al moverse por el anillo. Da la vuelta por los extremos
// (es un circulo, no una lista) y si no hay nada seleccionado entra por el
// primero o por el ultimo segun la direccion. Devuelve -1 si no hay items.
function nextIndex(current, step, total) {
  if (total === 0) return -1;
  if (current === -1) return step > 0 ? 0 : total - 1;
  return (((current + step) % total) + total) % total;
}

function move(step) {
  const next = nextIndex(selected, step, slices.length);
  if (next !== -1) select(next);
}

function renderLevel() {
  const wheelEl = document.getElementById('wheel');
  wheelEl.innerHTML = '';
  slices = [];
  selected = -1;

  const ring = document.createElement('div');
  ring.className = 'ring';
  wheelEl.appendChild(ring);

  const items = stack[stack.length - 1];
  const isRoot = stack.length === 1;

  const title = document.createElement('div');
  title.id = 'wheel-title';
  title.textContent = wheelName;
  wheelEl.appendChild(title);

  const center = document.createElement('div');
  center.id = 'center';
  center.textContent = isRoot ? '⚙' : '⬅';
  center.title = isRoot ? 'Configurar' : 'Atrás';
  center.addEventListener('click', () => {
    if (isRoot) {
      window.opie.openSettings();
    } else {
      stack.pop();
      renderLevel();
    }
  });
  wheelEl.appendChild(center);

  const radius = 170;
  const cx = 240;
  const cy = 240;
  const n = items.length;

  items.forEach((item, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);

    const slice = document.createElement('div');
    slice.className = 'slice' + (item.type === 'folder' || item.type === 'link' ? ' folder' : '');
    slice.style.left = `${x}px`;
    slice.style.top = `${y}px`;

    if (item.type === 'folder' || item.type === 'link') {
      const defaultEmoji = item.type === 'folder' ? '📁' : '🔗';
      const isCustomImage = item.icon && item.icon.startsWith('data:');
      const iconEl = document.createElement(isCustomImage ? 'img' : 'div');
      if (!isCustomImage) {
        iconEl.className = 'folder-icon';
        iconEl.textContent = item.icon || defaultEmoji;
      } else {
        iconEl.src = item.icon;
      }
      slice.appendChild(iconEl);
    } else {
      const img = document.createElement('img');
      img.src = item.icon || '';
      slice.appendChild(img);
    }

    slice.addEventListener('click', () => activate(item));
    // El raton manda sobre la seleccion del teclado, para que el resaltado no
    // se quede en un sitio distinto de donde esta el puntero.
    slice.addEventListener('mouseenter', () => select(i));

    const label = document.createElement('div');
    label.className = 'label';
    // El numero de atajo solo tiene sentido hasta el 9.
    label.textContent = i < 9 ? `${i + 1}. ${item.name}` : item.name;
    slice.appendChild(label);

    wheelEl.appendChild(slice);
    slices.push(slice);
  });

  if (n === 0) {
    const hint = document.createElement('div');
    hint.id = 'hint';
    hint.textContent = isRoot ? 'Vacío. Click en ⚙ para añadir programas.' : 'Carpeta vacía.';
    wheelEl.appendChild(hint);
  } else {
    select(0);
  }
}

function onKeydown(e) {
  // Atajos numericos: 1-9 abren directamente ese item. Es la via mas rapida y
  // por eso el numero va escrito en la etiqueta.
  if (e.key >= '1' && e.key <= '9') {
    const items = stack[stack.length - 1] || [];
    const i = Number(e.key) - 1;
    if (i < items.length) {
      e.preventDefault();
      select(i);
      activate(items[i]);
    }
    return;
  }

  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault();
      move(1);
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault();
      move(-1);
      break;
    case 'Tab':
      e.preventDefault();
      move(e.shiftKey ? -1 : 1);
      break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      if (selected !== -1) activate(stack[stack.length - 1][selected]);
      break;
    case 'Escape':
    case 'Backspace':
      e.preventDefault();
      goBack();
      break;
  }
}

// En el navegador arrancamos; requerido desde node (test_radial.js) solo
// exponemos las funciones puras, sin tocar el DOM que alli no existe.
if (typeof document === 'undefined') {
  module.exports = { nextIndex };
} else {
  document.addEventListener('keydown', onKeydown);
  init();
}
