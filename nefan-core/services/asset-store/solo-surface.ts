/** El asset-store se niega a arrancar sobre un índice con kinds sin productor.
 *
 *  POR QUÉ (#257). El manifest llevaba 16.986 filas de siete kinds que ningún
 *  proceso volvía a producir (texturas del gpu-worker, repintados de la
 *  oblicua, recortes SAM2…) y `prune` no podía tocarlas: un type sin
 *  directorio conocido era «intocable» por diseño. Quitar el mapeo de esos
 *  kinds sin purgar las filas las habría hecho inmunes para siempre. La
 *  purga es una operación aparte (`scripts/manifest-solo-surface.ts`, con
 *  export de procedencia por #293), y este veredicto es lo que impide que un
 *  índice a medio purgar —o un clon con `cache/` histórico— arranque callado
 *  y sirva 404 sobre filas que ya no tienen blob.
 *
 *  Decisión pura: recibe la DB y devuelve el veredicto redactado. Quien sale
 *  con 1 es `server.ts`. */
import type { ManifestDb } from "./manifest-db.js";

export const SCRIPT_DE_PURGA = "scripts/manifest-solo-surface.ts";

export type VeredictoSoloSurface = { ok: true } | { ok: false; mensaje: string };

export function verificarSoloSurface(db: ManifestDb): VeredictoSoloSurface {
  const ajenos = db.kindsAjenos();
  if (ajenos.length === 0) return { ok: true };

  // Una línea por type (los subtypes dentro), para que el mensaje entero
  // quepa en la cola del log que enseña start.sh cuando el hijo muere.
  const porType = new Map<string, { filas: number; bytes: number; subtypes: string[] }>();
  for (const k of ajenos) {
    const acc = porType.get(k.type) ?? { filas: 0, bytes: 0, subtypes: [] };
    acc.filas += k.filas;
    acc.bytes += k.bytes;
    acc.subtypes.push(`${k.subtype} ${k.filas}`);
    porType.set(k.type, acc);
  }
  const totalFilas = ajenos.reduce((n, k) => n + k.filas, 0);
  const lineas = [...porType.entries()].map(
    ([type, t]) => `   ${type} (${t.subtypes.join(", ")}): ${t.filas} filas, ${mb(t.bytes)}`,
  );
  return {
    ok: false,
    mensaje: [
      `asset-store: el índice tiene ${totalFilas} filas de kinds SIN productor — no arranco.`,
      ...lineas,
      `   Archiva sus blobs (mv cache/<dir> archivo/cache/<dir>) y purga las filas con`,
      `   npx tsx ${SCRIPT_DE_PURGA}            (dry-run: enseña la tabla)`,
      `   npx tsx ${SCRIPT_DE_PURGA} --ejecutar (exporta la procedencia y borra)`,
    ].join("\n"),
  };
}

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
