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
 *  Qué se mira: el heredoc ENTERO de `pause_for_claude_code` en `start.sh` y
 *  la cita `>` de `labs/narrative/README.md` que lleva el encargo (la que
 *  nombra `narrative_respond`). Qué se busca: cada literal de `type`, `kind` y
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
 *   · otras prosas que hablen al motor (docs/, CLAUDE.md, comentarios): solo
 *     se miran los dos sitios de los que alguien COPIA el encargo;
 *   · el kind escrito de otra forma (con espacios, traducido: «petición de
 *     sala»). Es un censo de grafía, y un censo de grafía es ciego a la
 *     escritura — lo que sujeta es la regresión literal que salió jugando. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const CONTRATO = fileURLToPath(new URL("../src/contracts/narrative-mcp-ws.ts", import.meta.url));

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

/** El heredoc de `pause_for_claude_code`: de `cat <<'EOF'` a `EOF`. */
function encargoDeStartSh(sh: string): string {
  const m = /pause_for_claude_code\(\)\s*\{\s*\n\s*cat <<'EOF'\n([\s\S]*?)\nEOF\n/.exec(sh);
  if (!m) throw new Error("start.sh: no encuentro el heredoc de pause_for_claude_code");
  return m[1]!;
}

/** Las citas `>` del README que llevan el encargo (las que nombran
 *  `narrative_respond`). */
function encargoDelReadme(md: string): string {
  const bloques: string[] = [];
  let actual: string[] = [];
  for (const linea of md.split("\n")) {
    const m = /^\s*>\s?(.*)$/.exec(linea);
    if (m) actual.push(m[1]!);
    else if (actual.length) {
      bloques.push(actual.join("\n"));
      actual = [];
    }
  }
  if (actual.length) bloques.push(actual.join("\n"));
  const encargo = bloques.filter((b) => b.includes("narrative_respond"));
  if (encargo.length === 0) throw new Error("labs/narrative/README.md: no encuentro la cita del encargo al motor");
  return encargo.join("\n");
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

  it("start.sh: el heredoc de pause_for_claude_code no nombra ningún kind", () => {
    const texto = encargoDeStartSh(readFileSync(`${REPO}start.sh`, "utf8"));
    assert.ok(texto.includes("narrative_listen"), "el encargo sigue diciendo a qué tool llamar");
    // Y qué hacer cuando la llamada expira o falla (QA de la tanda): un
    // Claude recién abierto puede parar el bucle ante el primer error.
    assert.match(texto, /expira o falla, vuelve a llamarlo/);
    assert.deepEqual(kindsNombrados(texto, kinds), []);
  });

  it("labs/narrative/README.md: la cita del encargo no nombra ningún kind", () => {
    const texto = encargoDelReadme(readFileSync(`${REPO}labs/narrative/README.md`, "utf8"));
    assert.deepEqual(kindsNombrados(texto, kinds), []);
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
