// electron-builder borra y reescribe dist/win-unpacked sin comprobar nada.
// Si la aplicacion esta abierta, Windows le impide sustituir los ficheros en
// uso: la build muere a medias y deja el paquete inservible, sin los .pak de
// Chromium (donde vive hasta la hoja de estilos por defecto del navegador, asi
// que la app arranca mostrando HTML crudo). Mejor no empezar siquiera.
const { execFileSync } = require('child_process');

const NAME = 'Opie Launcher.exe';

let out = '';
try {
  out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${NAME}`], { encoding: 'utf8' });
} catch {
  process.exit(0); // sin tasklist no sabemos nada; no bloqueamos la compilacion
}

if (out.includes(NAME)) {
  console.error(
    `\n  "${NAME}" esta abierto.\n` +
      '  Cierralo antes de compilar (icono de la bandeja > Salir): la build lo\n' +
      '  sobrescribe, y si esta en uso se queda a medias y rompe el paquete.\n'
  );
  process.exit(1);
}
