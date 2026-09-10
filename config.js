// Carga y guardado del config.json. Separado de main.js para poder probar
// esta logica con node a secas (main.js hace require('electron') al cargar,
// lo que revienta fuera de Electron).
const fs = require('fs');
const crypto = require('crypto');

function id() {
  return crypto.randomUUID();
}

function defaultConfig(legacyPinned = []) {
  return {
    wheels: [
      {
        id: id(),
        name: 'Principal',
        shortcut: 'Control+Shift+Space',
        items: legacyPinned.map((p) => ({
          id: id(),
          type: 'app',
          name: p.name,
          execPath: p.execPath,
          icon: p.icon,
          toggleClose: p.toggleClose !== false,
        })),
      },
    ],
  };
}

function loadConfig(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // El fichero esta ahi pero no se deja leer ahora mismo: un antivirus
      // mirandolo, un bloqueo momentaneo, permisos. Devolvemos la config por
      // defecto SIN guardar nada, porque escribir aqui destruiria las ruedas
      // del usuario por un fallo que probablemente no se repita al arrancar
      // otra vez. Que la sesion salga vacia es molesto; perderlo todo, no.
      console.error(`[config] "${configPath}" existe pero no se pudo leer, se arranca en blanco sin tocarlo:`, err.message);
      // Marcado para que nadie escriba encima: lo que devolvemos son ruedas
      // vacias, y guardarlas se llevaria por delante las de verdad, que
      // siguen intactas en el fichero que no hemos podido leer.
      return { ...defaultConfig(), degraded: true };
    }
    // No existe: primera ejecucion. Crear la config por defecto es correcto.
    const config = defaultConfig();
    saveConfig(configPath, config);
    return config;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Existe pero no se puede leer (p.ej. un cierre a media escritura lo dejo
    // truncado). NO lo machacamos: lo apartamos para que el usuario lo pueda
    // recuperar a mano, y arrancamos desde la config por defecto.
    const backupPath = configPath.replace(/\.json$/, '') + `.corrupto-${Date.now()}.json`;
    try {
      fs.renameSync(configPath, backupPath);
      console.error(`[config] "${configPath}" no se pudo leer, se ha movido a "${backupPath}":`, err.message);
    } catch (renameErr) {
      console.error(`[config] "${configPath}" no se pudo leer ni renombrar:`, renameErr.message);
    }
    const config = defaultConfig();
    saveConfig(configPath, config);
    return config;
  }

  if (!parsed || !Array.isArray(parsed.wheels)) {
    // Migracion desde el formato viejo (una lista plana "pinned") o config sin wheels.
    const legacyPinned = parsed && Array.isArray(parsed.pinned) ? parsed.pinned : [];
    const config = defaultConfig(legacyPinned);
    saveConfig(configPath, config);
    return config;
  }

  return parsed;
}

function saveConfig(configPath, config) {
  // Escritura atomica: escribimos a un fichero temporal junto al destino y
  // lo renombramos encima. Un corte a media escritura deja el .tmp a medias
  // pero el config.json anterior sigue intacto (rename es atomico en el
  // mismo volumen).
  const tmpPath = `${configPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2));
  fs.renameSync(tmpPath, configPath);
}

module.exports = { loadConfig, saveConfig };
