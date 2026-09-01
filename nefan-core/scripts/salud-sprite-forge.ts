/** El preflight de sprite-forge: qué se puede hacer de verdad con el servicio
 *  que acaba de arrancar, dicho en UNA línea.
 *
 *  POR QUÉ EXISTE (#367). `start.sh` comprobaba la salud del servicio con
 *  `curl -sf …/catalog`: un 200 y ✅. Pero `GET /catalog` responde 200 con la
 *  mitad de repintado APAGADA —es su diseño, sirve hojas base gratis— así que
 *  el stack arrancaba en verde con el repintado muerto y el jugador lo
 *  descubría tres saltos después, con un mundo entero de maniquíes `y_bot`. La
 *  señal existía (`skin.enabled` y su `skin.reason`, contrato en
 *  `src/contracts/sprite-forge.ts`); lo que faltaba era mirarla.
 *
 *  AVISA, NO FALLA (decisión del usuario, 2026-09-01). Con el repintado muerto
 *  o el repo sin clonar, `play` y `cliente-web` ARRANCAN: sprite-forge vive en
 *  otro repositorio, es opcional y su dependencia pesada (`rembg`, ~460 MB de
 *  onnxruntime) no está declarada en ningún `requirements` de ne-fan. Lo que
 *  hacía urgente bloquear era el dinero —el servicio cobraba la imagen y
 *  fallaba después al recortar el fondo— y eso se arregló en su repo: hoy
 *  `/skins` se niega con 503 ANTES de pagar. Sin fuga de dinero no hay motivo
 *  para impedir jugar; el riesgo asumido es que un aviso se ignore.
 *
 *  EL REPARTO —sondeo fuera, decisión dentro— es el mismo de
 *  `qa/lib/presets-clasifica.mjs`, y por la misma razón: probar los cuatro
 *  veredictos arrancando el servicio de verdad exige el repo hermano, Chrome y
 *  90 s por caso. Con el sondeo como DATO de entrada, los cuatro casos se
 *  escriben en cuatro asertos y corren en `npm test`.
 *
 *  Uso (lo llama `start.sh`; siempre sale con 0, la decisión es del launcher):
 *    npx tsx nefan-core/scripts/salud-sprite-forge.ts --url <catalog> [--espera 90]
 *    npx tsx nefan-core/scripts/salud-sprite-forge.ts --sin-repo <dir>
 */
import { SpriteCatalogSchema } from "../src/contracts/sprite-forge.js";

/** `ok` = el repintado está disponible de verdad. `aviso` = el stack arranca,
 *  pero hay algo que el jugador va a notar y tiene que leer AHORA. No hay un
 *  tercer nivel «error» a propósito: nada de lo que mira este preflight
 *  impide jugar. */
export type NivelDeSalud = "ok" | "aviso";

export interface VeredictoDeForge {
  nivel: NivelDeSalud;
  /** La línea, ya redactada y sin color: una sola, con la causa dentro. */
  linea: string;
}

/** Lo que se ha podido observar del servicio. Es la ENTRADA de la decisión, y
 *  viaja como unión discriminada para que no exista el estado «no sé si
 *  respondió pero aquí tienes un json». */
export type SondeoDeForge =
  /** `GET /catalog` respondió; `json` es lo que trajo, sin validar. */
  | { tipo: "catalogo"; json: unknown }
  /** El repo hermano no está clonado: el launcher ni intentó arrancarlo. */
  | { tipo: "sin-repo"; dir: string }
  /** Arrancó (o no) pero `/catalog` no contestó dentro del plazo. */
  | { tipo: "sin-respuesta"; url: string; segundos: number; detalle: string };

/** El veredicto. Pura: ni red, ni reloj, ni proceso.
 *
 *  Los cuatro casos son los cuatro modos de fallo REALES de esta frontera, y
 *  cada uno lleva su causa en la línea porque el siguiente sitio donde el
 *  jugador se enteraría es la pantalla, con todos los NPC en maniquí. */
export function veredictoDeForge(sondeo: SondeoDeForge): VeredictoDeForge {
  if (sondeo.tipo === "sin-repo") {
    return {
      nivel: "aviso",
      linea:
        `sprite-forge no está en ${sondeo.dir} — los personajes salen en maniquí y_bot. ` +
        `Clónalo o define NEFAN_SPRITE_FORGE_DIR.`,
    };
  }
  if (sondeo.tipo === "sin-respuesta") {
    return {
      nivel: "aviso",
      linea:
        `sprite-forge no respondió a ${sondeo.url} en ${sondeo.segundos} s (${sondeo.detalle}) — ` +
        `los personajes salen en maniquí y_bot. Mira el log del servicio.`,
    };
  }

  const parsed = SpriteCatalogSchema.safeParse(sondeo.json);
  if (!parsed.success) {
    // Un catálogo que no cumple el contrato NO se interpreta a ojo: si el
    // shape cambió, cualquier lectura de `skin.enabled` es una adivinanza.
    const primero = parsed.error.issues[0];
    const donde = primero?.path.join(".") || "(raíz)";
    return {
      nivel: "aviso",
      linea:
        `sprite-forge respondió algo que NO es su catálogo (${donde}: ${primero?.message ?? "sin detalle"}) — ` +
        `el repo hermano y este contrato han divergido; los personajes salen en maniquí y_bot.`,
    };
  }

  const skin = parsed.data.skin;
  if (!skin.enabled) {
    return {
      nivel: "aviso",
      linea:
        `sprite-forge arrancó pero el REPINTADO está apagado: ${skin.reason} — ` +
        `los personajes salen en maniquí y_bot (el juego arranca igual).`,
    };
  }
  return {
    nivel: "ok",
    linea: `sprite-forge con repintado: ${skin.api} · ${skin.ai_model}`,
  };
}

// ─────────────────────────────────────────────────────────── CLI

/** Sondea `/catalog` hasta que conteste o se agote el plazo. Un servicio que
 *  tarda no es un servicio roto: renderizar el catálogo hashea el set entero. */
async function sondear(url: string, segundos: number): Promise<SondeoDeForge> {
  const limite = Date.now() + segundos * 1000;
  let ultimo = "sin intentar";
  while (Date.now() < limite) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        ultimo = `HTTP ${res.status}`;
      } else {
        return { tipo: "catalogo", json: await res.json() };
      }
    } catch (err) {
      ultimo = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { tipo: "sin-respuesta", url, segundos, detalle: ultimo };
}

function pintar(v: VeredictoDeForge): string {
  const color = process.stdout.isTTY;
  if (v.nivel === "ok") return `✅ ${v.linea}`;
  const rojo = color ? "\u001b[31m" : "";
  const fin = color ? "\u001b[0m" : "";
  return `${rojo}⚠️  ${v.linea}${fin}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const sinRepo = val("--sin-repo");
  if (sinRepo !== undefined) {
    console.log(pintar(veredictoDeForge({ tipo: "sin-repo", dir: sinRepo })));
    return;
  }

  const url = val("--url");
  if (!url) throw new Error("falta --url <catalog> (o --sin-repo <dir>)");
  const segundos = Number(val("--espera") ?? 90);
  if (!Number.isFinite(segundos) || segundos <= 0) {
    throw new Error(`--espera inválida: ${val("--espera")}`);
  }
  console.log(pintar(veredictoDeForge(await sondear(url, segundos))));
}

// Importado (el test de los cuatro veredictos) no sondea ni imprime nada; solo
// al invocarlo como comando.
if (process.argv[1]?.endsWith("salud-sprite-forge.ts")) await main();
