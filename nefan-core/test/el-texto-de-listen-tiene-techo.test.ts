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
import { makeCtx, makeSocket } from "./helpers.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/listen/", import.meta.url));
const PROMPTS_DIR = fileURLToPath(new URL("../data/contract/prompts/", import.meta.url));
const TECHO = fileURLToPath(new URL("../data/contract/techo-de-listen.json", import.meta.url));

const KINDS = ["scene", "narrative_event", "player_death"] as const;
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
    por_kind: z.object({ scene: TechoDeKind, narrative_event: TechoDeKind, player_death: TechoDeKind }).strict(),
  })
  .strict();

function prompts(): PromptsDeListen {
  return Object.fromEntries(
    Object.entries(FICHEROS_DE_PROMPTS).map(([k, f]) => [k, readFileSync(resolve(PROMPTS_DIR, f), "utf-8")]),
  ) as unknown as PromptsDeListen;
}

/** Lo que ai_server añade a cada petición antes de mandarla al motor
 *  (`_inject_available_assets`): la librería del estilo y la sesión. */
function comoLoMandaAiServer(ctx: LlmContext, sessionId: string, gameId: string): LlmContext {
  const assets = z.array(z.string().min(4)).length(30).parse(
    JSON.parse(readFileSync(resolve(FIXTURES, "available-assets.json"), "utf-8")),
  );
  return { ...ctx, available_assets: assets, session: { session_id: sessionId, game_id: gameId, is_resume: true } } as LlmContext;
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

  const p = prompts();
  return {
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
