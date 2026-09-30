/** El texto COMPLETO que devuelve `narrative_listen` tiene techo (tanda BZ).
 *
 *  El hallazgo: en un playtest de alta_fantasia cada `narrative_listen` traía
 *  ~65 KB y dos veces pasó del tope de la tool MCP (el motor tuvo que leerlo
 *  desde fichero). Nadie lo medía: el texto se componía inline en el handler
 *  de la tool y ningún test podía llamarlo.
 *
 *  Este test mide EL texto, no una copia: lo compone `narrative-mcp/texto-de-listen.ts`,
 *  el mismo módulo que usa `server.ts`, con los `.md` reales del contrato. Y
 *  la petición se construye por el camino real del bridge: un save de verdad
 *  (`fixtures/listen/state.json`, alta_fantasia/acuarela_luminosa, 2 tiles)
 *  cargado con `loadSession`, `generateTileScene` hasta el `aiClient` (donde se
 *  captura el `LlmContext` que saldría hacia ai_server), y lo que añade
 *  ai_server encima: `available_assets` —la ventana llena, 30 descripciones,
 *  las más largas de la DB real (`fixtures/listen/available-assets.json`)— y
 *  `session`.
 *
 *  El techo es lo MEDIDO tras el cambio, sin margen: crecer exige tocar
 *  `data/contract/techo-de-listen.json` con el motivo. El 65 % del texto de
 *  escena son instrucciones fijas (`tile_instructions.md` +
 *  `scene_instructions.md` + `world_rules.md`) que esta tanda NO recorta: si un
 *  prompt crece, este test lo dice.
 *
 *  Lo que esto NO sujeta:
 *  - Un save más grande que el fixture (más diálogo, más entidades, más
 *    vecinos) produce un texto mayor en partida sin que este test lo vea: mide
 *    UNA petición realista, no la peor posible.
 *  - El tope de la tool MCP se expresa en TOKENS y aquí se mide en bytes; la
 *    relación no está medida (backlog de la tanda BZ).
 *  - Que en partida `available_assets` sean de verdad del estilo: eso lo
 *    sujetan `ai_server/tests/test_available_assets.py` y el SQL del store. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";

import {
  FICHEROS_DE_PROMPTS,
  textoDeEscena,
  textoDeEvento,
  textoDeMuerte,
  type PromptsDeListen,
} from "../../narrative-mcp/texto-de-listen.js";
import { generateTileScene } from "../bridge/handlers/tile.js";
import { pedirDespertar } from "../bridge/handlers/despertar.js";
import type { LlmContext, SessionData } from "../src/narrative/types.js";
import { makeCtx, makeSocket, porElBorde, waitFor } from "./helpers.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/listen/", import.meta.url));
const PROMPTS_DIR = fileURLToPath(new URL("../data/contract/prompts/", import.meta.url));
const TECHO = fileURLToPath(new URL("../data/contract/techo-de-listen.json", import.meta.url));
const JUEGOS = fileURLToPath(new URL("../data/games/", import.meta.url));
const ESTILOS = fileURLToPath(new URL("../data/styles/", import.meta.url));

/** La PRIMERA petición de una partida nueva, por el camino real del arranque:
 *  `start_session` por el borde WS con el juego y el estilo reales, hasta que
 *  el bootstrap del tile (0,0) llama al motor. Es la más pesada: lleva el
 *  `world_document` entero (QA de BZ, I1: 60.481 B en vivo). */
async function peticionDeArranque(): Promise<{ ctx: LlmContext; sessionId: string; gameId: string }> {
  const capturado: LlmContext[] = [];
  const { ctx } = makeCtx({
    gamesDir: JUEGOS,
    stylesDir: ESTILOS,
    ai: {
      generateScene: async (c: LlmContext) => {
        capturado.push(structuredClone(c));
        return { ok: false, error: "capturado por el test del techo" };
      },
    },
  });
  await porElBorde(
    { type: "start_session", requestId: "techo", gameId: "alta_fantasia", styleId: "acuarela_luminosa" },
    makeSocket().socket,
    ctx,
  );
  await waitFor(() => capturado.length > 0, 10_000);
  const c = capturado[0];
  assert.equal(c.world.style_id, "acuarela_luminosa");
  assert.equal(c.generate_tile?.bootstrap, true, "es la petición del bootstrap");
  assert.ok((c.world_document ?? "").length > 1000, "el bootstrap lleva el documento del mundo");
  return { ctx: c, sessionId: ctx.narrative.session_id, gameId: "alta_fantasia" };
}

const KINDS = ["scene_bootstrap", "scene", "narrative_event", "player_death"] as const;
type Kind = (typeof KINDS)[number];

const TechoDeKind = z
  .object({
    techo_bytes: z.number().int().positive(),
    medido_el: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    motivo: z.string().min(1),
  })
  .strict();

const TechoSchema = z
  .object({
    _comment: z.string().min(1),
    tope_mcp: z.object({ motivo: z.string().min(1) }).strict(),
    por_kind: z
      .object({ scene_bootstrap: TechoDeKind, scene: TechoDeKind, narrative_event: TechoDeKind, player_death: TechoDeKind })
      .strict(),
  })
  .strict();

function prompts(): PromptsDeListen {
  return Object.fromEntries(
    Object.entries(FICHEROS_DE_PROMPTS).map(([k, f]) => [k, readFileSync(resolve(PROMPTS_DIR, f), "utf-8")]),
  ) as unknown as PromptsDeListen;
}

/** Lo que ai_server añade a cada petición antes de mandarla al motor
 *  (`_inject_available_assets`): la librería del estilo y la sesión. */
function comoLoMandaAiServer(ctx: LlmContext, sessionId: string, gameId: string, isResume = true): LlmContext {
  const assets = z.array(z.string().min(4)).length(30).parse(
    JSON.parse(readFileSync(resolve(FIXTURES, "available-assets.json"), "utf-8")),
  );
  return { ...ctx, available_assets: assets, session: { session_id: sessionId, game_id: gameId, is_resume: isResume } } as LlmContext;
}

async function peticiones(): Promise<Record<Kind, string>> {
  const save = JSON.parse(readFileSync(resolve(FIXTURES, "state.json"), "utf-8")) as SessionData;
  const capturado: LlmContext[] = [];
  const { ctx, storage, narrative, aiCalls } = makeCtx({
    ai: {
      generateScene: async (c: LlmContext) => {
        capturado.push(structuredClone(c));
        return { ok: false, error: "capturado por el test del techo" };
      },
    },
  });
  await storage.write(save.session_id, save);
  assert.equal(await narrative.loadSession(save.session_id), true, "el save del fixture carga por el camino del resume");
  assert.equal(narrative.world.style_id, "acuarela_luminosa");

  // Un tile nuevo al este del de entrada: vecinos, lugares cercanos y costuras.
  await assert.rejects(generateTileScene(ctx, 1, 0, "east"), /capturado por el test del techo/);
  assert.equal(capturado.length, 1);
  const escena = comoLoMandaAiServer(capturado[0], save.session_id, save.game_id);
  assert.ok(escena.generate_tile, "la petición de escena lleva generate_tile");

  const evento = comoLoMandaAiServer(narrative.serializeForLlm(ctx.activePlugins), save.session_id, save.game_id);

  pedirDespertar(ctx, makeSocket().socket);
  assert.equal(aiCalls.death.length, 1, "el despertar pidió al motor");
  const muerte = aiCalls.death[0] as { eventId: string; context: LlmContext };

  const arranque = await peticionDeArranque();

  const p = prompts();
  return {
    scene_bootstrap: textoDeEscena(comoLoMandaAiServer(arranque.ctx, arranque.sessionId, arranque.gameId, false), p),
    scene: textoDeEscena(escena, p),
    narrative_event: textoDeEvento(
      {
        kind: "dialogue_choice",
        event_id: "evt_000001",
        speaker: "Tabernera",
        chosen_text: "¿Qué se cuenta por el camino del norte?",
        free_text: "",
        context: evento,
      },
      p,
    ),
    player_death: textoDeMuerte(
      { event_id: muerte.eventId, context: comoLoMandaAiServer(muerte.context, save.session_id, save.game_id) },
      p,
    ),
  };
}

describe("el texto de narrative_listen tiene techo", () => {
  it("cada kind cabe bajo su techo declarado y medido", async () => {
    const techo = TechoSchema.parse(JSON.parse(readFileSync(TECHO, "utf-8")));
    const textos = await peticiones();
    const medidos = Object.fromEntries(KINDS.map((k) => [k, Buffer.byteLength(textos[k], "utf8")])) as Record<Kind, number>;
    console.log(`texto de narrative_listen (bytes): ${JSON.stringify(medidos)}`);
    for (const k of KINDS) {
      assert.ok(
        medidos[k] <= techo.por_kind[k].techo_bytes,
        `${k}: el texto de narrative_listen mide ${medidos[k]} B y el techo es ${techo.por_kind[k].techo_bytes} B ` +
          `(+${medidos[k] - techo.por_kind[k].techo_bytes}). Si crecer es a propósito, sube el techo en ` +
          "data/contract/techo-de-listen.json con el motivo; si no, algo se ha colado en la petición.",
      );
    }
  });

  it("el JSON de la petición va compacto y la librería son descripciones sueltas", async () => {
    const { scene } = await peticiones();
    const json = scene.slice(0, scene.indexOf("\n\n"));
    const leido = JSON.parse(json) as { kind: string; world_state: LlmContext };
    assert.equal(leido.kind, "scene");
    assert.equal(json, JSON.stringify(leido), "sin indentación: la indentación eran ~4,5 KB de cada petición");
    assert.ok(leido.world_state.available_assets?.every((a) => typeof a === "string"));
  });
});

// ── server.ts compone con el módulo medido (QA de BZ, M4) ────────────────
//
// El techo mide `texto-de-listen.ts`; si `server.ts` compusiera el texto por
// su cuenta —entero o en parte: un `+ "…"`, un prompt distinto— el candado
// seguiría verde midiendo algo que el motor no recibe. Se comprueba en el
// ÁRBOL DE SINTAXIS de `server.ts`, no por grafía: dentro del handler de la
// tool `narrative_listen`, todo `return` que no sea un error (`isError: true`)
// devuelve `content: [{ type, text }]` y ese `text` es EXACTAMENTE una llamada
// a una función importada de `./texto-de-listen.js` (por su nombre importado,
// aunque venga con alias) cuyo último argumento es la constante de prompts
// que se construye desde `FICHEROS_DE_PROMPTS`. Y las cuatro funciones se
// llaman: ninguna rama puede quedarse fuera.
//
// Lo que esto NO sujeta: el PRIMER argumento (la petición) puede llegar
// alterado — `textoDeEscena({ ...msg.world_state, extra })` pasa —, y un
// `text` construido en una variable y devuelto después cuenta como desvío
// aunque su valor fuera el correcto (falso rojo, no falso verde). Los returns
// con `isError: true` quedan fuera a propósito (son los rechazos del handler):
// marcar como error una respuesta normal la saltaría, pero el motor la leería
// como error, que no es un desvío silencioso.

const SERVER = fileURLToPath(new URL("../../narrative-mcp/server.ts", import.meta.url));
const COMPONEDORES = ["textoDeEscena", "textoDeEvento", "textoDeMuerte", "textoDeMundo"] as const;

function desviosDelListen(src: string): string[] {
  const sf = ts.createSourceFile("server.ts", src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const desvios: string[] = [];
  const linea = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  // local → nombre importado, solo de ./texto-de-listen.js
  const delModulo = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.moduleSpecifier.text !== "./texto-de-listen.js") continue;
    const nb = st.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) delModulo.set(el.name.text, (el.propertyName ?? el.name).text);
    }
  }
  const esDelModulo = (id: ts.Node, nombre: string) => ts.isIdentifier(id) && delModulo.get(id.text) === nombre;

  // La constante de prompts: la que se inicializa desde FICHEROS_DE_PROMPTS.
  const constantesDePrompts = new Set<string>();
  const buscaConstante = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let usa = false;
      const mira = (m: ts.Node): void => {
        if (esDelModulo(m, "FICHEROS_DE_PROMPTS")) usa = true;
        ts.forEachChild(m, mira);
      };
      mira(n.initializer);
      if (usa) constantesDePrompts.add(n.name.text);
    }
    ts.forEachChild(n, buscaConstante);
  };
  buscaConstante(sf);
  if (constantesDePrompts.size === 0) desvios.push("ninguna constante de prompts se construye desde FICHEROS_DE_PROMPTS");

  // El handler de `server.tool('narrative_listen', …)`.
  let handler: ts.FunctionLikeDeclaration | undefined;
  const buscaTool = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.arguments.length > 0) {
      const a0 = n.arguments[0];
      const ultimo = n.arguments[n.arguments.length - 1];
      if (ts.isStringLiteralLike(a0) && a0.text === "narrative_listen" && (ts.isArrowFunction(ultimo) || ts.isFunctionExpression(ultimo))) {
        handler = ultimo;
      }
    }
    ts.forEachChild(n, buscaTool);
  };
  buscaTool(sf);
  if (!handler?.body) return [...desvios, "no encuentro el handler de la tool narrative_listen"];

  const llamadas = new Set<string>();
  const propiedad = (o: ts.ObjectLiteralExpression, nombre: string) =>
    o.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === nombre);

  const revisaReturn = (r: ts.ReturnStatement): void => {
    const e = r.expression;
    if (!e || !ts.isObjectLiteralExpression(e)) {
      desvios.push(`línea ${linea(r)}: return que no es un objeto literal { content }`);
      return;
    }
    const isError = propiedad(e, "isError");
    if (isError && isError.initializer.kind === ts.SyntaxKind.TrueKeyword) return;
    const content = propiedad(e, "content");
    if (!content || !ts.isArrayLiteralExpression(content.initializer) || content.initializer.elements.length === 0) {
      desvios.push(`línea ${linea(r)}: return sin content: [ … ]`);
      return;
    }
    for (const el of content.initializer.elements) {
      const text = ts.isObjectLiteralExpression(el) ? propiedad(el, "text") : undefined;
      const call = text?.initializer;
      const nombre =
        call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) ? delModulo.get(call.expression.text) : undefined;
      if (!call || !ts.isCallExpression(call) || !nombre || !(COMPONEDORES as readonly string[]).includes(nombre)) {
        desvios.push(`línea ${linea(el)}: el text no es una llamada directa a texto-de-listen.ts: ${text?.initializer.getText(sf) ?? el.getText(sf)}`);
        continue;
      }
      const ultimoArg = call.arguments[call.arguments.length - 1];
      if (call.arguments.length !== 2 || !ts.isIdentifier(ultimoArg) || !constantesDePrompts.has(ultimoArg.text)) {
        desvios.push(`línea ${linea(call)}: ${nombre} no recibe la constante de prompts de FICHEROS_DE_PROMPTS`);
        continue;
      }
      llamadas.add(nombre);
    }
  };
  const recorre = (n: ts.Node): void => {
    if (n !== handler && ts.isFunctionLike(n)) return; // returns de funciones anidadas no son del handler
    if (ts.isReturnStatement(n)) revisaReturn(n);
    ts.forEachChild(n, recorre);
  };
  recorre(handler.body);
  for (const f of COMPONEDORES) if (!llamadas.has(f)) desvios.push(`ninguna rama del listen llama a ${f}`);
  return desvios;
}

describe("server.ts compone narrative_listen con el módulo que mide el techo", () => {
  const real = readFileSync(SERVER, "utf-8");

  it("el server.ts de hoy no se desvía", () => {
    assert.deepEqual(desviosDelListen(real), []);
  });

  /** Cada sabotaje se hace sobre el fuente REAL; si su ancla deja de existir
   *  el test lo dice, en vez de sabotear nada y salir verde. */
  const sabotea = (de: string, a: string): string => {
    assert.ok(real.includes(de), `el ancla del sabotaje ya no está en server.ts: ${de}`);
    return real.replace(de, a);
  };

  it("se pone rojo con la composición inline de antes", () => {
    const d = desviosDelListen(
      sabotea(
        "text: textoDeEscena(msg.world_state, PROMPTS)",
        "text: JSON.stringify({ kind: 'scene', world_state: msg.world_state }, null, 2)",
      ),
    );
    assert.ok(d.some((x) => x.includes("no es una llamada directa")), d.join("\n"));
    assert.ok(d.some((x) => x.includes("ninguna rama del listen llama a textoDeEscena")), d.join("\n"));
  });

  it("se pone rojo con un añadido parcial al texto medido", () => {
    const d = desviosDelListen(sabotea("text: textoDeMuerte(msg, PROMPTS)", "text: textoDeMuerte(msg, PROMPTS) + '\\n\\nextra'"));
    assert.ok(d.some((x) => x.includes("no es una llamada directa")), d.join("\n"));
  });

  it("se pone rojo si una rama recibe otros prompts", () => {
    const d = desviosDelListen(
      sabotea("text: textoDeEvento(msg, PROMPTS)", "text: textoDeEvento(msg, { ...PROMPTS, worldRules: '' })"),
    );
    assert.ok(d.some((x) => x.includes("no recibe la constante de prompts")), d.join("\n"));
  });

  it("se pone rojo si la función viene de otro módulo con el mismo nombre", () => {
    const d = desviosDelListen(sabotea("from './texto-de-listen.js'", "from './otro-texto.js'"));
    assert.ok(d.length > 0);
  });

  it("un alias en el import sigue contando (por el nombre importado, no por la grafía)", () => {
    const conAlias = sabotea("textoDeMundo, textoDeMuerte", "textoDeMundo as tdm, textoDeMuerte").replace(
      "text: textoDeMundo(ctx, PROMPTS)",
      "text: tdm(ctx, PROMPTS)",
    );
    assert.deepEqual(desviosDelListen(conAlias), []);
  });
});
