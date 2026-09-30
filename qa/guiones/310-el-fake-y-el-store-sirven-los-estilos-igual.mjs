/** ¿Sirven el asset-store y el motor falso del bench los estilos IGUAL? (QA de la tanda BR)
 *
 *  POR QUÉ EXISTE. #280 sacó a `services/asset-store/http-wire.ts` la lectura
 *  de `GET /styles/{style_id}/{file}` para que el fake del bench
 *  (`labs/narrative/fake-ai-server.ts`) dejara de copiarla a mano: se había
 *  desviado en cuatro casos. La tanda BR la reescribió sobre `AssetStoreApi`
 *  (`getStyleFile` + `getStyleRoleFile`), y ahora hay DOS caminos que tienen
 *  que contestar lo mismo: el store enruta estilos por su tabla principal
 *  (`casarRuta` + `RUTAS`) y el fake por `matchStylesRoute`, que usa una
 *  SUBTABLA de dos entradas. Los tests de `test/asset-store.test.ts` miden
 *  cada función por separado; nadie miraba los dos PROCESOS contestando a la
 *  misma URL. Si alguien quita una ruta de la subtabla, el store sigue
 *  sirviendo la carpeta de rol y el título del preset `e2e-sin-creditos`
 *  pierde las refs del pack sin que ningún unitario lo cuente como desvío
 *  entre los dos.
 *
 *  CÓMO. Arranca el asset-store real (`services/asset-store/server.ts`, índice
 *  de usar y tirar por `NEFAN_MANIFEST_DB`) y el fake, cada uno en un puerto
 *  libre del kernel, y les pide el mismo corpus:
 *   · SERVIDAS: la portada y un fichero de CADA carpeta de rol de CADA pack del
 *     directorio de estilos, más las rarezas del cable (`//` interior, barra
 *     final, fichero inexistente, pack inexistente, escape de barra, `..`
 *     codificado). Status, Content-Type, Content-Length y sha1 del cuerpo,
 *     idénticos.
 *   · SIN RUTA (5 segmentos, 2, `..` que sale de /styles): 404 en los dos. El
 *     cuerpo del 404 NO se compara: el fake tiene el suyo, y eso es de él.
 *  Luego el SABOTAJE: quita `getStyleRoleFile` de la subtabla del fake, lo
 *  vuelve a arrancar y exige que la paridad se ponga ROJA exactamente en las
 *  URL de carpeta de rol, y solo en ellas. Restaura y comprueba byte a byte.
 *
 *  Y un segundo sabotaje, que empezó como agujero (A1 en la QA de la tanda
 *  BR): sin el `db.touch` de `getBlob` (`GET /cache/surface/{hash}` refresca el
 *  LRU del prune), `test/asset-store.test.ts` tiene que salir ROJO. Salía verde,
 *  también en la base 0afb76c3; lo cerró la vuelta de QA de la misma tanda.
 *
 *  ── AGUJEROS CONOCIDOS (medidos en la QA de la tanda BR) ───────────────────
 *   · A2 — los `params` de cada handler de `RUTAS` son `Record<string,string>`:
 *     un handler que lea `params.hash` donde la plantilla dice `{key}` COMPILA.
 *     La garantía de tipos cubre «endpoint sin handler / handler sin endpoint»,
 *     no el nombre de los parámetros. Quien lo caza hoy: los tests HTTP.
 *  El día que alguien lo cierre, este guion se pone rojo con «YA NO ES UN
 *  AGUJERO» y hay que subirlo a los sabotajes.
 *
 *      node qa/run.mjs 310
 *      node qa/run.mjs --sin-navegador
 *
 *  AVISO: escribe en el árbol de trabajo (`http-wire.ts`, `rutas.ts`). Se
 *  niega a arrancar si ya vienen sucios, restaura en `finally` y con Ctrl+C,
 *  y toma el turno de candados. Cero créditos: ni motor ni proveedor.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { esperarPuertoArriba } from "../lib/puertos.mjs";
import { turnoDeCandados } from "../lib/turno-exclusivo.mjs";

export const sinMotor = "arranca el asset-store y el motor falso en puertos libres y les pide ficheros de estilo; no abre partida";
export const sinNavegador = "compara dos servidores HTTP por la línea de órdenes; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const WIRE = join(CORE, "services", "asset-store", "http-wire.ts");
const RUTAS = join(CORE, "services", "asset-store", "rutas.ts");
const ESTILOS = join(CORE, "data", "styles");
const ROLES = ["surfaces", "faces", "characters"];

const SUBTABLA_COMPLETA = "  getStyleRoleFile: AssetStoreApi.getStyleRoleFile,\n} as const;";
const TOUCH_DE_GETBLOB = "if (result.touched) db.touch(result.touched);";
const PARAM_DE_HERO = "readSpriteHero(blobDirs, params.key)";

function puertoLibre() {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

function pedir(port, ruta) {
  return new Promise((ok) => {
    const r = http.request({ host: "127.0.0.1", port, method: "GET", path: ruta }, (res) => {
      const trozos = [];
      res.on("data", (c) => trozos.push(c));
      res.on("end", () => {
        const cuerpo = Buffer.concat(trozos);
        ok({
          status: res.statusCode,
          tipo: res.headers["content-type"] ?? "",
          largo: res.headers["content-length"] ?? "",
          sha: createHash("sha1").update(cuerpo).digest("hex").slice(0, 12),
        });
      });
    });
    r.on("error", (e) => ok({ status: `ERR ${e.code}`, tipo: "", largo: "", sha: "" }));
    r.end();
  });
}

/** Arriba = el puerto escucha (la espera por estado de `qa/lib/puertos.mjs`,
 *  que además falla loud si el proceso muere) Y `/health` contesta 200. */
async function esperarHealth(port, hijo, plazoMs) {
  await esperarPuertoArriba(port, {
    maxMs: plazoMs,
    siMuere: () => (hijo.exitCode !== null ? `salió con ${hijo.exitCode}` : null),
  });
  return (await pedir(port, "/health")).status === 200;
}

/** `detached` + kill del GRUPO: `tsx` deja hijos (lección de fake-enruta-por-pathname). */
async function arrancar(argv, env) {
  const port = await puertoLibre();
  const hijo = spawn(process.execPath, ["--import", "tsx", ...argv], {
    cwd: CORE,
    env: { ...process.env, ...env(port) },
    stdio: ["ignore", "ignore", "pipe"],
    detached: true,
  });
  let err = "";
  hijo.stderr.on("data", (d) => (err += d));
  let vivo = false;
  try {
    vivo = await esperarHealth(port, hijo, 30_000);
  } catch (e) {
    // No arrancó: el motivo viaja en `err()`, que es lo que el guion enseña.
    err += `\n${e.message}`;
  }
  return { port, vivo, err: () => err.slice(-400), parar: () => { try { process.kill(-hijo.pid, "SIGKILL"); } catch { /* ya muerto: nada que parar */ } } };
}

function corpus() {
  const servidas = [];
  for (const pack of readdirSync(ESTILOS)) {
    const dir = join(ESTILOS, pack);
    if (!statSync(dir).isDirectory() || pack.startsWith("_")) continue;
    servidas.push({ url: `/styles/${pack}/style.json`, rol: false });
    for (const rol of ROLES) {
      // Un pack sin esa carpeta no aporta URL de rol: el loader lo rechazaría, y aquí solo se cuenta.
      const ficheros = existsSync(join(dir, rol)) ? readdirSync(join(dir, rol)).filter((f) => /\.(jpg|jpeg|png|webp)$/.test(f)) : [];
      if (ficheros[0]) servidas.push({ url: `/styles/${pack}/${rol}/${ficheros[0]}`, rol: true });
    }
  }
  servidas.push(
    { url: "/styles/medievo_crudo/cover.jpg", rol: false },
    { url: "/styles/medievo_crudo/cover.jpg/", rol: false },
    { url: "/styles//medievo_crudo/cover.jpg", rol: false },
    { url: "/styles/medievo_crudo//faces/fachada.jpg", rol: true },
    { url: "/styles/medievo_crudo/faces/no_existe.jpg", rol: true },
    { url: "/styles/no_existe/cover.jpg", rol: false },
    { url: "/styles/medievo_crudo/faces%2Ffachada.jpg", rol: false },
    { url: "/styles/..%2f/x", rol: false },
  );
  const sinRuta = ["/styles/medievo_crudo/faces/x/y.jpg", "/styles/medievo_crudo", "/styles/medievo_crudo/../README.md", "/styles/a/b/c/d/e"];
  return { servidas, sinRuta };
}

const huella = (r) => `${r.status} ${r.tipo} ${r.largo} ${r.sha}`;

async function paridad(storePort, fakePort, servidas) {
  const distintas = [];
  for (const { url, rol } of servidas) {
    const [a, b] = await Promise.all([pedir(storePort, url), pedir(fakePort, url)]);
    if (huella(a) !== huella(b)) distintas.push({ url, rol, store: huella(a), fake: huella(b) });
  }
  return distintas;
}

function testsDelStore() {
  const r = spawnSync(process.execPath, ["--import", "tsx", "--test", "test/asset-store.test.ts"], { cwd: CORE, encoding: "utf8", timeout: 180_000 });
  return r.status;
}

function tscDelCore() {
  const r = spawnSync("npx", ["tsc", "-p", "tsconfig.json", "--noEmit", "--composite", "false", "--declaration", "false", "--incremental", "false"], { cwd: CORE, encoding: "utf8", timeout: 180_000 });
  return { status: r.status, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

export default async function (ctx) {
  turnoDeCandados("el-fake-y-el-store-sirven-los-estilos-igual");
  const sucios = spawnSync("git", ["status", "--porcelain", "--", WIRE, RUTAS], { cwd: RAIZ, encoding: "utf8" }).stdout.trim();
  ctx.expect("http-wire.ts y rutas.ts vienen limpios (si no, no se pueden devolver)", sucios === "", sucios);
  if (sucios !== "") throw new Error(`árbol sucio, me niego a sabotear: ${sucios}`);

  const wireOriginal = readFileSync(WIRE, "utf8");
  const rutasOriginal = readFileSync(RUTAS, "utf8");
  const restaura = () => {
    writeFileSync(WIRE, wireOriginal);
    writeFileSync(RUTAS, rutasOriginal);
  };
  for (const [señal, codigo] of [["SIGINT", 130], ["SIGTERM", 143]]) process.on(señal, () => { restaura(); process.exit(codigo); });

  const tmp = mkdtempSync(join(tmpdir(), "nefan-qa-310-"));
  const vivos = [];
  try {
    const store = await arrancar(["services/asset-store/server.ts"], (p) => ({ NEFAN_ASSET_STORE_PORT: String(p), NEFAN_MANIFEST_DB: join(tmp, "manifest.sqlite3") }));
    vivos.push(store);
    const fakeEnv = (p) => ({ PORT: String(p), STATE_API: "http://127.0.0.1:9" });
    let fake = await arrancar(["../labs/narrative/fake-ai-server.ts"], fakeEnv);
    vivos.push(fake);
    ctx.expect("el asset-store arranca y contesta /health", store.vivo, store.err());
    ctx.expect("el motor falso arranca y contesta /health", fake.vivo, fake.err());
    if (!store.vivo || !fake.vivo) throw new Error("sin los dos servidores no hay paridad que medir");

    const { servidas, sinRuta } = corpus();
    const deRol = servidas.filter((s) => s.rol).length;
    ctx.expect(`el corpus tiene URL de carpeta de rol que medir (${deRol} de ${servidas.length})`, deRol >= 3, "¿cambió el formato de los packs?");
    const doscientos = (await Promise.all(servidas.map((s) => pedir(store.port, s.url)))).filter((r) => r.status === 200).length;
    ctx.expect(`el store SIRVE de verdad la mayoría del corpus (${doscientos} de ${servidas.length} con 200)`, doscientos >= servidas.length - 5, "¿se quedó sin packs?");

    // ── Paridad en verde ────────────────────────────────────────────────────
    const distintas = await paridad(store.port, fake.port, servidas);
    ctx.expect(`store y fake contestan IDÉNTICO (status, tipo, largo, sha1) en las ${servidas.length} URL servidas`, distintas.length === 0, JSON.stringify(distintas.slice(0, 3)));
    for (const url of sinRuta) {
      const [a, b] = await Promise.all([pedir(store.port, url), pedir(fake.port, url)]);
      ctx.expect(`${url} → 404 en los dos`, a.status === 404 && b.status === 404, `store ${a.status} · fake ${b.status}`);
    }

    // ── SABOTAJE: la subtabla del fake pierde la carpeta de rol ─────────────
    ctx.expect("http-wire.ts sigue declarando la subtabla donde este guion la busca", wireOriginal.includes(SUBTABLA_COMPLETA), "¿reescrita? actualiza SUBTABLA_COMPLETA");
    writeFileSync(WIRE, wireOriginal.replace(SUBTABLA_COMPLETA, "} as const;"));
    fake.parar();
    fake = await arrancar(["../labs/narrative/fake-ai-server.ts"], fakeEnv);
    vivos.push(fake);
    writeFileSync(WIRE, wireOriginal);
    ctx.expect("SABOTAJE · el fake arranca con la subtabla mutilada", fake.vivo, fake.err());
    const rotas = await paridad(store.port, fake.port, servidas);
    const rotasDeRol = rotas.filter((d) => d.rol).length;
    const rotasSinRol = rotas.filter((d) => !d.rol);
    ctx.expect(`SABOTAJE · la paridad se pone ROJA en las URL de rol (${rotasDeRol} de ${deRol})`, rotasDeRol >= deRol - 1 && rotasDeRol > 0, JSON.stringify(rotas.slice(0, 2)));
    ctx.expect("SABOTAJE · …y SOLO en ellas (la portada y el style.json siguen iguales)", rotasSinRol.length === 0, JSON.stringify(rotasSinRol.slice(0, 2)));

    // ── SABOTAJE: getBlob sin refrescar el LRU (era el agujero A1) ──────────
    ctx.expect("SABOTAJE · rutas.ts sigue tocando el LRU en getBlob donde este guion lo busca", rutasOriginal.includes(TOUCH_DE_GETBLOB), "¿reescrito? actualiza TOUCH_DE_GETBLOB");
    writeFileSync(RUTAS, rutasOriginal.replace(TOUCH_DE_GETBLOB, ""));
    const sinTouch = testsDelStore();
    writeFileSync(RUTAS, rutasOriginal);
    ctx.expect("SABOTAJE · sin el db.touch de getBlob, test/asset-store.test.ts sale ROJO", sinTouch !== 0 && sinTouch !== null, `status ${sinTouch}`);

    // ── AGUJERO CONOCIDO: hoy sale verde; rojo = alguien lo cerró ───────────

    ctx.expect("A2 · rutas.ts sigue leyendo params.key en getSpriteHero donde este guion lo busca", rutasOriginal.includes(PARAM_DE_HERO), "¿reescrito? actualiza PARAM_DE_HERO");
    writeFileSync(RUTAS, rutasOriginal.replace(PARAM_DE_HERO, "readSpriteHero(blobDirs, params.hash)"));
    const paramMalo = tscDelCore();
    writeFileSync(RUTAS, rutasOriginal);
    ctx.expect("A2 · AGUJERO: un handler que lee un {param} que su plantilla no declara COMPILA (si no compila: YA NO ES UN AGUJERO)", paramMalo.status === 0, paramMalo.salida.slice(-300));
    // Control de A2: el mismo tsc SÍ se pone rojo con un handler sobrante, o A2 no mediría nada.
    writeFileSync(RUTAS, rutasOriginal.replace("  health: ", '  sobrante: () => ({ kind: "text", status: 200, body: "" }),\n  health: '));
    const sobrante = tscDelCore();
    writeFileSync(RUTAS, rutasOriginal);
    ctx.expect("A2 · control: con un handler sobrante el mismo tsc SÍ falla (TS2353)", sobrante.status !== 0 && sobrante.salida.includes("sobrante"), sobrante.salida.slice(-300));
  } finally {
    for (const v of vivos) v.parar();
    restaura();
    rmSync(tmp, { recursive: true, force: true });
  }

  ctx.expect("http-wire.ts queda como estaba, byte a byte", readFileSync(WIRE, "utf8") === wireOriginal, "NO SE RESTAURÓ: mira git status");
  ctx.expect("rutas.ts queda como estaba, byte a byte", readFileSync(RUTAS, "utf8") === rutasOriginal, "NO SE RESTAURÓ: mira git status");
}
