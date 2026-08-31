import { defineConfig } from "vite";
import { resolve } from "path";
import { existsSync, readdirSync } from "node:fs";
// El puerto del dev server sale de la fuente única del repo, no de un literal
// aquí: `nefan-core/src/config.ts` (que a su vez deriva del registro de
// servicios). Era la quinta copia del número 3000.
import { CONFIG } from "../nefan-core/src/config.js";
import {
  HOJAS_ANGLE,
  HOJAS_BASE_ANIMS,
  type SpriteCensusResponse,
} from "../nefan-core/src/contracts/sprite-census.js";

export default defineConfig({
  plugins: [
    {
      // El censo vivo de hojas de personaje (#216): `GET /sprites/index.json`
      // escanea `public/sprites/` EN CADA request — la verdad medida en el
      // mismo origen que sirve las hojas, fresca (renderizar un modelo → F5 →
      // aparece). Qué es «completo» NO se decide aquí: la respuesta es cruda
      // y la exigencia (`required`) viaja dentro; filtrar es trabajo de
      // `modelosCompletos` (nefan-core). Directorio ausente = el clon limpio,
      // `{models: []}` y no un error. Límite honesto: el censo existe solo
      // bajo vite dev — hoy el único servidor del cliente en todos los
      // presets; si algún día se sirve buildado, el fetch da 404 y el editor
      // de personaje lo DICE (nota inline + error-log), nunca calla.
      name: "censo-de-sprites",
      configureServer(server) {
        server.middlewares.use("/sprites/index.json", (_req, res) => {
          try {
            const raiz = resolve(__dirname, "public/sprites");
            const models: SpriteCensusResponse["models"] = [];
            if (existsSync(raiz)) {
              for (const modelo of readdirSync(raiz, { withFileTypes: true })) {
                if (!modelo.isDirectory()) continue;
                // Una anim «está» cuando su meta.json del ángulo único existe:
                // es el fichero que SpriteRenderer pide primero para cargarla.
                const anims = readdirSync(resolve(raiz, modelo.name), { withFileTypes: true })
                  .filter((a) => a.isDirectory())
                  .map((a) => a.name)
                  .filter((a) => existsSync(resolve(raiz, modelo.name, a, HOJAS_ANGLE, "meta.json")))
                  .sort();
                models.push({ id: modelo.name, anims });
              }
            }
            // readdir no garantiza orden: se ordena para que el censo (y el
            // desplegable que se deriva de él) sea determinista.
            models.sort((a, b) => a.id.localeCompare(b.id));
            const censo: SpriteCensusResponse = {
              required: { anims: [...HOJAS_BASE_ANIMS], angle: HOJAS_ANGLE },
              models,
            };
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(censo));
          } catch (err) {
            // Fail-loud (criterio 6 de #216): un walk que no puede leer el
            // disco responde 500 con el motivo — el cliente lo registra y
            // degrada DICIÉNDOLO, nunca un 200 vacío que parezca censo.
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ detail: `censo de sprites: ${String(err)}` }));
          }
        });
      },
    },
  ],
  // Sin fallback SPA (#217). Con `appType: "spa"` (el defecto), el dev server
  // responde a CUALQUIER ruta que no case con un fichero sirviendo el
  // `index.html` con **HTTP 200 text/html**: una hoja de sprites a medias
  // —`/sprites/y_bot/idle/frontal_8/dir_0_frame_043.png` que no existe— se
  // servía como éxito, y todo `r.ok` sobre un estático era un verde que no
  // podía ponerse rojo (medido: 200, 7127 B, el index). Con "mpa" el fichero
  // que no está devuelve 404, que es lo que dice la verdad; `/` sigue
  // sirviendo el index (es el único sitio por el que se entra: start.sh y
  // qa/run.mjs abren la raíz). NO afecta al build: `vite build` con "spa" y
  // con "mpa" produce árboles byte a byte idénticos — appType solo gobierna
  // el dev/preview server.
  appType: "mpa",
  resolve: {
    alias: {
      // Único punto de acoplamiento con el árbol de nefan-core: los imports
      // usan "@nefan-core/..." (ver también tsconfig.json "paths"). Si
      // nefan-core se mueve, sólo se toca aquí y en tsconfig.
      "@nefan-core": resolve(__dirname, "../nefan-core"),
    },
  },
  server: {
    port: Number(process.env.NEFAN_HTML_PORT ?? CONFIG.ports.html),
    // Sin esto vite SE DESPLAZA SOLO al puerto siguiente cuando el suyo está
    // ocupado, y lo dice en una línea de su log que nadie lee. El efecto con
    // dos stacks a la vez es el peor de los posibles: la segunda instancia
    // sirve en el puerto siguiente, el banco sigue abriendo el suyo — y mide el
    // cliente de la PRIMERA, en verde y sin una sola pista. Que no arranque es
    // la respuesta correcta: el puerto tiene dueño.
    strictPort: true,
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
