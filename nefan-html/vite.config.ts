import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Único punto de acoplamiento con el árbol de nefan-core: los imports
      // usan "@nefan-core/..." (ver también tsconfig.json "paths"). Si
      // nefan-core se mueve, sólo se toca aquí y en tsconfig.
      "@nefan-core": resolve(__dirname, "../nefan-core"),
    },
  },
  server: {
    port: 3000,
    // SIN recarga automática al tocar código: el cliente no acepta HMR
    // módulo a módulo, así que cada cambio disparaba un full-reload que mata
    // la partida en curso (sesión, posición, escena cargada). Con hmr:false
    // no hay canal de notificación al navegador — los cambios se recogen
    // recargando A MANO (F5) cuando el jugador/dev lo decida.
    hmr: false,
    fs: {
      // El selector de escenas importa las fixtures de nefan-core/data por
      // glob (fuera de la raíz del cliente).
      allow: [resolve(__dirname, "..")],
    },
  },
});
