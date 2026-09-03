#!/usr/bin/env node
/** EL ÍNDICE DEL STORE SE PRUEBA SIN EL DEL CHECKOUT (QA de T8 PR-A: #391).
 *
 *  El asset-store tiene UN camino de fallo en el arranque —negarse a servir un
 *  índice con kinds sin productor (`services/asset-store/kinds-con-productor.ts`)— y
 *  hasta esta PR no se podía ejercer sin la DB del checkout: `loadAssetStoreConfig`
 *  solo admitía override para el PUERTO, así que `server.ts` abría siempre
 *  `cache/manifest.sqlite3`. El QA de T4 tuvo que exportar el árbol entero al
 *  scratchpad, plantar la fila ajena en la copia y arrancar desde allí. Ese
 *  workaround ES el defecto que cierra `NEFAN_MANIFEST_DB`.
 *
 *  Este guion es su candado, y lo mide donde importa: arrancando el ENTRY REAL
 *  (`services/asset-store/server.ts`, el mismo que lanza `start.sh:434`) como
 *  proceso hijo, contra índices de usar y tirar, y mirando con qué sale.
 *
 *  Lo que se afirma:
 *   1 · NEGATIVO — índice temporal con una fila `texture/albedo`: el hijo sale
 *       con 1, su stderr dice `kinds SIN productor`, nombra el kind que sobra
 *       con su recuento y el script de purga, NOMBRA LA RUTA TEMPORAL y no
 *       llega a escuchar. Lo de la ruta no es adorno: sin ello un `exit 1`
 *       causado por el índice del CHECKOUT (si estuviera sucio) pasaría por
 *       verde — medido el 2026-09-03, es el único assert que distingue los dos.
 *   2 · POSITIVO — índice temporal limpio: arranca, la línea de arranque nombra
 *       la DB temporal con su recuento, y `/health` CONTESTA por HTTP desde
 *       otro proceso con ese mismo recuento. El test de `npm test` se queda en
 *       «imprimió listening»; aquí se comprueba que además sirve, que es lo que
 *       ve quien la usa.
 *   3 · BLANCO — `NEFAN_MANIFEST_DB="  "` (dos espacios) sale con 1 nombrando la
 *       variable Y NO DEJA BASURA en la raíz del repo. Sin la guarda (medido)
 *       `resolve(raíz, "  ")` creaba un fichero llamado dos espacios y el store
 *       arrancaba sobre ese índice vacío; `""` moría con «unable to open
 *       database file», que no nombra la causa.
 *   4 · El índice del CHECKOUT no se abre ni se toca en ninguno de los tres
 *       casos: mismo tamaño y misma mtime al empezar y al terminar (o sigue sin
 *       existir, que también vale).
 *
 *  EN NEGATIVO (probado el 2026-09-03 al escribirlo): revirtiendo `config.ts` a
 *  `dbPath: abs(ai.manifest_db)` caen el 1 (por la ruta temporal), el 2 y el 3;
 *  quitando el `process.exit(1)` de `server.ts` cae el 1; quitando la guarda del
 *  valor en blanco cae el 3. Repetido tras mudarlo aquí: 17 comprobaciones, y
 *  con el override revertido caen 12 con salida 1 (verde = 0, sin medir = 2).
 *
 *  CERO CRÉDITOS y cero vecinos molestados: no toca el motor ni la página, cada
 *  caso corre contra su propio `mkdtemp`, el puerto lo elige el kernel (nunca
 *  un número del catálogo) y el hijo se mata por SU PID, jamás por puerto ni
 *  por nombre.
 *
 *  Vive FUERA de `qa/guiones/` por la misma razón que `sprites-sin-servicio.mjs`
 *  y `presets.mjs`: el runner levanta UN stack con navegador y se lo pasa a
 *  todos los guiones, y esto no toca la página — en `guiones/` cada corrida de
 *  la batería pagaría un Chromium para un check que arranca y para un servicio.
 *
 *  Uso:  node qa/el-indice-del-store-se-prueba-sin-el-del-checkout.mjs
 *
 *  Salida: 0 todo verde · 1 alguna comprobación en rojo · 2 no llegó a medir.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(RAIZ, "nefan-core");
const SERVER = join(CORE, "services", "asset-store", "server.ts");
const INDICE_DEL_CHECKOUT = join(RAIZ, "cache", "manifest.sqlite3");

const ENV_MANIFEST_DB = "NEFAN_MANIFEST_DB";
const ENV_PUERTO = "NEFAN_ASSET_STORE_PORT";
const LINEA_ESCUCHANDO = /listening on/;

/** Un puerto que el kernel dice que está libre AHORA. No se escribe ningún
 *  número: los del catálogo son de otros servicios (y puede haber otro agente
 *  con su stack arriba). */
function puertoLibre() {
  return new Promise((cumplir, fallar) => {
    const s = createServer();
    s.once("error", fallar);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => cumplir(port));
    });
  });
}

/** Foto del índice del checkout, para comparar al final. `null` = no existe,
 *  que es un estado legítimo (un clon recién hecho) y hay que distinguirlo. */
function fotoDelIndice() {
  if (!existsSync(INDICE_DEL_CHECKOUT)) return null;
  const st = statSync(INDICE_DEL_CHECKOUT);
  return `${st.size}@${st.mtimeMs}`;
}

/** Arranca el entry REAL como hijo y espera a que muera. En cuanto dice que
 *  escucha se le llama (si hay algo que llamar) y se le manda SIGTERM: para el
 *  positivo es la única forma de pararlo, y para los negativos hace que un
 *  arranque que NO debía ocurrir se corte en el acto en vez de agotar la red de
 *  seguridad. */
function arrancar(env, alEscuchar) {
  return new Promise((cumplir, fallar) => {
    const hijo = spawn(process.execPath, ["--import", "tsx", SERVER], {
      cwd: CORE,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let extra = null;
    let disparado = false;
    const guardia = setTimeout(() => hijo.kill("SIGKILL"), 60_000);
    hijo.stdout.on("data", async (b) => {
      stdout += b.toString();
      if (disparado || !LINEA_ESCUCHANDO.test(stdout)) return;
      disparado = true;
      if (alEscuchar) extra = await alEscuchar().catch((e) => ({ error: String(e?.message ?? e) }));
      hijo.kill("SIGTERM");
    });
    hijo.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    hijo.on("error", fallar);
    hijo.on("close", (code, signal) => {
      clearTimeout(guardia);
      cumplir({ code, signal, stdout, stderr, extra });
    });
  });
}

/** Una DB temporal con las filas que se pidan, creada con el ManifestDb REAL
 *  (su esquema es el que va a leer el hijo). Se cierra antes de devolverla: el
 *  índice lo abre un proceso a la vez. */
function sembrar(dir, cuerpo) {
  const ruta = join(dir, "manifest.sqlite3");
  const guion = `import { ManifestDb } from "./services/asset-store/manifest-db.ts";
const db = new ManifestDb(${JSON.stringify(ruta)});
${cuerpo}
db.close();`;
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", guion], {
    cwd: CORE,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`no pude sembrar ${ruta}: ${r.stderr}`);
  return ruta;
}

const fallos = [];

/** El mismo cable que da el runner a un guion, aquí en local: título, condición
 *  y el DETALLE que se enseña cuando falla — un rojo que no dice qué vio cuesta
 *  lo mismo de investigar que uno falso. */
function expect(titulo, cond, detalle) {
  if (cond) {
    console.log(`  ✔ ${titulo}`);
    return;
  }
  console.log(`  ✘ ${titulo}${detalle === undefined ? "" : `\n      ${detalle}`}`);
  fallos.push(titulo);
}

async function main() {
  if (!existsSync(SERVER)) {
    console.log(`⊘ SIN MEDIR — no está el entry del asset-store en ${SERVER}`);
    return 2;
  }

  const antes = fotoDelIndice();
  const raizAntes = new Set(readdirSync(RAIZ));
  const tmp = mkdtempSync(join(tmpdir(), "qa70-store-"));

  try {
    // ── 1 · NEGATIVO: una fila de un kind sin productor ────────────────────
    // El kind `qa_centinela` no existe ni puede existir en el índice de un
    // checkout: es lo que distingue «salió 1 por MI DB» de «salió 1 porque la
    // del checkout estaba sucia». Sin un discriminante así, el negativo daría
    // verde con el override roto en cuanto `cache/manifest.sqlite3` tuviera una
    // fila ajena — medido el 2026-09-03, pasa exactamente eso.
    const sucia = sembrar(tmp, `
db.register({ hash: "s1", type: "surface", subtype: "surface", prompt: "yeso", size_bytes: 10 });
db.importEntry({ hash: "t1", type: "texture", subtype: "albedo", prompt: "piedra musgosa",
  created_at: "2026-01-01T00:00:00.000Z", size_bytes: 5000000, extra: {} });
db.importEntry({ hash: "q1", type: "qa_centinela", subtype: "solo-de-este-guion", prompt: "centinela",
  created_at: "2026-01-01T00:00:00.000Z", size_bytes: 1, extra: {} });`);

    const neg = await arrancar({ [ENV_MANIFEST_DB]: sucia, [ENV_PUERTO]: "0" });
    expect("1 · el índice ajeno no arranca: exit 1", neg.code === 1, `code=${neg.code} signal=${neg.signal}`);
    expect("1 · dice que hay kinds SIN productor", /kinds SIN productor/.test(neg.stderr), neg.stderr.slice(0, 200));
    expect("1 · nombra el kind que sobra y cuántas filas", /texture \(albedo 1\)/.test(neg.stderr), neg.stderr.slice(0, 200));
    expect(
      "1 · dice con qué script se purga",
      neg.stderr.includes("scripts/manifest-kinds-con-productor.ts"),
      neg.stderr.slice(0, 200),
    );
    expect(
      "1 · el veredicto es sobre la DB de la VARIABLE (kind centinela que ningún checkout tiene)",
      /qa_centinela \(solo-de-este-guion 1\)/.test(neg.stderr),
      neg.stderr.slice(0, 300),
    );
    expect("1 · muere antes de escuchar", !LINEA_ESCUCHANDO.test(neg.stdout), neg.stdout.slice(0, 200));

    // ── 2 · POSITIVO: índice limpio, y además SIRVE ────────────────────────
    const dirLimpio = mkdtempSync(join(tmp, "limpia-"));
    const limpia = sembrar(dirLimpio, `
db.register({ hash: "s1", type: "surface", subtype: "surface", prompt: "adoquín", size_bytes: 42 });`);
    const puerto = await puertoLibre();

    const pos = await arrancar({ [ENV_MANIFEST_DB]: limpia, [ENV_PUERTO]: String(puerto) }, async () => {
      const r = await fetch(`http://127.0.0.1:${puerto}/health`, { signal: AbortSignal.timeout(5000) });
      return { status: r.status, cuerpo: await r.json() };
    });

    expect(
      "2 · la línea de arranque nombra la DB temporal con su recuento",
      pos.stdout.includes(`índice ${limpia} (1 entradas, 42 bytes)`),
      pos.stdout.slice(0, 300),
    );
    expect(
      "2 · el índice del checkout no aparece por ningún lado",
      !/cache[/\\]manifest\.sqlite3/.test(pos.stdout + pos.stderr),
      pos.stdout.slice(0, 300),
    );
    expect("2 · llegó a escuchar", LINEA_ESCUCHANDO.test(pos.stdout), pos.stdout.slice(0, 300));
    expect(
      "2 · /health CONTESTA por HTTP desde otro proceso",
      pos.extra?.status === 200,
      JSON.stringify(pos.extra),
    );
    expect(
      "2 · y lo que sirve es el índice de la variable (1 entrada, 42 bytes)",
      pos.extra?.cuerpo?.total_count === 1 && pos.extra?.cuerpo?.total_bytes === 42,
      JSON.stringify(pos.extra?.cuerpo),
    );
    expect("2 · baja por su manejador de SIGTERM, no a lo bruto", pos.code === 0 && pos.signal === null,
      `code=${pos.code} signal=${pos.signal}`);

    // ── 3 · BLANCO: variable puesta pero vacía ─────────────────────────────
    const blanco = await arrancar({ [ENV_MANIFEST_DB]: "  ", [ENV_PUERTO]: "0" });
    expect("3 · con la variable en blanco no arranca: exit 1", blanco.code === 1, `code=${blanco.code}`);
    expect(
      "3 · y dice cuál es la variable mal puesta",
      new RegExp(`${ENV_MANIFEST_DB} está puesta pero vacía`).test(blanco.stderr),
      blanco.stderr.slice(0, 300),
    );
    expect("3 · no llegó a escuchar", !LINEA_ESCUCHANDO.test(blanco.stdout), blanco.stdout.slice(0, 200));
    const raizDespues = new Set(readdirSync(RAIZ));
    const nuevos = [...raizDespues].filter((f) => !raizAntes.has(f));
    expect(
      "3 · no deja basura en la raíz del repo (sin la guarda creaba un fichero llamado dos espacios)",
      nuevos.length === 0,
      `aparecieron: ${JSON.stringify(nuevos)}`,
    );

    // ── 4 · el índice del checkout, intacto ────────────────────────────────
    const despues = fotoDelIndice();
    expect(
      "4 · el índice del checkout no se ha tocado en ninguno de los tres casos",
      antes === despues,
      `antes=${antes} después=${despues}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("");
  if (fallos.length) {
    console.log(`ROJO — ${fallos.length} comprobación(es) fallaron.`);
    return 1;
  }
  console.log("VERDE — el fail-loud del asset-store se ejerce sin tocar el índice del checkout.");
  return 0;
}

let code = 2;
try {
  code = await main();
} catch (e) {
  console.log(`⊘ SIN MEDIR — ${e?.stack ?? e}`);
}
process.exit(code);
