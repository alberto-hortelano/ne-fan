/** ¿Cambió de conducta alguna caja que NO sea un spawn de runtime?
 *
 *  La PR 5 de #241 (#489) declara UN cambio: lo que el motor pone a mitad de
 *  partida pasa a ser sólido. Todo lo demás —los objetos que DECLARA un tile—
 *  tiene que responder EXACTAMENTE lo mismo que antes. Esto lo mide en vez de
 *  suponerlo: reimplanta el criterio de la base copiado literal de
 *  `3cd77d82:nefan-html/src/world/collision.ts` y lo compara con el
 *  `aabbBloquea` de hoy (`nefan-core/dist`) sobre las tres fixtures
 *  commiteadas, en los DOS estados del plan del tile (instalado y sin derivar,
 *  que es el `catch` de `applyPlanCollision`).
 *
 *  No abre navegador ni gasta un céntimo: son las fixtures, `formatDToWorld` y
 *  aritmética. Se corre a mano (`node qa/equivalencia-de-cajas.mjs`); el
 *  candado permanente de esta frontera son `test/obstaculos-del-jugador.test.ts`
 *  y los guiones 02/45/81/91.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatDToWorld } from "../nefan-core/dist/src/scene/scene-normalize.js";
import { aabbBloquea } from "../nefan-core/dist/src/simulation/obstaculos-del-jugador.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESCENAS = path.join(RAIZ, "nefan-core/data/scenes");
const RADIO = 0.4;

/** EL CRITERIO DE LA BASE, copiado literal de `collision.ts` de `3cd77d82`
 *  (solo cambian los nombres del `tileStore` por el booleano que devolvía:
 *  `owner?.svgApplied`, donde `owner` es el tile que contiene al objeto). */
function aabbBase(desde, hasta, radio, obstaculos, svgApplied) {
  for (const obj of obstaculos) {
    if (!obj.sizeXZ) continue;
    if (obj.category !== "building" && obj.category !== "prop") continue;
    if (svgApplied) continue;
    const hx = obj.sizeXZ.x / 2 + radio;
    const hz = obj.sizeXZ.z / 2 + radio;
    if (Math.abs(hasta.x - obj.pos.x) < hx && Math.abs(hasta.z - obj.pos.z) < hz) {
      const alreadyInside = Math.abs(desde.x - obj.pos.x) < hx && Math.abs(desde.z - obj.pos.z) < hz;
      if (!alreadyInside) return true;
    }
  }
  return false;
}

/** Diez destinos por objeto: su centro, los cuatro puntos justo DENTRO de la
 *  pared (media huella + radio − 1 cm), los cuatro justo FUERA (+1 cm) y uno
 *  lejos. Y tres orígenes: lejos, pegado por el oeste y DENTRO (que es la rama
 *  «salir sí, entrar no»). */
function sondas(o) {
  const hx = o.sizeXZ.x / 2 + RADIO;
  const hz = o.sizeXZ.z / 2 + RADIO;
  const destinos = [
    { x: o.pos.x, z: o.pos.z },
    { x: o.pos.x + hx - 0.01, z: o.pos.z }, { x: o.pos.x - hx + 0.01, z: o.pos.z },
    { x: o.pos.x, z: o.pos.z + hz - 0.01 }, { x: o.pos.x, z: o.pos.z - hz + 0.01 },
    { x: o.pos.x + hx + 0.01, z: o.pos.z }, { x: o.pos.x - hx - 0.01, z: o.pos.z },
    { x: o.pos.x, z: o.pos.z + hz + 0.01 }, { x: o.pos.x, z: o.pos.z - hz - 0.01 },
    { x: o.pos.x + 40, z: o.pos.z + 40 },
  ];
  const origenes = [
    { x: o.pos.x + 60, z: o.pos.z + 60 },
    { x: o.pos.x - hx - 0.5, z: o.pos.z },
    { x: o.pos.x + 0.05, z: o.pos.z + 0.05 },
  ];
  return { destinos, origenes };
}

/** El mundo visto por las cajas, con el plan del tile en el estado que se pida. */
const planEn = (aplicado) => ({ planAplicadoEn: () => aplicado });

let totalSondas = 0;
let totalDifs = 0;
const filas = [];

for (const fichero of readdirSync(ESCENAS).filter((f) => f.endsWith(".json")).sort()) {
  const escena = JSON.parse(readFileSync(path.join(ESCENAS, fichero), "utf8"));
  const world = formatDToWorld(escena);
  // Como los monta el cliente: cada objeto de la world scene es una entity que
  // DECLARA este tile (`carga-de-tile.ts`), con su huella en metros.
  const objetos = (world.objects ?? []).map((o) => ({
    id: o.id,
    pos: { x: o.position[0], z: o.position[2] },
    sizeXZ: { x: o.scale[0], z: o.scale[2] },
    category: o.category,
    dueno: { de: "tile", key: "0,0" },
  }));
  const bloqueables = objetos.filter((o) => o.category === "building" || o.category === "prop");

  for (const aplicado of [true, false]) {
    let n = 0;
    const difs = [];
    for (const o of bloqueables) {
      const { destinos, origenes } = sondas(o);
      for (const desde of origenes) {
        for (const hasta of destinos) {
          n += 1;
          const antes = aabbBase(desde, hasta, RADIO, objetos, aplicado);
          const hoy = aabbBloquea(desde, hasta, RADIO, objetos, planEn(aplicado));
          if (antes !== hoy) difs.push(`${o.id} base=${antes} hoy=${hoy} en (${hasta.x.toFixed(2)}, ${hasta.z.toFixed(2)})`);
        }
      }
    }
    totalSondas += n;
    totalDifs += difs.length;
    filas.push({ fichero, aplicado, objetos: bloqueables.length, sondas: n, difs });
  }
}

console.log("── Objetos del TILE: la base contra hoy ─────────────────────────");
for (const f of filas) {
  const estado = f.aplicado ? "plan instalado " : "plan SIN derivar";
  console.log(
    `  ${f.fichero.padEnd(18)} ${estado}  ${String(f.objetos).padStart(2)} bloqueables · ` +
      `${String(f.sondas).padStart(4)} sondas · ${f.difs.length} diferencias` +
      (f.difs.length ? `\n      ${f.difs.slice(0, 5).join("\n      ")}` : ""),
  );
}
console.log(`  TOTAL: ${totalSondas} sondas · ${totalDifs} diferencias`);

// ── Y el cambio DECLARADO: el mismo bulto, puesto por el motor ─────────────
const forja = {
  id: "narr_building_forja",
  pos: { x: 0, z: 0 },
  sizeXZ: { x: 4, z: 4 },
  category: "building",
  dueno: { de: "runtime" },
};
const { destinos, origenes } = sondas(forja);
let cambian = 0;
let nSpawn = 0;
for (const desde of origenes) {
  for (const hasta of destinos) {
    nSpawn += 1;
    const antes = aabbBase(desde, hasta, RADIO, [forja], true);
    const hoy = aabbBloquea(desde, hasta, RADIO, [forja], planEn(true));
    if (antes !== hoy) cambian += 1;
  }
}
console.log("\n── Spawn de RUNTIME (el cambio declarado de #489) ────────────────");
console.log(`  la forja de 4×4 m del motor, tile con su plan instalado: ${nSpawn} sondas · ${cambian} cambian de veredicto`);

console.log(
  totalDifs === 0
    ? "\n✔ ninguna caja que no sea un spawn de runtime cambió de conducta"
    : `\n✖ ${totalDifs} sondas cambian de veredicto fuera de los spawns de runtime`,
);
process.exit(totalDifs === 0 ? 0 : 1);
