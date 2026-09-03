#!/usr/bin/env node
/** EL ARTE DE PERSONAJE NO SE PINA A MEDIAS (QA de T8 PR-C: #376).
 *
 *  El hero-shot y los sheets vestidos son el arte más caro del juego (~16
 *  llamadas de imagen por personaje, más la de identidad que las precede) y
 *  hasta #376 vivían sin fila y sin prompt: un PNG llamado por un hash que no
 *  se podía volver a pedir. El cierre del issue no era «indexarlos» a secas
 *  —eso los habría vuelto evictables, y sin keep-list de personaje el prune
 *  podría borrar por LRU la skin de un NPC vivo—, sino indexarlos **con su
 *  procedencia y PINEADOS, hero y frames a la vez**.
 *
 *  Este guion mide esa pareja donde se decide: contra el ENTRY REAL del
 *  asset-store (`services/asset-store/server.ts`, el mismo que lanza
 *  `start.sh`), por HTTP, y contra el `prune` real con sus tres kinds.
 *
 *  Lo que se afirma:
 *   1 · EL REF DE PIN NO ES UNA ENTRADA — el arte de personaje NO entra por
 *       `POST /assets` (400 que dice por dónde va): entra entero por
 *       `POST /assets/character`, y el `ref` lo DERIVA el store de `hero_key`.
 *       Así «registrado sin pin» y «un sheet colgando del ref de otro
 *       personaje» dejan de tener un campo en el que escribirse.
 *   2 · SIN PROCEDENCIA NO ES EXPRESABLE — prompt vacío en arte de personaje
 *       es 400, y `surface` lo sigue admitiendo (la regla es del kind, no una
 *       vuelta de tuerca global que alguien endureció de paso).
 *   3 · EL REGISTRO VÁLIDO DEJA DUEÑO — fila con su prompt, `extra` entero
 *       (con qué se vuelve a pedir), hero y sheet PINEADOS bajo el mismo
 *       `character:{hero_key}`, y el kind consultable por `/assets`.
 *   4 · SE SUELTAN JUNTOS — un solo `DELETE /assets/pin/{ref}` retira los dos.
 *   5 · EL CACHE-HIT NO DUPLICA — registrar el mismo arte N veces (que es lo
 *       que hace el adaptador en cada servida) deja UNA fila por kind.
 *   6 · EL PRUNE SABE BORRAR CADA LAYOUT — `surface` y `sprite_sheet` son
 *       DIRECTORIOS y `sprite_hero` un FICHERO suelto bajo `heroes/`: se borra
 *       el blob correcto de cada uno y la carpeta `heroes/` NO se va entera.
 *   7 · EL PIN PROTEGE DE VERDAD — con el pin del personaje, el prune con
 *       techo de 1 byte no toca ni el hero ni sus frames.
 *   8 · UN TYPE SIN PRODUCTOR ES FAIL-LOUD — el prune lanza nombrando type y
 *       hash en vez de saltárselo callado (desindexar arte cuyo blob se queda
 *       en disco es el desenlace que #257 tardó meses en descubrir).
 *   9 · EL HASH TIENE FORMA — 16 hex en las dos mitades. No es celo: el prune
 *       borra `rutaDeBlob(kind, hash)` con `rmSync recursive` y la carpeta de
 *       hero-shots cuelga DENTRO de la raíz de sheets, así que una fila
 *       llamada `heroes` se llevaba la carpeta entera y un `../..` salía de
 *       `cache/`.
 *
 *  LOS PUNTOS 1 Y 9 NACIERON COMO BLOQUE «PENDIENTE» DE ESTE GUION, escrito
 *  por el QA de #376 cuando eran huecos medidos y sin candar: un `sprite_sheet`
 *  aceptaba el `character_ref` de otro personaje (soltar A se llevaba los
 *  frames de B) y el `hash` no tenía forma. Los dos se cerraron en la misma PR
 *  —el primero rediseñando el registro para que el ref no sea una entrada— y
 *  el bloque pasó a ser lo que un candado cerrado tiene que ser: dos
 *  comprobaciones más, no una nota que envejece.
 *
 *  CERO CRÉDITOS y cero vecinos molestados: no llama a `/identity` ni a
 *  `/skins`, no arranca sprite-forge ni el motor, el índice y los blobs son
 *  `mkdtemp` de usar y tirar (`NEFAN_MANIFEST_DB`, la palanca de #391 — el
 *  índice del checkout no se abre ni para leerlo), el puerto lo elige el
 *  KERNEL (`NEFAN_ASSET_STORE_PORT=0`, y se lee el real de la línea de
 *  arranque) y el hijo se mata por SU PID, nunca por puerto ni por nombre.
 *
 *  Vive FUERA de `qa/guiones/` por la razón de `sprites-sin-servicio.mjs` y
 *  `el-indice-del-store-…`: no toca la página, y en `guiones/` cada corrida de
 *  la batería pagaría un Chromium para un check que solo arranca y para un
 *  servicio.
 *
 *  EN NEGATIVO — 24 comprobaciones en verde, y los mutantes MEDIDOS el
 *  2026-09-03 (rotos a mano de uno en uno y revertidos, `git diff` vacío tras
 *  cada uno). La lista está en `implementacion-c.md`; los que este guion caza:
 *   · `POST /assets` vuelve a aceptar los kinds de personaje  → 2 rojos
 *   · el store deja de estampar el `character_ref` derivado   → 2 rojos
 *   · `prompt: z.string()` en el arte de personaje            → 1 rojo
 *   · el hash pierde la forma (`z.string().min(1)`)           → 3 rojos
 *   · el handler registra sin pinar                           → 2 rojos
 *   · `rutaDeBlob` trata al hero como directorio              → 1 rojo
 *   · el `type` desconocido del prune pasa a `continue`       → 1 rojo
 *
 *  Uso:  node qa/el-arte-de-personaje-no-se-pina-a-medias.mjs
 *
 *  Salida: 0 todo verde · 1 alguna comprobación en rojo · 2 no llegó a medir.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(RAIZ, "nefan-core");
const SERVER = join(CORE, "services", "asset-store", "server.ts");
const INDICE_DEL_CHECKOUT = join(RAIZ, "cache", "manifest.sqlite3");

/** 16 hex, la forma que tienen de verdad `hero_key` y la clave del sheet
 *  (`ai_server/routers/remote_generation.py`). */
const HERO = "aaaaaaaaaaaaaaa1";
const HERO_OTRO = "bbbbbbbbbbbbbbb2";
const SHEET = "1111111111111111";
const SHEET_OTRO = "2222222222222222";
const SURFACE = "5555555555555555";
const REF = `character:${HERO}`;

const fallos = [];
let base = null;

function expect(titulo, cond, detalle) {
  if (cond) {
    console.log(`  ✔ ${titulo}`);
    return true;
  }
  console.log(`  ✘ ${titulo}${detalle === undefined ? "" : `\n      ${detalle}`}`);
  fallos.push(titulo);
  return false;
}

/** Foto del índice del checkout: este guion no debe abrirlo ni de lectura.
 *  `null` = no existe, que es legítimo en un clon recién hecho. */
function fotoDelIndice() {
  if (!existsSync(INDICE_DEL_CHECKOUT)) return null;
  const st = statSync(INDICE_DEL_CHECKOUT);
  return `${st.size}@${st.mtimeMs}`;
}

async function post(ruta, cuerpo) {
  const res = await fetch(`${base}${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function getJson(ruta) {
  const res = await fetch(`${base}${ruta}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** El arte de UN personaje, en el cuerpo que espera `/assets/character`. Ni
 *  `type`, ni `subtype`, ni `ref`: los pone el store. */
const personaje = (heroKey, { hero, sheets } = {}) => ({
  hero_key: heroKey,
  ...(hero === undefined ? {} : { hero }),
  ...(sheets === undefined ? {} : { sheets }),
});

const fila = (prompt = "Blas, el tabernero", extra) => ({
  prompt,
  size_bytes: 1000,
  ...(extra === undefined ? {} : { extra }),
});

/** Arranca el entry REAL contra un índice temporal y devuelve su URL. El
 *  puerto lo elige el kernel y se lee de la línea de arranque, que desde #391
 *  imprime el puerto EFECTIVO y no el pedido. */
function arrancarStore(dbPath) {
  return new Promise((cumplir, fallar) => {
    const hijo = spawn(process.execPath, ["--import", "tsx", SERVER], {
      cwd: CORE,
      env: { ...process.env, NEFAN_MANIFEST_DB: dbPath, NEFAN_ASSET_STORE_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let salida = "";
    const guardia = setTimeout(() => {
      hijo.kill("SIGKILL");
      fallar(new Error(`el asset-store no llegó a escuchar en 60 s:\n${salida}`));
    }, 60_000);
    const mirar = (b) => {
      salida += b.toString();
      const m = salida.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (!m) return;
      clearTimeout(guardia);
      cumplir({ hijo, url: m[1], salida: () => salida });
    };
    hijo.stdout.on("data", mirar);
    hijo.stderr.on("data", mirar);
    hijo.on("error", (e) => {
      clearTimeout(guardia);
      fallar(e);
    });
  });
}

/** El prune REAL, en un hijo con `tsx`: se importan `ManifestDb`, `prune` y
 *  `rutaDeBlob` de producción (nada de reimplementar el layout aquí, que sería
 *  el espejo que deriva) y se devuelve el veredicto en JSON. */
function correrPrune(dir) {
  const guion = `
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ManifestDb } from "./services/asset-store/manifest-db.ts";
import { prune } from "./services/asset-store/prune.ts";
import { refDeArteDePersonaje } from "./src/contracts/asset-store.ts";

const cache = ${JSON.stringify(dir)};
const blobDirs = {
  surface: join(cache, "surfaces"),
  sprite_sheet: join(cache, "sprite_sheets"),
  sprite_hero: join(cache, "sprite_sheets", "heroes"),
};
for (const d of Object.values(blobDirs)) mkdirSync(d, { recursive: true });
const relleno = (n) => Buffer.alloc(n, 1);
const plantar = () => {
  mkdirSync(join(blobDirs.surface, "s000000000000001"), { recursive: true });
  writeFileSync(join(blobDirs.surface, "s000000000000001", "surface.png"), relleno(100));
  mkdirSync(join(blobDirs.sprite_sheet, ${JSON.stringify(SHEET)}), { recursive: true });
  for (let i = 0; i < 3; i++)
    writeFileSync(join(blobDirs.sprite_sheet, ${JSON.stringify(SHEET)}, "dir_0_frame_00" + i + ".png"), relleno(50));
  writeFileSync(join(blobDirs.sprite_hero, ${JSON.stringify(HERO)} + ".png"), relleno(200));
  writeFileSync(join(blobDirs.sprite_hero, ${JSON.stringify(HERO_OTRO)} + ".png"), relleno(200));
};
const out = {};

// A · sin pins y techo de 1 byte: cada kind por su layout.
plantar();
const a = new ManifestDb(join(cache, "a.sqlite3"));
a.register({ hash: "s000000000000001", type: "surface", subtype: "surface", prompt: "p", size_bytes: 100 });
a.register({ hash: ${JSON.stringify(SHEET)}, type: "sprite_sheet", subtype: "sprite_sheet", prompt: "p", size_bytes: 150 });
a.register({ hash: ${JSON.stringify(HERO)}, type: "sprite_hero", subtype: "sprite_hero", prompt: "p", size_bytes: 200 });
out.podados = prune(a, blobDirs, 1, null).pruned;
out.surfaceBorrada = !existsSync(join(blobDirs.surface, "s000000000000001"));
out.sheetBorrado = !existsSync(join(blobDirs.sprite_sheet, ${JSON.stringify(SHEET)}));
out.heroBorrado = !existsSync(join(blobDirs.sprite_hero, ${JSON.stringify(HERO)} + ".png"));
out.carpetaHeroesEnPie = existsSync(blobDirs.sprite_hero);
out.heroVecinoIntacto = existsSync(join(blobDirs.sprite_hero, ${JSON.stringify(HERO_OTRO)} + ".png"));
out.filasTrasPodar = a.listAssets(undefined, 100).length;
a.close();

// B · con el pin del personaje, el mismo techo no toca nada.
plantar();
const b = new ManifestDb(join(cache, "b.sqlite3"));
const ref = refDeArteDePersonaje(${JSON.stringify(HERO)});
b.registrarArteDePersonaje([
  { hash: ${JSON.stringify(HERO)}, type: "sprite_hero", subtype: "sprite_hero", prompt: "p", size_bytes: 200 },
  { hash: ${JSON.stringify(SHEET)}, type: "sprite_sheet", subtype: "sprite_sheet", prompt: "p", size_bytes: 150 },
], ref);
out.podadosConPin = prune(b, blobDirs, 1, b.pinnedHashes()).pruned;
out.sheetSigue = existsSync(join(blobDirs.sprite_sheet, ${JSON.stringify(SHEET)}));
out.heroSigue = existsSync(join(blobDirs.sprite_hero, ${JSON.stringify(HERO)} + ".png"));
b.close();

// C · un type sin productor: fail-loud, y la fila NO se desindexa.
const c = new ManifestDb(join(cache, "c.sqlite3"));
c.importEntry({ hash: "zzz", type: "texture", subtype: "albedo", prompt: "", created_at: "2020-01-01T00:00:00Z", size_bytes: 999999, extra: "{}", last_used: "2020-01-01T00:00:00Z" });
try {
  prune(c, blobDirs, 1, null);
  out.typeDesconocido = "NO LANZÓ";
} catch (e) {
  out.typeDesconocido = String(e.message);
}
out.filaAjenaSigue = c.listAssets(undefined, 100).length;
c.close();

// D · el borrado por hash sigue siendo recursivo, así que la forma del hash es
//     lo único que separa un blob de una carpeta. Aquí se PLANTA a mano la fila
//     que el zod ya no deja entrar (importEntry no valida, a propósito) para
//     medir qué haría el prune si volviera a colarse: es la razón por la que
//     HASH_DE_ASSET existe, escrita como medida y no como opinión.
plantar();
const d = new ManifestDb(join(cache, "d.sqlite3"));
d.importEntry({ hash: "heroes", type: "sprite_sheet", subtype: "sprite_sheet", prompt: "p", created_at: "2020-01-01T00:00:00Z", size_bytes: 999, extra: "{}", last_used: "2020-01-01T00:00:00Z" });
prune(d, blobDirs, 1, null);
out.heroesTrasElHashHeroes = existsSync(blobDirs.sprite_hero)
  ? readdirSync(blobDirs.sprite_hero).length
  : "la carpeta heroes/ ya no existe";
d.close();

console.log("__JSON__" + JSON.stringify(out));
`;
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", guion], {
    cwd: CORE,
    encoding: "utf8",
  });
  const linea = (r.stdout ?? "").split("\n").find((l) => l.startsWith("__JSON__"));
  if (!linea) throw new Error(`el hijo del prune no devolvió veredicto:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(linea.slice("__JSON__".length));
}

async function main() {
  if (!existsSync(SERVER)) {
    console.log(`⊘ SIN MEDIR — no está el entry del asset-store en ${SERVER}`);
    return 2;
  }
  console.log("¿El arte de personaje entra con dueño, y hero y frames van juntos?\n");

  const antes = fotoDelIndice();
  const tmp = mkdtempSync(join(tmpdir(), "qa-arte-personaje-"));
  let store = null;

  try {
    store = await arrancarStore(join(tmp, "manifest.sqlite3"));
    base = store.url;
    console.log(`  · asset-store real en ${base}, índice temporal (el del checkout no se abre)\n`);

    // ── 1 · el ref de pin no es una ENTRADA ───────────────────────────────
    //
    // La puerta vieja está cerrada, y no es cosmética: mientras `POST /assets`
    // aceptara un `character_ref` por fila, un `sprite_sheet` podía declarar
    // el ref de OTRO personaje. Medido cuando el hueco existía: soltar A daba
    // `removed: 3` (se llevaba los frames de B) y soltar B daba `removed: 1`.
    // Eso es «un hero sin sus frames», que es la frase del criterio de cierre
    // de #376. Hoy el ref sale de `hero_key` y no hay dónde escribir la
    // contradicción.
    for (const kind of ["sprite_hero", "sprite_sheet"]) {
      const hash = kind === "sprite_hero" ? HERO : SHEET;
      const r = await post("/assets", {
        hash, type: kind, subtype: kind, prompt: "Blas, el tabernero", size_bytes: 1000,
        extra: { character_ref: HERO },
      });
      const enIndice = await getJson(`/assets/by_hash/${hash}`);
      expect(
        `${kind} por POST /assets: 400 que manda a la ruta del personaje, y sin fila`,
        r.status === 400 && /assets\/character/.test(String(r.body?.error)) && enIndice.status === 404,
        `status=${r.status} by_hash=${enIndice.status} ${JSON.stringify(r.body).slice(0, 200)}`,
      );
    }
    const vacia = await post("/assets/character", personaje(HERO));
    expect(
      "una petición sin hero y sin sheets no registra nada: 400, no un 200 mudo",
      vacia.status === 400 && /al menos uno/.test(String(vacia.body?.error)),
      `status=${vacia.status} ${JSON.stringify(vacia.body).slice(0, 200)}`,
    );

    // ── 2 · «sin procedencia» no es expresable, y es del KIND ──────────────
    const mudo = await post("/assets/character", personaje(HERO, { hero: fila("") }));
    expect(
      "arte de personaje con el prompt vacío: 400 (la procedencia es el motivo del índice)",
      mudo.status === 400,
      `status=${mudo.status} ${JSON.stringify(mudo.body).slice(0, 200)}`,
    );
    const superficieMuda = await post("/assets", {
      hash: SURFACE, type: "surface", subtype: "surface", prompt: "", size_bytes: 1,
    });
    expect(
      "y la superficie SÍ lo admite: la regla nueva es del kind, no un endurecimiento global",
      superficieMuda.status === 200,
      `status=${superficieMuda.status} ${JSON.stringify(superficieMuda.body).slice(0, 200)}`,
    );

    // ── 2 bis · el hash tiene FORMA en las dos mitades ─────────────────────
    //
    // El prune borra `rutaDeBlob(kind, hash)` con `rmSync recursive`, y
    // `heroes/` cuelga DENTRO de la raíz de sheets: una fila `sprite_sheet`
    // llamada `heroes` se llevaba la carpeta ENTERA de hero-shots dejando sus
    // filas apuntando a nada — el estado exacto que #257 tardó meses en
    // descubrir. Con `../..`, el borrado salía de `cache/`.
    for (const malo of ["heroes", "../../fuera-del-cache", "NoEsUnHash"]) {
      const comoHero = await post("/assets/character", personaje(malo, { hero: fila() }));
      const comoSheet = await post(
        "/assets/character",
        personaje(HERO, { sheets: [{ hash: malo, ...fila() }] }),
      );
      expect(
        `un hash sin forma de hash ("${malo}") es 400 como hero_key y como sheet`,
        comoHero.status === 400 && comoSheet.status === 400,
        `hero=${comoHero.status} sheet=${comoSheet.status}`,
      );
    }

    // ── 3 · el registro válido deja dueño, en UNA transacción ─────────────
    const extra = { model: "y_bot", anim: "idle", ai_model: "gpt-image-2" };
    const ok1 = await post(
      "/assets/character",
      personaje(HERO, {
        hero: fila("Blas, el tabernero", extra),
        sheets: [{ hash: SHEET, ...fila("Blas, el tabernero", { ...extra, anim: "walk" }) }],
      }),
    );
    expect(
      "hero y sheet en UNA petición: 200 con el ref DERIVADO y las dos filas",
      ok1.status === 200 && ok1.body?.ref === REF && ok1.body?.rows === 2,
      `status=${ok1.status} ${JSON.stringify(ok1.body)}`,
    );

    const filaHero = (await getJson(`/assets/by_hash/${HERO}`)).body?.matches?.[0];
    expect(
      "la fila del hero lleva su PROMPT y el extra entero (con qué se vuelve a pedir)",
      filaHero?.prompt === "Blas, el tabernero" &&
        filaHero?.extra?.model === "y_bot" &&
        filaHero?.extra?.ai_model === "gpt-image-2",
      JSON.stringify(filaHero).slice(0, 240),
    );
    expect(
      "y el character_ref lo ESTAMPA el store, de la misma fuente que el pin",
      filaHero?.extra?.character_ref === HERO,
      JSON.stringify(filaHero?.extra).slice(0, 200),
    );
    expect(
      "el hero NO promete cache_url: esa forma de URL no sirve este kind",
      filaHero !== undefined && filaHero.cache_url === undefined,
      JSON.stringify(filaHero).slice(0, 200),
    );

    const listado = await getJson("/assets?asset_type=sprite_hero&limit=50");
    expect(
      "y se consulta por kind con su prompt: /assets?asset_type=sprite_hero",
      (listado.body?.assets ?? []).some((f) => f.hash === HERO && f.prompt === "Blas, el tabernero"),
      JSON.stringify(listado.body).slice(0, 240),
    );

    // ── 4 · el sheet de OTRO personaje no puede colgar de este ref ─────────
    //
    // El hueco que tumbó la primera forma de la PR, cerrado por construcción:
    // el `character_ref` que venga en `extra` lo PISA el store con el
    // `hero_key` de la petición, así que el pin del vecino no se puede tocar
    // desde aquí.
    await post("/assets/character", personaje(HERO_OTRO, { hero: fila("Nuño, carbonero") }));
    const conRefAjeno = await post(
      "/assets/character",
      personaje(HERO, {
        sheets: [{ hash: SHEET_OTRO, ...fila("Blas", { character_ref: HERO_OTRO }) }],
      }),
    );
    const filaAjena = (await getJson(`/assets/by_hash/${SHEET_OTRO}`)).body?.matches?.[0];
    expect(
      "un character_ref ajeno en el extra no cuela: el store estampa el de la petición",
      conRefAjeno.status === 200 && filaAjena?.extra?.character_ref === HERO,
      `status=${conRefAjeno.status} ${JSON.stringify(filaAjena?.extra)}`,
    );
    const delOtro = await fetch(`${base}/assets/pin/${encodeURIComponent(`character:${HERO_OTRO}`)}`, {
      method: "DELETE",
    });
    const cuerpoOtro = await delOtro.json().catch(() => null);
    expect(
      "y soltar al OTRO personaje se lleva lo suyo y solo lo suyo (removed=1)",
      cuerpoOtro?.removed === 1,
      JSON.stringify(cuerpoOtro),
    );

    // ── 5 · el cache-hit repetido no duplica ──────────────────────────────
    for (let i = 0; i < 3; i++) {
      await post(
        "/assets/character",
        personaje(HERO, { sheets: [{ hash: SHEET, ...fila("Blas, el tabernero") }] }),
      );
    }
    const sheets = (await getJson("/assets?asset_type=sprite_sheet&limit=50")).body?.assets ?? [];
    expect(
      "el cache-hit se apunta en CADA servida y no duplica: una fila por kind",
      sheets.filter((f) => f.hash === SHEET).length === 1,
      JSON.stringify(sheets).slice(0, 240),
    );

    // ── 5 bis · se sueltan JUNTOS ─────────────────────────────────────────
    const del = await fetch(`${base}/assets/pin/${encodeURIComponent(REF)}`, { method: "DELETE" });
    const cuerpoDel = await del.json().catch(() => null);
    expect(
      `un solo DELETE /assets/pin/${REF} retira hero Y frames (removed=3)`,
      del.status === 200 && cuerpoDel?.removed === 3,
      `status=${del.status} ${JSON.stringify(cuerpoDel)}`,
    );

    // ── 6 · el prune, con los tres layouts ────────────────────────────────
    console.log("");
    const p = correrPrune(join(tmp, "cache"));
    expect(
      "prune sin pins: borra el DIRECTORIO de la surface, el DIRECTORIO del sheet y el FICHERO del hero",
      p.podados === 3 && p.surfaceBorrada && p.sheetBorrado && p.heroBorrado,
      JSON.stringify(p).slice(0, 300),
    );
    expect(
      "y la carpeta heroes/ sigue en pie con el hero que no se podó",
      p.carpetaHeroesEnPie && p.heroVecinoIntacto,
      JSON.stringify(p).slice(0, 300),
    );
    expect(
      "prune con el pin del personaje: no toca ni el hero ni sus frames",
      p.podadosConPin === 0 && p.sheetSigue && p.heroSigue,
      JSON.stringify(p).slice(0, 300),
    );
    expect(
      "un type SIN productor en el índice es fail-loud, no un salto callado",
      /type "texture"/.test(String(p.typeDesconocido)) && /zzz/.test(String(p.typeDesconocido)),
      String(p.typeDesconocido).slice(0, 200),
    );
    expect(
      "y la fila ajena NO se desindexa: el blob se queda en disco, así que la fila también",
      p.filaAjenaSigue === 1,
      `filas=${p.filaAjenaSigue}`,
    );

    // Y por qué la forma del hash es un candado y no una manía: con la fila
    // plantada a mano (la que el zod ya rechaza), el prune se lleva la carpeta
    // entera. Es la medida que justifica `HASH_DE_ASSET`, y se deja corriendo
    // para que si alguien afloja el regex se vea lo que compra.
    expect(
      "el borrado del prune es recursivo: por eso el hash tiene forma en el registro",
      typeof p.heroesTrasElHashHeroes === "string",
      `con una fila 'heroes' plantada a mano quedaron ${p.heroesTrasElHashHeroes} hero-shots — ` +
        `si esto deja de pasar, el prune cambió y el regex del hash quizá ya no haga falta`,
    );
  } catch (err) {
    console.log(`\n⊘ SIN MEDIR — ${String(err?.message ?? err)}`);
    return 2;
  } finally {
    if (store) store.hijo.kill("SIGTERM");
    rmSync(tmp, { recursive: true, force: true });
  }

  expect(
    "el índice del CHECKOUT no se ha tocado en toda la corrida",
    fotoDelIndice() === antes,
    `antes=${antes} después=${fotoDelIndice()}`,
  );

  if (fallos.length) {
    console.log(`\nROJO — ${fallos.length} comprobación(es) fallaron.`);
    return 1;
  }
  console.log("\nVERDE — el arte de personaje entra con procedencia y pineado, y hero y frames se sueltan juntos.");
  return 0;
}

process.exitCode = await main();
