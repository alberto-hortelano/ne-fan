/** EL PROMPT QUE SE PEGA AL MOTOR NO ENUMERA KINDS (tanda BW, H3).
 *
 *  Lo que salió jugando (2026-09-30): lo PRIMERO que copia quien arranca el
 *  juego es el encargo que `start.sh` le pide pegar en el terminal del motor,
 *  y ese encargo le enseñaba cuatro kinds —`room`, `weapon_orient`,
 *  `weapon_verify`, `narrative_event`— de los que uno estaba retirado y dos no
 *  llegan nunca en partida. Ninguno era el que el motor iba a recibir. Las
 *  instrucciones y el schema de cada kind ya llegan embebidos en el retorno de
 *  `narrative_listen`, así que el encargo no tiene por qué nombrarlos: un kind
 *  escrito en prosa es un rastro que se pudre el día que el contrato cambia.
 *
 *  Qué se mira: el encargo, que desde la tanda BX vive en UN fichero
 *  (`data/contract/encargo-del-motor.txt`) del que `start.sh` hace `cat`; y
 *  que no quede copia en prosa en los sitios de los que alguien lo copiaba
 *  (`start.sh`, `labs/**.md`, `docs/arquitectura/**`, `CLAUDE.md`). Qué se busca: cada literal de `type`, `kind` y
 *  `format` de los mensajes de `AiToMcpMsg`, derivados POR EL ÁRBOL DE
 *  SINTAXIS de `src/contracts/narrative-mcp-ws.ts` —la fuente del protocolo—,
 *  más los kinds retirados que el contrato ya no nombra. Como palabra (un
 *  plural cuenta: «fallback rooms» también era el rastro).
 *
 *  _lo_que_esto_NO_sujeta:
 *   · un kind futuro que no viaje en esas uniones (un `event_kind` nuevo
 *     dentro de `context`, un kind de otro canal): no está en el contrato, no
 *     se deriva, no se ve;
 *   · un kind retirado que no esté en `RETIRADOS`: `room` está porque es el
 *     que se pudrió aquí, y los dos `weapon_*` porque salieron del contrato
 *     en #790; el siguiente hay que añadirlo al retirarlo;
 *   · otras prosas que hablen al motor: solo se miran el fichero del encargo
 *     y, por la frase con la que empieza («Eres el motor narrativo»), que no
 *     haya copia en `start.sh`, `labs/**.md`, `docs/arquitectura/**` ni
 *     `CLAUDE.md`. Una copia REESCRITA (otra frase de arranque) o fuera de esos
 *     sitios no se ve: también es censo de grafía;
 *   · el kind escrito de otra forma (con espacios, traducido: «petición de
 *     sala»). Es un censo de grafía, y un censo de grafía es ciego a la
 *     escritura — lo que sujeta es la regresión literal que salió jugando. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const CONTRATO = fileURLToPath(new URL("../src/contracts/narrative-mcp-ws.ts", import.meta.url));
/** La fuente ÚNICA del encargo (tanda BX). */
const ENCARGO = fileURLToPath(new URL("../data/contract/encargo-del-motor.txt", import.meta.url));
/** La frase con la que arranca el encargo: su presencia fuera del fichero es
 *  una copia. */
const ARRANQUE_DEL_ENCARGO = "Eres el motor narrativo";

/** Kinds que el contrato YA NO nombra y que alguna prosa sí nombró. */
const RETIRADOS: Record<string, string> = {
  room: "El formato de sala cerrada se retiró; narrative-mcp rechaza cualquier formato que no sea `scene`.",
  weapon_orient: "Retirado con el canal de visión (#790): sin productor desde que salió Godot (#209), su último llamador.",
  weapon_verify: "Retirado con el canal de visión (#790): sin productor desde que salió Godot (#209), su último llamador.",
};

/** Los literales de `type`/`kind`/`format` de cada miembro de `AiToMcpMsg`. */
function kindsDelContrato(fuente: string): string[] {
  const sf = ts.createSourceFile("narrative-mcp-ws.ts", fuente, ts.ScriptTarget.Latest, true);
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  let union: ts.TypeAliasDeclaration | undefined;
  sf.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n)) interfaces.set(n.name.text, n);
    if (ts.isTypeAliasDeclaration(n) && n.name.text === "AiToMcpMsg") union = n;
  });
  if (!union || !ts.isUnionTypeNode(union.type)) throw new Error("AiToMcpMsg no es una unión en el contrato");
  const out = new Set<string>();
  for (const miembro of union.type.types) {
    if (!ts.isTypeReferenceNode(miembro) || !ts.isIdentifier(miembro.typeName)) continue;
    const decl = interfaces.get(miembro.typeName.text);
    if (!decl) throw new Error(`miembro ${miembro.typeName.text} de AiToMcpMsg sin interfaz en el contrato`);
    for (const m of decl.members) {
      if (!ts.isPropertySignature(m) || !m.type || !ts.isIdentifier(m.name)) continue;
      if (!["type", "kind", "format"].includes(m.name.text)) continue;
      const tipos = ts.isUnionTypeNode(m.type) ? m.type.types : [m.type];
      for (const t of tipos) {
        if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) out.add(t.literal.text);
      }
    }
  }
  return [...out].sort();
}

/** Los ficheros de prosa donde una copia del encargo se pudriría: los sitios
 *  de los que alguien lo copiaba o lo leería. */
function prosaQuePodriaCopiarlo(): string[] {
  const out = [`${REPO}start.sh`, `${REPO}CLAUDE.md`];
  const recorrer = (dir: string, filtro: (f: string) => boolean): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "runs") continue;
      const ruta = `${dir}/${e.name}`;
      if (e.isDirectory()) recorrer(ruta, filtro);
      else if (filtro(e.name)) out.push(ruta);
    }
  };
  recorrer(`${REPO}labs`, (f) => f.endsWith(".md"));
  recorrer(`${REPO}docs/arquitectura`, () => true);
  return out;
}

/** Los kinds que aparecen como PALABRA en el texto (plural incluido). */
function kindsNombrados(texto: string, kinds: readonly string[]): string[] {
  return kinds.filter((k) => new RegExp(`(?<![A-Za-z0-9_])${k}s?(?![A-Za-z0-9_])`).test(texto));
}

describe("el encargo al motor no enumera kinds", () => {
  const derivados = kindsDelContrato(readFileSync(CONTRATO, "utf8"));
  const kinds = [...derivados, ...Object.keys(RETIRADOS)];

  it("el censo del contrato no sale vacío (un contrato renombrado es rojo, no verde)", () => {
    // Los kinds vivos del encargo viejo tienen que estar: si el derivador deja
    // de verlos, este candado no sujeta nada. (Los dos `weapon_*` ya no están
    // en el contrato desde #790: los ve `RETIRADOS`, y el test del encargo
    // viejo de abajo los sigue exigiendo.)
    for (const k of ["scene", "narrative_event"]) {
      assert.ok(derivados.includes(k), `el derivador no ve «${k}» en AiToMcpMsg (vio: ${derivados.join(", ")})`);
    }
  });

  it("el encargo (fuente única) no nombra ningún kind", () => {
    const texto = readFileSync(ENCARGO, "utf8");
    assert.ok(texto.startsWith(ARRANQUE_DEL_ENCARGO), "premisa del censo de copias: el encargo empieza por su frase");
    assert.ok(texto.includes("narrative_listen"), "el encargo sigue diciendo a qué tool llamar");
    // Y qué hacer cuando la llamada expira o falla (QA de la tanda): un
    // Claude recién abierto puede parar el bucle ante el primer error.
    assert.match(texto, /expira o falla, vuelve a llamarlo/);
    assert.deepEqual(kindsNombrados(texto, kinds), []);
  });

  it("no hay copia del encargo en prosa: start.sh lo lee del fichero, el README apunta a él", () => {
    const ficheros = prosaQuePodriaCopiarlo();
    assert.ok(ficheros.some((f) => f.endsWith("labs/narrative/README.md")), "el censo mira el README del bench");
    const conCopia = ficheros.filter((f) => readFileSync(f, "utf8").includes(ARRANQUE_DEL_ENCARGO));
    assert.deepEqual(conCopia, []);
    assert.match(readFileSync(`${REPO}start.sh`, "utf8"), /encargo-del-motor\.txt/, "start.sh lee la fuente única");
  });

  it("el detector ve lo que salió jugando: el encargo viejo da cuatro kinds", () => {
    const viejo =
      "Llama a narrative_listen en bucle y responde con el schema adecuado a cada tipo de " +
      "request (room, weapon_orient, weapon_verify, narrative_event). Without API key — fallback rooms.";
    assert.deepEqual(kindsNombrados(viejo, kinds).sort(), ["narrative_event", "room", "weapon_orient", "weapon_verify"]);
    // …y no confunde la tool con el kind: `narrative_listen` no es `narrative_event`.
    assert.deepEqual(kindsNombrados("llama a narrative_listen y a narrative_respond", kinds), []);
  });
});
