/** EL CORTAFUEGOS DE UN TILE DEL BRIDGE ES UNO Y TIENE DUEÑO (#677, #687).
 *
 *  Once esperas del banco tienen el mismo sujeto —el bridge generando y
 *  difundiendo un tile, sea por `request_tile`, por un viaje del panel
 *  «Salidas» o por la frontera— y hasta #677 presupuestaban con CUATRO números
 *  (60, 90, 180 y 240 s). El número lo decide el coste del CUELGUE (la
 *  aritmética está junto a `MS_DEL_TILE` en `qa/lib/tile-episodio.mjs`), y
 *  esto sujeta que sea UNO: `data/contract/esperas-de-tile.json` dice quién lo
 *  usa, y aquí se comprueba en CI —la batería de navegador no corre en ningún
 *  job— leyendo el ÁRBOL de sintaxis de todo `qa/**.mjs`.
 *
 *  Las dos direcciones, más una:
 *   (a) cada entrada del padrón resuelve a EXACTAMENTE una llamada cuyo
 *       presupuesto es el identificador `MS_DEL_TILE` (una entrada sin sujeto
 *       CADUCA y se borra; una que resuelve a dos es ambigua y se afina);
 *   (b) TODO nodo `MS_DEL_TILE` de `qa/**` está explicado: la única
 *       declaración, un import en un fichero que lo usa, el default de
 *       `pedirYEsperarTile`, el presupuesto de una espera del padrón, o una
 *       lectura —comparación o interpolación en un template— en un lector
 *       declarado. Una copia local con otro valor (`const MS_DEL_TILE =
 *       240_000` en un guion) nace VERDE para cualquier candado por nombre
 *       —lección del 2026-09-17— y aquí es rojo, igual que un alias
 *       (`const t = MS_DEL_TILE`), que presupuestaría con otro nombre. Y el
 *       presupuesto se reconoce por RANGO, no por padre inmediato: un
 *       `waitFor(d, f, MS_DEL_TILE * 2)` es un presupuesto DERIVADO que hay
 *       que apuntar, no una lectura inocente;
 *   (c) ningún `pedirYEsperarTile(…)` del banco trae su propio `ms`: el 120 y
 *       el 127 heredan el default, y sin esto un `{ms: 240_000}` en el quinto
 *       argumento no tocaría ningún identificador y saldría verde.
 *
 *  **SE LEE EL ÁRBOL, NO EL TEXTO**, por lo mismo que en
 *  `esperas-que-conducen.test.ts`: `sesion.mjs` escribe «agotó MS_DEL_TILE»
 *  dentro de un template string, y con regex eso sería un uso. Un string es
 *  un string. Y se cuentan NODOS, no coincidencias: el censo por grafía nace
 *  ciego ante un alias o un nombre partido (`la-consulta-de-movimiento-tiene-
 *  dueno.test.ts`).
 *
 *  Lo que NO sujeta está en `_lo_que_esto_NO_sujeta`, obligatorio en el zod, y
 *  el primero de esos agujeros se MIDE abajo en vez de prometerse.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(core, "..");
const CONTRATO = join(core, "data", "contract", "esperas-de-tile.json");
const NOMBRE = "MS_DEL_TILE";
const VERBOS = ["waitFor", "holdUntil", "esperarEnElSave"] as const;
type Verbo = (typeof VERBOS)[number];

const RutaDelBanco = z.string().regex(/^qa\/(guiones|lib)\/[\w.-]+\.mjs$/, "una entrada nombra un `.mjs` del banco");
/** Un motivo es una FRASE con vocabulario, no una etiqueta: mismo listón que
 *  `esperas-que-conducen.json` (QA midió que la longitud sola se rellena). */
const Motivo = z
  .string()
  .min(80, "el motivo es una FRASE que dice a quién se espera y qué presupuestaba, no una etiqueta")
  .refine(
    (f) => new Set(f.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).size >= 15,
    "el motivo es una FRASE (quince palabras DISTINTAS o más), no una palabra repetida hasta llenar el mínimo",
  );

const EsperasDeTileSchema = z
  .object({
    _comment: z.string().min(1),
    _lo_que_esto_NO_sujeta: z.array(z.string().min(60)).min(1),
    constante: z
      .object({ nombre: z.literal(NOMBRE), fichero: z.literal("qa/lib/tile-episodio.mjs"), valor_ms: z.number().int().positive() })
      .strict(),
    default_de: z.object({ fichero: z.literal("qa/lib/sesion.mjs"), funcion: z.literal("pedirYEsperarTile") }).strict(),
    esperas: z
      .array(
        z
          .object({
            fichero: RutaDelBanco,
            llamada: z.enum(VERBOS),
            /** El TEXTO del argumento de descripción tal como está escrito
             *  (con sus comillas, o el identificador `desc` en los helpers), o
             *  `null` para el verbo que no describe (`esperarEnElSave`). */
            desc: z.string().min(3).nullable(),
            porque: Motivo.refine((f) => /bridge/i.test(f), "el motivo NOMBRA al bridge, que es el sujeto de toda espera de esta lista"),
          })
          .strict(),
      )
      .min(1),
    lectores: z.array(z.object({ fichero: RutaDelBanco, porque: Motivo }).strict()),
  })
  .strict();

/** Una llamada a uno de los tres verbos, con su presupuesto tal como está. */
export type Espera = {
  fichero: string;
  linea: number;
  llamada: Verbo;
  desc: string | null;
  presupuesto: string;
  presupuestoEsLaConstante: boolean;
};

const nombreDelCallee = (n: ts.CallExpression, sf: ts.SourceFile): string | null => {
  if (ts.isPropertyAccessExpression(n.expression)) return n.expression.name.text;
  if (ts.isIdentifier(n.expression)) return n.expression.getText(sf);
  return null;
};

/** El nodo que hace de PRESUPUESTO en una llamada, por verbo: `waitFor` arg 2,
 *  `holdUntil` arg 3 (`.ms` si es un objeto), `esperarEnElSave` arg 2. */
const nodoDePresupuesto = (n: ts.CallExpression, verbo: Verbo): ts.Node | undefined => {
  if (verbo === "holdUntil") {
    const o = n.arguments[3];
    if (o !== undefined && ts.isObjectLiteralExpression(o)) {
      const ms = o.properties.find(
        (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "ms",
      );
      return ms?.initializer;
    }
    return o;
  }
  return n.arguments[2];
};

/** Todas las esperas de los tres verbos que hay en `texto`. */
export function esperasDeTile(texto: string, fichero: string): Espera[] {
  const sf = ts.createSourceFile(fichero, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const linea = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const vistas: Espera[] = [];
  const visita = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const nombre = nombreDelCallee(n, sf);
      if (nombre !== null && (VERBOS as readonly string[]).includes(nombre)) {
        const verbo = nombre as Verbo;
        const descNodo = verbo === "waitFor" ? n.arguments[0] : verbo === "holdUntil" ? n.arguments[1] : undefined;
        const p = nodoDePresupuesto(n, verbo);
        vistas.push({
          fichero,
          linea: linea(n),
          llamada: verbo,
          desc: descNodo ? descNodo.getText(sf) : null,
          presupuesto: p ? p.getText(sf) : "(sin presupuesto)",
          presupuestoEsLaConstante: p !== undefined && ts.isIdentifier(p) && p.text === NOMBRE,
        });
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return vistas;
}

/** Cada NODO identificador `MS_DEL_TILE` y qué es. */
export type Uso = {
  fichero: string;
  linea: number;
  clase: "declaracion" | "import" | "export" | "default" | "presupuesto" | "comparacion" | "interpolacion" | "otro";
  /** El valor declarado, la función del default, el verbo de la espera, la
   *  expresión que lo lee o el template en el que se imprime. */
  detalle: string;
  /** Para `presupuesto`: la línea de la llamada a la que presupuesta. */
  llamadaLinea: number | null;
};

export function usosDeLaConstante(texto: string, fichero: string): Uso[] {
  const sf = ts.createSourceFile(fichero, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const linea = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const funcionQueEnvuelve = (n: ts.Node): string => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
      if ((ts.isFunctionExpression(p) || ts.isArrowFunction(p)) && p.parent && ts.isVariableDeclaration(p.parent)) {
        return p.parent.name.getText(sf);
      }
    }
    return "(fuera de toda función)";
  };
  /** La llamada de espera a la que `n` sirve de presupuesto, si es eso.
   *
   *  Se busca por ANCESTRO y se compara por RANGO, no por padre inmediato:
   *  `waitFor(d, f, MS_DEL_TILE * 2)` presupuesta con la constante igual que
   *  `waitFor(d, f, MS_DEL_TILE)`, y mirando solo el padre el primero saldría
   *  «comparacion» —una lectura inocente— en vez de un presupuesto derivado
   *  que nadie apuntó. Mismo agujero que el censo por grafía: la forma cambia
   *  y el nodo sigue ahí. Lo que queda FUERA del rango del presupuesto —el
   *  predicado, la descripción— no es presupuesto, y por eso se compara el
   *  rango en vez de subir hasta la llamada a ciegas. */
  const llamadaQuePresupuesta = (n: ts.Node): { verbo: Verbo; call: ts.CallExpression } | null => {
    for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
      if (!ts.isCallExpression(a)) continue;
      const nombre = nombreDelCallee(a, sf);
      if (nombre === null || !(VERBOS as readonly string[]).includes(nombre)) return null;
      const verbo = nombre as Verbo;
      const p = nodoDePresupuesto(a, verbo);
      if (p === undefined) return null;
      return n.getStart(sf) >= p.getStart(sf) && n.getEnd() <= p.getEnd() ? { verbo, call: a } : null;
    }
    return null;
  };
  const usos: Uso[] = [];
  const visita = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === NOMBRE) {
      const p = n.parent;
      const base = { fichero, linea: linea(n), llamadaLinea: null as number | null };
      if (ts.isVariableDeclaration(p) && p.name === n) {
        usos.push({ ...base, clase: "declaracion", detalle: p.initializer ? p.initializer.getText(sf) : "(sin valor)" });
      } else if (ts.isImportSpecifier(p)) {
        usos.push({ ...base, clase: "import", detalle: p.getText(sf) });
      } else if (ts.isExportSpecifier(p)) {
        usos.push({ ...base, clase: "export", detalle: p.getText(sf) });
      } else if (ts.isBindingElement(p) && p.initializer === n) {
        usos.push({ ...base, clase: "default", detalle: funcionQueEnvuelve(n) });
      } else {
        // El presupuesto se mira PRIMERO: un `MS_DEL_TILE * 2` dentro del
        // argumento de un verbo es un presupuesto derivado, no una lectura, y
        // preguntando antes por `isBinaryExpression` se colaría como tal.
        const e = llamadaQuePresupuesta(n);
        if (e) usos.push({ ...base, clase: "presupuesto", detalle: e.verbo, llamadaLinea: linea(e.call) });
        else if (ts.isBinaryExpression(p)) usos.push({ ...base, clase: "comparacion", detalle: p.getText(sf) });
        else if (ts.isTemplateSpan(p)) {
          // `${MS_DEL_TILE}` dentro de un template: produce TEXTO y nada más,
          // así que no puede presupuestar nada. Es lo que hace el guion de
          // medida al imprimir el cortafuegos junto a su p95.
          const t = ts.isTemplateExpression(p.parent) ? p.parent : p;
          usos.push({ ...base, clase: "interpolacion", detalle: t.getText(sf).slice(0, 80) });
        } else usos.push({ ...base, clase: "otro", detalle: p.getText(sf).slice(0, 80) });
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return usos;
}

/** Los `pedirYEsperarTile(…)` que traen su propio `ms` (o un quinto argumento
 *  que no es un objeto literal, que es lo mismo sin poder leerlo). */
export function pedirYEsperarTileConMsPropio(texto: string, fichero: string): { fichero: string; linea: number; quinto: string }[] {
  const sf = ts.createSourceFile(fichero, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const linea = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const fuera: { fichero: string; linea: number; quinto: string }[] = [];
  const visita = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && nombreDelCallee(n, sf) === "pedirYEsperarTile") {
      const q = n.arguments[4];
      if (q !== undefined) {
        const trae = !ts.isObjectLiteralExpression(q) || q.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "ms");
        if (trae) fuera.push({ fichero, linea: linea(n), quinto: q.getText(sf) });
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return fuera;
}

/** TODO `qa/**.mjs` menos `node_modules`. `qa/run.mjs` entra: no define
 *  ninguno de estos verbos con ese nombre como llamada y, si algún día
 *  presupuestara un tile, tiene que verse. */
const ficherosDelBanco = (dir = join(repoRoot, "qa")): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : ficherosDelBanco(join(dir, e.name));
    return e.name.endsWith(".mjs") ? [join(dir, e.name).slice(repoRoot.length + 1)] : [];
  });

describe("el cortafuegos de un tile del bridge es uno y tiene dueño (#677)", () => {
  const contrato = EsperasDeTileSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
  const ficheros = ficherosDelBanco();
  const fuente = new Map(ficheros.map((f) => [f, readFileSync(join(repoRoot, f), "utf8")]));
  const usos = ficheros.flatMap((f) => usosDeLaConstante(fuente.get(f)!, f));
  const claveDeEntrada = (e: { fichero: string; llamada: string; desc: string | null }): string =>
    `${e.fichero} :: ${e.llamada}(${e.desc ?? "∅"})`;

  /** Resuelve cada entrada del padrón a sus llamadas reales. */
  const resueltas = contrato.esperas.map((e) => {
    const texto = fuente.get(e.fichero);
    const sitios = texto === undefined ? [] : esperasDeTile(texto, e.fichero).filter((s) => s.llamada === e.llamada && s.desc === e.desc);
    return { entrada: e, existe: texto !== undefined, sitios };
  });

  it("la constante se declara UNA vez, donde dice el padrón, y vale lo que dice", () => {
    const declaraciones = usos.filter((u) => u.clase === "declaracion");
    assert.deepEqual(
      declaraciones.map((d) => `${d.fichero}:${d.linea} = ${d.detalle}`),
      [`${contrato.constante.fichero}:${declaraciones[0]?.linea ?? "?"} = ${contrato.constante.valor_ms.toLocaleString("en-US").replace(/,/g, "_")}`],
      `Una sola declaración de ${NOMBRE}, en ${contrato.constante.fichero}, con el valor del contrato. Una copia local en un guion —con el valor que sea— nace verde para cualquier candado por nombre; aquí es rojo.`,
    );
  });

  it("(a) cada espera del padrón resuelve a EXACTAMENTE una llamada, y presupuesta con la constante", () => {
    const quejas: string[] = [];
    for (const { entrada, existe, sitios } of resueltas) {
      const k = claveDeEntrada(entrada);
      if (!existe) quejas.push(`${k}: el fichero no existe (la entrada CADUCÓ, bórrala)`);
      else if (sitios.length === 0) quejas.push(`${k}: ninguna llamada casa (la entrada CADUCÓ o el desc cambió)`);
      else if (sitios.length > 1) quejas.push(`${k}: ${sitios.length} llamadas casan (líneas ${sitios.map((s) => s.linea).join(", ")}) — afina el desc`);
      else if (!sitios[0].presupuestoEsLaConstante) {
        quejas.push(`${k} (línea ${sitios[0].linea}): presupuesta con \`${sitios[0].presupuesto}\` y no con ${NOMBRE}`);
      }
    }
    assert.deepEqual(
      quejas,
      [],
      `El tile del bridge tiene UN cortafuegos, ${NOMBRE} (qa/lib/tile-episodio.mjs), con su aritmética escrita. Un literal aquí es un quinto número sin porqué.`,
    );
  });

  it("(b) todo nodo MS_DEL_TILE del banco está explicado: declaración, import con uso, default, presupuesto del padrón o lector", () => {
    const sitiosDelPadron = new Set(resueltas.flatMap((r) => r.sitios.map((s) => `${s.fichero}:${s.linea}`)));
    const lectores = new Set(contrato.lectores.map((l) => l.fichero));
    const conUsoLegitimo = new Set([
      ...contrato.esperas.map((e) => e.fichero),
      ...lectores,
      contrato.default_de.fichero,
    ]);
    const quejas: string[] = [];
    for (const u of usos) {
      const donde = `${u.fichero}:${u.linea}`;
      switch (u.clase) {
        case "declaracion":
          if (u.fichero !== contrato.constante.fichero) quejas.push(`${donde}: DECLARACIÓN local (${u.detalle}) fuera de ${contrato.constante.fichero}`);
          break;
        case "import":
          if (!conUsoLegitimo.has(u.fichero)) quejas.push(`${donde}: import sin ninguna espera del padrón ni lectura declarada en este fichero`);
          break;
        case "export":
          quejas.push(`${donde}: re-export (${u.detalle}) — un segundo nombre para el mismo número es la copia por otro camino`);
          break;
        case "default":
          if (u.fichero !== contrato.default_de.fichero || u.detalle !== contrato.default_de.funcion) {
            quejas.push(`${donde}: default en ${u.detalle}, y el único default declarado es ${contrato.default_de.funcion} en ${contrato.default_de.fichero}`);
          }
          break;
        case "presupuesto":
          if (!sitiosDelPadron.has(`${u.fichero}:${u.llamadaLinea}`)) {
            quejas.push(`${donde}: presupuesta un ${u.detalle} (línea ${u.llamadaLinea}) que NO está en el padrón — apúntalo con su desc y su porqué`);
          }
          break;
        case "comparacion":
          if (!lectores.has(u.fichero)) quejas.push(`${donde}: lo compara (\`${u.detalle}\`) sin estar en \`lectores\``);
          break;
        case "interpolacion":
          if (!lectores.has(u.fichero)) quejas.push(`${donde}: lo imprime (\`${u.detalle}\`) sin estar en \`lectores\``);
          break;
        default:
          quejas.push(`${donde}: uso que este contrato no sabe explicar: \`${u.detalle}\``);
      }
    }
    assert.deepEqual(quejas, [], "cada nodo de la constante tiene que tener dueño en data/contract/esperas-de-tile.json");
  });

  it("(c) ningún pedirYEsperarTile del banco trae su propio ms: el 120 y el 127 heredan el default", () => {
    const fuera = ficheros.flatMap((f) => pedirYEsperarTileConMsPropio(fuente.get(f)!, f));
    assert.deepEqual(
      fuera.map((x) => `${x.fichero}:${x.linea} · pedirYEsperarTile(…, ${x.quinto})`),
      [],
      `El quinto argumento de pedirYEsperarTile no lleva \`ms\`: el cortafuegos es ${NOMBRE} para todos, y un {ms: N} aquí no tocaría ningún identificador y saldría verde para (b).`,
    );
    // Y hay llamadas de verdad que heredan: sin esto, un banco sin ningún
    // `pedirYEsperarTile` dejaría (c) verde sin haber mirado nada.
    const llamadas = ficheros.filter((f) => f !== contrato.default_de.fichero && /pedirYEsperarTile\s*\(/.test(fuente.get(f)!));
    assert.ok(llamadas.length >= 2, `se esperaban al menos el 120 y el 127 llamando a pedirYEsperarTile; hay ${llamadas.length}`);
  });

  it("cada lector sigue leyendo: el que ya no compara CADUCA y se borra", () => {
    const sinLectura = contrato.lectores
      .filter((l) => !usos.some((u) => u.fichero === l.fichero && u.clase === "comparacion"))
      .map((l) => l.fichero);
    assert.deepEqual(sinLectura, [], `lector(es) sin ninguna comparación con ${NOMBRE}: ${sinLectura.join(" | ")}`);
  });

  it("el padrón cubre los once sitios del censo de #677 (no nueve, no doce)", () => {
    // Nueve en el padrón + los dos que heredan el default (120, 127) = once.
    // Si mañana una espera de tile se muda a `pedirYEsperarTile`, sale de aquí
    // y entra en (c); si nace una nueva con literal, no la ve nadie (agujero
    // declarado abajo). El número se fija para que ese movimiento se VEA.
    assert.equal(contrato.esperas.length, 9, JSON.stringify(contrato.esperas.map(claveDeEntrada), null, 1));
  });

  it("el detector encuentra lo que dice encontrar (control positivo, las tres formas y las cinco clases)", () => {
    const material = `
      import { MS_DEL_TILE } from "../lib/tile-episodio.mjs";
      const MS_DEL_TILE_LOCAL = 1;
      await ctx.waitFor("el destino llega", fn, 240_000, antes);
      await ctx.waitFor("el destino llega bien", fn, MS_DEL_TILE, antes);
      await ctx.holdUntil("up", "el jugador entra en el tile", fn, { ms: MS_DEL_TILE }, arg);
      await ctx.holdUntil("up", "el jugador entra a pelo", fn, 180_000, arg);
      const dos = await esperarEnElSave(id, (s) => s.x, MS_DEL_TILE);
      if (p95 * 10 <= MS_DEL_TILE) ok();
      await pedirYEsperarTile(ctx, k, 0, 1, { ms: 240_000 });
      await pedirYEsperarTile(ctx, k, 0, 1, { reason: "prefetch" });
      await pedirYEsperarTile(ctx, k, 0, 1);
      const texto = \`agotó MS_DEL_TILE (\${ms} ms)\`;
      ctx.log(\`cortafuegos \${MS_DEL_TILE} ms\`);
      await ctx.waitFor("el doble", fn, MS_DEL_TILE * 2, antes);
    `;
    const f = "qa/guiones/de-mentira.mjs";
    assert.deepEqual(
      esperasDeTile(material, f).map((e) => `${e.llamada}:${e.desc}:${e.presupuesto}:${e.presupuestoEsLaConstante}`),
      [
        'waitFor:"el destino llega":240_000:false',
        'waitFor:"el destino llega bien":MS_DEL_TILE:true',
        'holdUntil:"el jugador entra en el tile":MS_DEL_TILE:true',
        'holdUntil:"el jugador entra a pelo":180_000:false',
        "esperarEnElSave:null:MS_DEL_TILE:true",
        'waitFor:"el doble":MS_DEL_TILE * 2:false',
      ],
      "un presupuesto DERIVADO no es la constante para (a): `MS_DEL_TILE * 2` es otro número",
    );
    assert.deepEqual(
      usosDeLaConstante(material, f).map((u) => `${u.clase}:${u.detalle}${u.llamadaLinea ? `@${u.llamadaLinea}` : ""}`),
      [
        "import:MS_DEL_TILE",
        "presupuesto:waitFor@5",
        "presupuesto:holdUntil@6",
        "presupuesto:esperarEnElSave@8",
        "comparacion:p95 * 10 <= MS_DEL_TILE",
        "interpolacion:`cortafuegos ${MS_DEL_TILE} ms`",
        "presupuesto:waitFor@15",
      ],
      "el `agotó MS_DEL_TILE` de la línea 13 NO cuenta (es texto, no un nodo) y el `* 2` de la 15 SÍ (es un presupuesto derivado, no una lectura)",
    );
    assert.deepEqual(
      pedirYEsperarTileConMsPropio(material, f).map((x) => x.quinto),
      ["{ ms: 240_000 }"],
      "solo el que trae `ms`; el `{reason}` y el sin quinto argumento heredan",
    );
  });

  it("una copia local, un default ajeno y un re-export SE VEN (control positivo de las clases que (b) prohíbe)", () => {
    const material = `
      const MS_DEL_TILE = 240_000;
      export { MS_DEL_TILE };
      async function otra(ctx, { ms = MS_DEL_TILE } = {}) {}
      const x = MS_DEL_TILE;
    `;
    assert.deepEqual(
      usosDeLaConstante(material, "qa/guiones/de-mentira.mjs").map((u) => `${u.clase}:${u.detalle}`),
      ["declaracion:240_000", "export:MS_DEL_TILE", "default:otra", "otro:x = MS_DEL_TILE"],
      "el alias (`const x = MS_DEL_TILE`) es `otro`, o sea ROJO: un segundo nombre presupuesta sin que (a) ni (c) lo vean",
    );
  });

  it("**el agujero DECLARADO, y medido**: una espera de tile NUEVA con literal no toca la constante y nadie la ve", () => {
    // El padrón es una LISTA de sitios, no un detector del sujeto «tile». Este
    // material es exactamente lo que había en el 08 antes de #677, y contra él
    // ni (a) —no está en la lista—, ni (b) —no hay ningún nodo MS_DEL_TILE—,
    // ni (c) —no es pedirYEsperarTile— dicen nada. Se escribe como caso
    // ejecutable para que se ponga ROJO el día que alguien lo cierre (un
    // detector del sujeto por el texto del desc, por ejemplo) y entonces se
    // borra este caso y su línea de `_lo_que_esto_NO_sujeta`.
    const material = `
      export default async function (ctx) {
        await ctx.waitFor("el tile vecino llega al mundo del cliente", (k) => window.__nefan.tiles.includes(k) || null, 240_000, "tile_1_0");
      }`;
    const f = "qa/guiones/de-mentira.mjs";
    assert.deepEqual(usosDeLaConstante(material, f), []);
    assert.deepEqual(pedirYEsperarTileConMsPropio(material, f), []);
    // Lo ÚNICO que lo ve es el detector de esperas, y solo si alguien lo
    // consulta con esa desc: el control del control.
    assert.equal(esperasDeTile(material, f).length, 1);
    assert.equal(esperasDeTile(material, f)[0].presupuestoEsLaConstante, false);
  });

  it("lo que va DENTRO DE UN STRING no es un nodo (por eso se lee el árbol)", () => {
    const material = 'const guion = `  await ctx.waitFor("el tile llega", fn, MS_DEL_TILE);\\n`;';
    assert.deepEqual(usosDeLaConstante(material, "qa/lib/de-mentira.mjs"), []);
    assert.deepEqual(esperasDeTile(material, "qa/lib/de-mentira.mjs"), []);
  });
});
