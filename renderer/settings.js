// Tope de items por nivel (rueda o carpeta). El anillo tiene 170px de radio y
// cada item ocupa 64px mas su etiqueta: pasando de 8 las etiquetas se pisan.
// No se aplica retroactivamente: una config vieja con mas items se sigue
// mostrando entera, solo se impide anadir mas.
const MAX_ITEMS = 8;

let wheels = [];
let selectedWheelId = null;
let scannedAppsCache = null;
let pickerTargetItems = null;

function newId() {
  return crypto.randomUUID();
}

// Mensaje en la cabecera. `error` lo pinta en rojo y sin autoborrado, para que
// un fallo no desaparezca antes de que al usuario le de tiempo a leerlo.
function setStatus(text, error = false) {
  const status = document.getElementById('status');
  status.textContent = text;
  status.classList.toggle('error', error);
  clearTimeout(setStatus.timer);
  if (!error && text) setStatus.timer = setTimeout(() => setStatus(''), 2500);
}

// window.prompt() no esta soportado en Electron (window.confirm() si), asi
// que usamos un cuadro de dialogo propio para pedir texto al usuario.
function showPrompt(title, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.getElementById('prompt-overlay');
    const input = document.getElementById('prompt-input');
    const titleEl = document.getElementById('prompt-title');
    const okBtn = document.getElementById('prompt-ok');
    const cancelBtn = document.getElementById('prompt-cancel');

    titleEl.textContent = title;
    input.value = defaultValue;
    overlay.hidden = false;
    input.focus();
    input.select();

    function cleanup() {
      overlay.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
    }
    function onOk() {
      const value = input.value.trim();
      cleanup();
      resolve(value || null);
    }
    function onCancel() {
      cleanup();
      resolve(null);
    }
    function onKeydown(e) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });
}

// El panel de emojis de Windows (Win+.) no es fiable dentro de Electron en
// modo desarrollo, asi que ofrecemos una rejilla propia con emojis comunes
// ademas del campo de texto libre (para pegar cualquier otro).
const EMOJI_CHOICES = [
  '📁', '🗂️', '🎮', '🎵', '🎨', '📷',
  '💼', '🛠️', '🌐', '💬', '📊', '🔒',
  '⚙️', '🏠', '📚', '🎯', '🧩', '🛒',
  '📝', '🔥', '⭐', '❤️', '🎬', '🏆',
  '🚀', '💡', '🔗', '📅', '🖥️', '📱',
];

function populateEmojiGrid() {
  const grid = document.getElementById('iconpicker-emoji-grid');
  if (grid.childElementCount > 0) return; // solo una vez
  EMOJI_CHOICES.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = emoji;
    btn.dataset.emoji = emoji;
    grid.appendChild(btn);
  });
}

// Resuelve a: un string (emoji elegido/escrito o data-URL de imagen elegida),
// 'reset' (volver al icono por defecto del tipo), o null (cancelado).
function showIconPicker() {
  populateEmojiGrid();
  return new Promise((resolve) => {
    const overlay = document.getElementById('iconpicker-overlay');
    const grid = document.getElementById('iconpicker-emoji-grid');
    const emojiInput = document.getElementById('iconpicker-emoji-input');
    const emojiOk = document.getElementById('iconpicker-emoji-ok');
    const imageBtn = document.getElementById('iconpicker-image-btn');
    const resetBtn = document.getElementById('iconpicker-reset-btn');
    const cancelBtn = document.getElementById('iconpicker-cancel');

    emojiInput.value = '';
    overlay.hidden = false;
    emojiInput.focus();

    function cleanup() {
      overlay.hidden = true;
      grid.removeEventListener('click', onGridClick);
      emojiOk.removeEventListener('click', onEmojiOk);
      imageBtn.removeEventListener('click', onImage);
      resetBtn.removeEventListener('click', onReset);
      cancelBtn.removeEventListener('click', onCancel);
      emojiInput.removeEventListener('keydown', onKeydown);
    }
    function onGridClick(e) {
      const btn = e.target.closest('button[data-emoji]');
      if (!btn) return;
      const emoji = btn.dataset.emoji;
      cleanup();
      resolve(emoji);
    }
    function onEmojiOk() {
      const value = emojiInput.value.trim();
      cleanup();
      resolve(value || null);
    }
    async function onImage() {
      const dataUrl = await window.opie.pickIconFile();
      cleanup();
      resolve(dataUrl || null);
    }
    function onReset() {
      cleanup();
      resolve('reset');
    }
    function onCancel() {
      cleanup();
      resolve(null);
    }
    function onKeydown(e) {
      if (e.key === 'Enter') onEmojiOk();
      if (e.key === 'Escape') onCancel();
    }

    grid.addEventListener('click', onGridClick);
    emojiOk.addEventListener('click', onEmojiOk);
    imageBtn.addEventListener('click', onImage);
    resetBtn.addEventListener('click', onReset);
    cancelBtn.addEventListener('click', onCancel);
    emojiInput.addEventListener('keydown', onKeydown);
  });
}

const THEMES = [
  { id: 'auto', name: 'Automático', hint: 'según Windows' },
  { id: 'grafito', name: 'Grafito' },
  { id: 'papel', name: 'Papel' },
  { id: 'malva', name: 'Malva' },
];

// El tema se guarda al momento, como el arranque con Windows: es una
// preferencia, no parte de la configuracion de las ruedas, asi que no tiene
// sentido que espere al boton de Guardar.
function renderThemes(current) {
  const list = document.getElementById('theme-list');
  list.innerHTML = '';
  THEMES.forEach((theme) => {
    const btn = document.createElement('button');
    btn.className = 'theme-item' + (theme.id === current ? ' selected' : '');

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.dataset.theme = theme.id;
    btn.appendChild(swatch);

    btn.appendChild(document.createTextNode(theme.name));
    if (theme.hint) {
      const hint = document.createElement('span');
      hint.className = 'theme-hint';
      hint.textContent = theme.hint;
      btn.appendChild(hint);
    }

    btn.addEventListener('click', async () => {
      document.documentElement.dataset.theme = theme.id;
      await window.opie.setTheme(theme.id);
      renderThemes(theme.id);
    });
    list.appendChild(btn);
  });
}

async function init() {
  const theme = await window.opie.getTheme();
  document.documentElement.dataset.theme = theme;
  renderThemes(theme);

  wheels = await window.opie.getWheelsConfig();
  if (!wheels || wheels.length === 0) {
    wheels = [{ id: newId(), name: 'Principal', shortcut: 'Control+Shift+Space', items: [] }];
  }
  selectedWheelId = wheels[0].id;
  renderAll();

  const autostartCb = document.getElementById('autostart-checkbox');
  autostartCb.checked = await window.opie.getAutostart();
  autostartCb.addEventListener('change', () => window.opie.setAutostart(autostartCb.checked));
}

function renderAll() {
  renderSidebar();
  const wheel = wheels.find((w) => w.id === selectedWheelId);
  const main = document.getElementById('main');
  main.innerHTML = '';
  if (wheel) {
    renderWheelEditor(wheel, main);
  } else {
    const p = document.createElement('p');
    p.id = 'empty-hint';
    p.textContent = 'Crea una rueda para empezar.';
    main.appendChild(p);
  }
}

function renderSidebar() {
  const list = document.getElementById('wheel-list');
  list.innerHTML = '';
  wheels.forEach((w) => {
    const row = document.createElement('div');
    row.className = 'wheel-item' + (w.id === selectedWheelId ? ' selected' : '');

    const name = document.createElement('div');
    name.className = 'wheel-item-name';
    name.textContent = w.name;
    row.appendChild(name);

    const sc = document.createElement('div');
    sc.className = 'wheel-item-shortcut';
    sc.textContent = w.shortcut || 'sin atajo asignado';
    row.appendChild(sc);

    row.addEventListener('click', () => {
      selectedWheelId = w.id;
      renderAll();
    });
    list.appendChild(row);
  });
}

function renderWheelEditor(wheel, main) {
  const nameRow = document.createElement('div');
  nameRow.className = 'editor-row';

  const nameInput = document.createElement('input');
  nameInput.className = 'wheel-name-input';
  nameInput.value = wheel.name;
  nameInput.addEventListener('input', () => {
    wheel.name = nameInput.value;
    renderSidebar();
  });
  nameRow.appendChild(nameInput);

  const delWheelBtn = document.createElement('button');
  delWheelBtn.className = 'danger-btn';
  delWheelBtn.textContent = 'Eliminar rueda';
  delWheelBtn.addEventListener('click', () => {
    if (!confirm(`¿Eliminar la rueda "${wheel.name}"?`)) return;
    wheels = wheels.filter((w) => w.id !== wheel.id);
    selectedWheelId = wheels.length > 0 ? wheels[0].id : null;
    renderAll();
  });
  nameRow.appendChild(delWheelBtn);
  main.appendChild(nameRow);

  const shortcutRow = document.createElement('div');
  shortcutRow.className = 'editor-row';

  const shortcutLabel = document.createElement('span');
  shortcutLabel.textContent = 'Atajo de teclado:';
  shortcutLabel.style.fontSize = '12px';
  shortcutLabel.style.color = '#aaa';
  shortcutRow.appendChild(shortcutLabel);

  const shortcutBtn = document.createElement('button');
  shortcutBtn.className = 'shortcut-btn';
  shortcutBtn.textContent = wheel.shortcut || '(sin asignar) — click para asignar';
  shortcutBtn.addEventListener('click', () => startCapture(wheel, shortcutBtn));
  shortcutRow.appendChild(shortcutBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'small-btn';
  clearBtn.textContent = 'Quitar atajo';
  clearBtn.addEventListener('click', () => {
    wheel.shortcut = '';
    shortcutBtn.textContent = '(sin asignar) — click para asignar';
    renderSidebar();
  });
  shortcutRow.appendChild(clearBtn);

  main.appendChild(shortcutRow);

  const treeRoot = document.createElement('div');
  treeRoot.id = 'tree-root';
  main.appendChild(treeRoot);
  renderTree(wheel.items, treeRoot, 0);

  const rootActions = makeActionsRow(wheel.items);
  treeRoot.appendChild(rootActions);
}

function renderTree(items, container, depth) {
  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.marginLeft = `${depth * 18}px`;

    if (item.type === 'app') {
      const img = document.createElement('img');
      img.className = 'tree-icon';
      img.src = item.icon || '';
      row.appendChild(img);
    } else {
      // Carpeta o enlace: icono por defecto (emoji) o personalizado (otro
      // emoji o una imagen). Click en el icono para cambiarlo.
      const defaultEmoji = item.type === 'folder' ? '📁' : '🔗';
      const isCustomImage = item.icon && item.icon.startsWith('data:');
      const iconEl = document.createElement(isCustomImage ? 'img' : 'span');
      iconEl.className = isCustomImage ? 'tree-icon' : 'tree-folder-icon';
      if (isCustomImage) iconEl.src = item.icon;
      else iconEl.textContent = item.icon || defaultEmoji;
      iconEl.style.cursor = 'pointer';
      iconEl.title = 'Cambiar icono';
      iconEl.addEventListener('click', async (e) => {
        e.stopPropagation();
        const result = await showIconPicker();
        if (!result) return;
        item.icon = result === 'reset' ? null : result;
        renderAll();
      });
      row.appendChild(iconEl);
    }

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = item.name;
    row.appendChild(name);

    if (item.type === 'link') {
      const urlSpan = document.createElement('span');
      urlSpan.style.cssText = 'font-size:10.5px; color:#888; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
      urlSpan.textContent = item.url;
      row.appendChild(urlSpan);
    }

    if (item.type === 'app') {
      const label = document.createElement('label');
      label.className = 'tree-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.toggleClose !== false;
      cb.addEventListener('change', () => {
        item.toggleClose = cb.checked;
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode('Cerrar si abierto'));
      row.appendChild(label);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'tree-del';
    delBtn.textContent = '🗑';
    delBtn.title = 'Quitar';
    delBtn.addEventListener('click', () => {
      if (item.type === 'folder' && item.items && item.items.length > 0) {
        if (!confirm(`"${item.name}" tiene ${item.items.length} elemento(s) dentro. ¿Eliminar de todos modos?`)) return;
      }
      items.splice(idx, 1);
      renderAll();
    });
    row.appendChild(delBtn);

    container.appendChild(row);

    if (item.type === 'folder') {
      if (!Array.isArray(item.items)) item.items = [];
      const sub = document.createElement('div');
      container.appendChild(sub);
      renderTree(item.items, sub, depth + 1);

      const actions = makeActionsRow(item.items);
      actions.style.marginLeft = `${(depth + 1) * 18}px`;
      container.appendChild(actions);
    }
  });
}

// Todos los "+ Anadir" pasan por aqui, asi el tope se aplica en un solo sitio.
function makeActionsRow(targetItems) {
  const actions = document.createElement('div');
  actions.className = 'tree-actions';
  actions.appendChild(makeAddAppButton(targetItems));
  actions.appendChild(makeAddLinkButton(targetItems));
  actions.appendChild(makeAddFolderButton(targetItems));

  const count = document.createElement('span');
  count.className = 'items-count' + (targetItems.length >= MAX_ITEMS ? ' full' : '');
  count.textContent = `${targetItems.length}/${MAX_ITEMS}`;
  actions.appendChild(count);
  return actions;
}

function makeAddButton(targetItems, label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'small-btn';
  btn.textContent = label;
  if (targetItems.length >= MAX_ITEMS) {
    btn.disabled = true;
    btn.title = `Máximo ${MAX_ITEMS} elementos por nivel. Quita alguno o usa una carpeta.`;
  } else {
    btn.addEventListener('click', onClick);
  }
  return btn;
}

function makeAddAppButton(targetItems) {
  return makeAddButton(targetItems, '+ Añadir programa', () => openPicker(targetItems));
}

function makeAddLinkButton(targetItems) {
  return makeAddButton(targetItems, '+ Añadir enlace', async () => {
    const name = await showPrompt('Nombre del enlace:');
    if (!name) return;
    let url = await showPrompt('URL:', 'https://');
    if (!url || url === 'https://') return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    targetItems.push({ id: newId(), type: 'link', name, url });
    renderAll();
  });
}

function makeAddFolderButton(targetItems) {
  return makeAddButton(targetItems, '+ Añadir carpeta', async () => {
    const name = await showPrompt('Nombre de la carpeta:');
    if (!name) return;
    targetItems.push({ id: newId(), type: 'folder', name, items: [] });
    renderAll();
  });
}

// --- Captura de atajo de teclado ---

function eventToAccelerator(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');

  const key = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(key)) return null;

  let keyName;
  if (key === ' ') keyName = 'Space';
  else if (key.length === 1) keyName = key.toUpperCase();
  else {
    const map = {
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Escape: 'Escape',
      Enter: 'Return',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Tab: 'Tab',
    };
    keyName = map[key] || key;
  }

  if (parts.length === 0) return null; // exige al menos un modificador
  parts.push(keyName);
  return parts.join('+');
}

// Un atajo puede estar mal de dos formas distintas y solo una la sabemos sin
// preguntar a Windows: que lo use otra rueda nuestra. Para lo demas (que lo
// tenga cogido otra aplicacion) no hay API de consulta, asi que el proceso
// principal lo comprueba intentando registrarlo de verdad.
async function shortcutProblem(wheel, accel) {
  const clash = wheels.find((w) => w.id !== wheel.id && w.shortcut === accel);
  if (clash) return `"${accel}" ya lo usa la rueda "${clash.name}".`;
  const free = await window.opie.checkShortcut(accel);
  if (!free) return `"${accel}" está ocupado por otra aplicación (o Windows no lo permite).`;
  return null;
}

function startCapture(wheel, btn) {
  btn.textContent = 'Pulsa una combinación... (Esc cancela)';
  btn.classList.add('capturing');

  const handler = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      cleanup();
      btn.textContent = wheel.shortcut || '(sin asignar) — click para asignar';
      return;
    }
    const accel = eventToAccelerator(e);
    if (!accel) return; // solo se pulsaron modificadores, sigue esperando
    cleanup();

    btn.textContent = `Comprobando ${accel}...`;
    const problem = accel === wheel.shortcut ? null : await shortcutProblem(wheel, accel);
    if (problem) {
      btn.textContent = wheel.shortcut || '(sin asignar) — click para asignar';
      setStatus(problem, true);
      return;
    }

    wheel.shortcut = accel;
    btn.textContent = accel;
    setStatus('');
    renderSidebar();
  };

  function cleanup() {
    btn.classList.remove('capturing');
    window.removeEventListener('keydown', handler, true);
  }

  window.addEventListener('keydown', handler, true);
}

// --- Picker de programas (escaneo perezoso) ---

// Abrir el picker ya no dispara el escaneo: recorrer todo el menu Inicio
// tarda varios segundos y casi nunca hace falta, porque normalmente ya sabes
// que programa quieres. El escaneo es ahora una opcion mas, bajo peticion.
function openPicker(targetItems) {
  pickerTargetItems = targetItems;
  document.getElementById('picker-overlay').hidden = false;
  document.getElementById('picker-note').textContent = '';
  const searchInput = document.getElementById('picker-search');
  searchInput.value = '';
  searchInput.disabled = !scannedAppsCache;

  if (scannedAppsCache) {
    document.getElementById('picker-empty').hidden = true;
    renderPickerList('');
    searchInput.focus();
  } else {
    document.getElementById('picker-empty').hidden = false;
    document.getElementById('picker-list').innerHTML = '';
  }
}

async function runScan() {
  const listEl = document.getElementById('picker-list');
  document.getElementById('picker-empty').hidden = true;
  if (scannedAppsCache) {
    // Ya escaneado en esta sesion: no repetimos los segundos de espera. Para
    // ver programas instalados despues, se reabre la ventana de ajustes.
    renderPickerList(document.getElementById('picker-search').value);
    return;
  }
  listEl.textContent = 'Escaneando programas instalados...';
  try {
    scannedAppsCache = await window.opie.scanApps();
  } catch (err) {
    listEl.textContent = 'No se pudo escanear los programas instalados.';
    console.error(err);
    return;
  }
  const searchInput = document.getElementById('picker-search');
  searchInput.disabled = false;
  renderPickerList('');
  searchInput.focus();
}

// Anade un programa ya resuelto por el proceso principal. Devuelve true si
// ha entrado. Es el punto comun de examinar / pegar / arrastrar.
function addResolvedApp(targetItems, result) {
  if (!result) return false; // el usuario ha cancelado el dialogo
  if (result.error) {
    setStatus(result.error, true);
    return false;
  }
  if (targetItems.length >= MAX_ITEMS) {
    setStatus(`Este nivel ya tiene el máximo de ${MAX_ITEMS} elementos.`, true);
    return false;
  }
  if (targetItems.some((it) => it.type === 'app' && it.execPath === result.app.execPath)) {
    setStatus(`"${result.app.name}" ya está en este nivel.`, true);
    return false;
  }
  targetItems.push({ id: newId(), type: 'app', ...result.app, toggleClose: true });
  renderAll();
  setStatus(`Añadido "${result.app.name}".`);
  return true;
}

function renderPickerList(filter) {
  if (!scannedAppsCache) return; // el escaneo aun no ha terminado
  const listEl = document.getElementById('picker-list');
  listEl.innerHTML = '';
  const f = filter.trim().toLowerCase();
  const filtered = scannedAppsCache.filter((a) => a.name.toLowerCase().includes(f));

  if (filtered.length === 0) {
    listEl.textContent = 'Sin resultados.';
    return;
  }

  filtered.forEach((a) => {
    const already = pickerTargetItems.some((it) => it.type === 'app' && it.execPath === a.execPath);
    const item = document.createElement('div');
    item.className = 'picker-item' + (already ? ' added' : '');

    const img = document.createElement('img');
    img.src = a.icon || '';
    item.appendChild(img);

    const span = document.createElement('span');
    span.textContent = a.name + (already ? ' ✓' : '');
    item.appendChild(span);

    item.addEventListener('click', () => {
      if (already) {
        const idx = pickerTargetItems.findIndex((it) => it.type === 'app' && it.execPath === a.execPath);
        if (idx !== -1) pickerTargetItems.splice(idx, 1);
      } else {
        if (pickerTargetItems.length >= MAX_ITEMS) {
          document.getElementById('picker-note').textContent =
            `Este nivel ya tiene el máximo de ${MAX_ITEMS} elementos.`;
          return;
        }
        pickerTargetItems.push({
          id: newId(),
          type: 'app',
          name: a.name,
          execPath: a.execPath,
          icon: a.icon,
          toggleClose: true,
        });
      }
      renderPickerList(document.getElementById('picker-search').value);
      renderAll();
    });

    listEl.appendChild(item);
  });
}

document.getElementById('picker-scan').addEventListener('click', runScan);

document.getElementById('picker-browse').addEventListener('click', async () => {
  const result = await window.opie.pickAppFile();
  if (addResolvedApp(pickerTargetItems, result)) {
    document.getElementById('picker-overlay').hidden = true;
  }
});

document.getElementById('picker-paste').addEventListener('click', async () => {
  const raw = await showPrompt('Pega la ruta del programa (.exe o .lnk):');
  if (!raw) return;
  const result = await window.opie.appFromPath(raw);
  if (addResolvedApp(pickerTargetItems, result)) {
    document.getElementById('picker-overlay').hidden = true;
  }
});

document.getElementById('picker-search').addEventListener('input', (e) => renderPickerList(e.target.value));
document.getElementById('picker-close').addEventListener('click', () => {
  document.getElementById('picker-overlay').hidden = true;
});
document.getElementById('picker-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'picker-overlay') document.getElementById('picker-overlay').hidden = true;
});

// --- Añadir rueda / Guardar ---

document.getElementById('add-wheel').addEventListener('click', async () => {
  const name = await showPrompt('Nombre de la nueva rueda:', 'Nueva rueda');
  if (!name) return;
  const w = { id: newId(), name, shortcut: '', items: [] };
  wheels.push(w);
  selectedWheelId = w.id;
  renderAll();
});

document.getElementById('save').addEventListener('click', async () => {
  // Los duplicados los sabemos sin salir de aqui, asi que ni guardamos: si lo
  // hicieramos, la segunda rueda con el atajo repetido se quedaria muda.
  const used = new Map();
  for (const w of wheels) {
    if (!w.shortcut) continue;
    if (used.has(w.shortcut)) {
      setStatus(`No guardado: "${w.shortcut}" está repetido en "${used.get(w.shortcut)}" y "${w.name}".`, true);
      return;
    }
    used.set(w.shortcut, w.name);
  }

  const { failed } = await window.opie.saveWheelsConfig(wheels);
  if (failed.length > 0) {
    const list = failed.map((f) => `"${f.shortcut}" (${f.wheel})`).join(', ');
    setStatus(`Guardado, pero estos atajos no se han podido registrar: ${list}`, true);
  } else {
    setStatus('Guardado ✓ (atajos actualizados)');
  }
});

// --- Arrastrar y soltar ---

// Donde cae lo que sueltas: si el selector esta abierto, en el nivel que
// estuvieras editando (puede ser una carpeta); si no, en la raiz de la rueda
// seleccionada. Cualquier otra cosa seria adivinar.
function dropTarget() {
  const pickerOpen = !document.getElementById('picker-overlay').hidden;
  if (pickerOpen && pickerTargetItems) return { items: pickerTargetItems, name: 'este nivel' };
  const wheel = wheels.find((w) => w.id === selectedWheelId);
  return wheel ? { items: wheel.items, name: `la rueda "${wheel.name}"` } : null;
}

const dropOverlay = document.getElementById('drop-overlay');
// dragenter y dragleave saltan tambien al pasar por encima de cada elemento
// hijo, asi que contamos entradas y salidas en vez de fiarnos de una sola.
let dragDepth = 0;

function hideDropOverlay() {
  dragDepth = 0;
  dropOverlay.hidden = true;
}

window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  const target = dropTarget();
  if (!target) dropOverlay.textContent = 'Crea una rueda antes de añadir programas.';
  else if (target.items.length >= MAX_ITEMS) dropOverlay.textContent = `${target.name} ya tiene el máximo de ${MAX_ITEMS} elementos.`;
  else dropOverlay.textContent = `Suelta para añadir a ${target.name}`;
  dropOverlay.hidden = false;
});

window.addEventListener('dragover', (e) => e.preventDefault());

window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) hideDropOverlay();
});

window.addEventListener('drop', async (e) => {
  // Sin esto, Electron navegaria la ventana al fichero soltado y perderias
  // los cambios sin guardar.
  e.preventDefault();
  hideDropOverlay();

  const target = dropTarget();
  if (!target) {
    setStatus('Crea una rueda antes de añadir programas.', true);
    return;
  }

  const paths = Array.from(e.dataTransfer.files).map((f) => window.opie.pathForFile(f));
  if (paths.length === 0) return;

  let added = 0;
  for (const filePath of paths) {
    if (addResolvedApp(target.items, await window.opie.appFromPath(filePath))) added++;
  }
  if (paths.length > 1) setStatus(`Añadidos ${added} de ${paths.length}.`, added === 0);
});

init();
