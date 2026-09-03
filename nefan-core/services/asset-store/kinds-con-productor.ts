/** El asset-store se niega a arrancar sobre un índice con kinds sin productor.
 *
 *  POR QUÉ (#257). El manifest llevaba 16.986 filas de siete kinds que ningún
 *  proceso volvía a producir (texturas del gpu-worker, repintados de la
 *  oblicua, recortes SAM2…) y `prune` no podía tocarlas: un type sin
 *  directorio conocido era «intocable» por diseño. Quitar el mapeo de esos
 *  kinds sin purgar las filas las habría hecho inmunes para siempre. La
 *  purga es una operación aparte (`scripts/manifest-kinds-con-productor.ts`,
 *  con export de procedencia por #293), y este veredicto es lo que impide que
 *  un índice a medio purgar —o un clon con `cache/` histórico— arranque
 *  callado y sirva 404 sobre filas que ya no tienen blob.
 *
 *  EL INVARIANTE NO ES «UN SOLO KIND» (#376). Hasta septiembre de 2026 el
 *  índice tenía exactamente uno y esto se llamaba `verificarSoloSurface`, que
 *  contaba lo que hacía pero no lo que defendía: lo que no se admite es un
 *  kind que NADIE pueda volver a producir, porque su fila promete un blob que
 *  ya no se puede rehacer. Los dos kinds del arte de personaje sí tienen
 *  productor (`ai_server/routers/remote_generation.py`), así que entraron —y
 *  el nombre de esta función pasó a decir el invariante y no el recuento.
 *
 *  Decisión pura: recibe la DB y devuelve el veredicto redactado. Quien sale
 *  con 1 es `server.ts`. */
import type { ManifestDb } from "./manifest-db.js";

export const SCRIPT_DE_PURGA = "scripts/manifest-kinds-con-productor.ts";

export type VeredictoKinds = { ok: true } | { ok: false; mensaje: string };

/** De qué índice y de qué almacén habla el veredicto.
 *
 *  Va como parámetro OBLIGATORIO desde que `NEFAN_MANIFEST_DB` existe (#391):
 *  antes había un solo índice posible y el mensaje podía hablar de «el»
 *  índice; ahora hay dos, y uno que no dice cuál rechaza deja al que lo lee
 *  sin saber si el `exit 1` viene del fichero que acaba de apuntar a propósito
 *  o del checkout. Por lo mismo el consejo de archivar lleva el almacén de
 *  verdad y no un `cache/` literal: las dos mitades pueden ser de mundos
 *  distintos, y solo se ve si se nombran las dos. */
export interface IndiceInspeccionado {
  /** Fichero SQLite que se ha abierto (`AssetStoreConfig.dbPath`). */
  dbPath: string;
  /** Raíz de los blobs, donde están los directorios a archivar (`cacheDir`). */
  cacheDir: string;
}

export function verificarKindsConProductor(
  db: ManifestDb,
  indice: IndiceInspeccionado,
): VeredictoKinds {
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
  // El `--db` del consejo no es adorno: el script lee `NEFAN_MANIFEST_DB` del
  // entorno EN EL QUE SE LE LLAMA, que no tiene por qué ser el del store que
  // acaba de negarse (el store puede haberlo recibido de start.sh o de un
  // guion). Con la ruta escrita, copiar y pegar purga el índice correcto.
  const purga = `npx tsx ${SCRIPT_DE_PURGA} --db ${indice.dbPath}`;
  return {
    ok: false,
    mensaje: [
      `asset-store: el índice ${indice.dbPath} tiene ${totalFilas} filas de kinds SIN productor — no arranco.`,
      ...lineas,
      `   Archiva sus blobs (mv ${indice.cacheDir}/<dir> archivo/cache/<dir>) y purga las filas con`,
      `   ${purga}            (dry-run: enseña la tabla)`,
      `   ${purga} --ejecutar (exporta la procedencia y borra)`,
    ].join("\n"),
  };
}

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
