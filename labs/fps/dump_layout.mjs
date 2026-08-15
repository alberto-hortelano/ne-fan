#!/usr/bin/env node
// dump_layout.mjs <interior|exterior> [A|C] [pagePx] — vuelca a stdout el
// layout del atlas de superficies de una escena (celdas + rects + asignación
// prim→celda). gen.py lo consume para pintar la base y recortar; el viewer
// carga el mismo JSON del run para aplicar UVs.
import { buildLayout } from "./surfaces.mjs";

const [sceneName, variant = "C", pagePxArg] = process.argv.slice(2);
if (!sceneName) {
  console.error("uso: node dump_layout.mjs <interior|exterior> [A|C] [pagePx]");
  process.exit(1);
}
const mod = await import(`./escenas/${sceneName}/escena.mjs`);
const scene = await mod.load();
const layout = buildLayout(scene.prims, {
  variant,
  pagePx: pagePxArg ? Number(pagePxArg) : 1024,
});
const out = {
  scene: sceneName,
  variant,
  description: scene.meta.description,
  ...layout,
};
console.log(JSON.stringify(out, null, 1));
console.error(
  `${sceneName} (${variant}): ${out.pages.length} página(s), ` +
    out.pages.map((p) => p.cells.length).join("+") +
    " celdas — " +
    out.pages.map((p) => p.cells.map((c) => c.key).join(", ")).join(" | "),
);
