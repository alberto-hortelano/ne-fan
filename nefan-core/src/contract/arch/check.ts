/** Motor de reglas de frontera arquitectónica.
 *
 *  Los invariantes de CLAUDE.md ("lógica en nefan-core, los clientes solo
 *  pintan", "el bridge es el único escritor del save", fail-loud…) son prosa:
 *  el modelo los lee como directrices y se le olvidan a mitad de contexto. Las
 *  que se pueden comprobar mecánicamente viven aquí, en
 *  `data/contract/arch-rules.json`, y las verifica `test/architecture.test.ts`.
 *
 *  Este módulo es PURO: recibe los ficheros ya leídos y sus imports ya
 *  extraídos, y devuelve las violaciones. El I/O y el parseo de TypeScript
 *  viven en el borde (el test) — así el motor se testea con entradas
 *  sintéticas y no arrastra `node:fs` ni `typescript` al árbol de src/. */

import { z } from "zod";

/** Un import ya extraído de un fichero: el especificador tal cual lo escribió
 *  el autor, con la línea (1-based) donde aparece. */
export interface ImportRef {
  spec: string;
  line: number;
}

/** Fichero a examinar. `imports` solo lo traen los de TypeScript. */
export interface SourceFile {
  /** Ruta relativa a la raíz del repo, con separador `/`. */
  path: string;
  text: string;
  imports?: readonly ImportRef[];
}

export interface Violation {
  ruleId: string;
  severity: "error" | "warn";
  path: string;
  line: number;
  detail: string;
}

const ExceptionSchema = z.object({
  path: z.string(),
  /** Obligatorio: una excepción sin motivo es una regla que ya no sirve. */
  reason: z.string().min(1),
  /** Solo en reglas `text`: la PUERTA. El fichero eximido tiene EXACTAMENTE
   *  una coincidencia del patrón y vive dentro de esta función (`Clase.metodo`
   *  comprueba también la clase). Existe porque una exención por fichero
   *  exime al fichero ENTERO: una segunda llamada en el mismo fichero entraba
   *  sin que saltara nada, y si la función nombrada dejaba de llamar la
   *  exención seguía viva sin sujeto —`deadExceptions` solo mira que el
   *  fichero exista— regalando barra libre a la siguiente (QA-C de T13, #411).
   *  Con `funcion`, cero coincidencias, dos, o una en otra función son
   *  violaciones de la regla, no prosa del `reason`. */
  funcion: z.string().min(1).optional(),
});

const RuleSchema = z
  .object({
    id: z.string().min(1),
    desc: z.string().min(1),
    /** El invariante de CLAUDE.md que esta regla sustituye. */
    why: z.string().min(1),
    severity: z.enum(["error", "warn"]),
    /** Globs de los ficheros a los que aplica. */
    files: z.array(z.string()).min(1),
    /** Prohibición sobre especificadores de import (regex). */
    imports: z.object({ forbid: z.array(z.string()).min(1) }).optional(),
    /** Prohibición sobre el texto del fichero (regex, se aplica con "gm"). */
    text: z.object({ pattern: z.string().min(1) }).optional(),
    exceptions: z.array(ExceptionSchema).default([]),
    /** Solo para severity "warn": número de violaciones tolerado hoy. El test
     *  falla si CRECE — la deuda queda congelada y visible, no escondida. */
    max: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((r) => Boolean(r.imports) !== Boolean(r.text), {
    message: "cada regla declara `imports` o `text`, nunca ambos ni ninguno",
  })
  .refine((r) => r.severity === "error" || typeof r.max === "number", {
    message: "una regla `warn` debe declarar `max` (el conteo congelado)",
  })
  .refine((r) => Boolean(r.text) || r.exceptions.every((e) => e.funcion === undefined), {
    message: "`exceptions[].funcion` solo tiene sentido en una regla `text`: cuenta coincidencias del patrón",
  });

export const ArchConfigSchema = z
  .object({
    /** Nota para quien abra el JSON: qué significan severity y max. */
    $comment: z.string().optional(),
    scan: z.object({
      roots: z.array(z.object({ dir: z.string(), ext: z.array(z.string()).min(1) })).min(1),
      /** Ficheros SUELTOS, por ruta exacta relativa a la raíz del repo.
       *
       *  Existe porque hay invariantes cuyo sujeto es un fichero que no vive
       *  dentro de ningún root: `start.sh` está en la raíz del repo (7 GB con
       *  `cache/`, `saves/`, `.venv/`, `vendor/`…, así que recorrerla entera
       *  buscando `.sh` sería caro y frágil — el `ignore` es por NOMBRE de
       *  directorio y se queda corto solo) y `nefan-html/vite.config.ts` queda
       *  fuera de `nefan-html/src`. Nombrarlos es más barato y más exacto que
       *  ensanchar el escaneo, y un fichero que desaparece se nota: el
       *  colector LANZA en vez de escanear de menos en silencio. */
      files: z.array(z.string()).default([]),
      ignore: z.array(z.string()).default([]),
    }),
    rules: z.array(RuleSchema).min(1),
  })
  .strict();

export type ArchRule = z.infer<typeof RuleSchema>;
export type ArchConfig = z.infer<typeof ArchConfigSchema>;

/** Globs ya compilados. Un glob es función PURA de su cadena, así que la
 *  misma entrada da siempre la misma regex y cachearla es seguro.
 *
 *  No es micro-optimización: `checkArchitecture` llama a `matchesAny` por cada
 *  par (regla, fichero) y hoy son 24 reglas × 639 ficheros, o sea ~15.000
 *  compilaciones de regex por pasada. Medido: de los ~163 ms de una pasada,
 *  ~120 ms eran solo eso. Lo paga `npm test` en cada vuelta y `npm run deuda`
 *  cada vez que alguien mira la cola. */
const globCache = new Map<string, RegExp>();

/** Glob a regex: soporta `**` (cualquier profundidad), `*` (dentro de un
 *  segmento) y `?`. Todo lo demás se escapa — nada de sorpresas. */
export function globToRegExp(glob: string): RegExp {
  const cacheado = globCache.get(glob);
  if (cacheado) return cacheado;
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` consume también el separador para que case con cero directorios.
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  const re = new RegExp(`^${out}$`);
  globCache.set(glob, re);
  return re;
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

/** Línea (1-based) del carácter en `index`. */
export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

function violatesImport(rule: ArchRule, file: SourceFile): Violation[] {
  const forbid = rule.imports!.forbid.map((p) => new RegExp(p));
  const out: Violation[] = [];
  for (const imp of file.imports ?? []) {
    const hit = forbid.find((re) => re.test(imp.spec));
    if (!hit) continue;
    out.push({
      ruleId: rule.id,
      severity: rule.severity,
      path: file.path,
      line: imp.line,
      detail: `import prohibido: "${imp.spec}"`,
    });
  }
  return out;
}

function violatesText(rule: ArchRule, file: SourceFile): Violation[] {
  const re = new RegExp(rule.text!.pattern, "gm");
  const out: Violation[] = [];
  for (const m of file.text.matchAll(re)) {
    out.push({
      ruleId: rule.id,
      severity: rule.severity,
      path: file.path,
      line: lineOf(file.text, m.index ?? 0),
      detail: `patrón prohibido: ${JSON.stringify(m[0].slice(0, 80))}`,
    });
  }
  return out;
}

// ── Puertas: la exención que nombra su función ──────────────────────────────

/** Palabras que abren un bloque con paréntesis y parecen un método. */
const NO_SON_FUNCION = new Set(["for", "if", "while", "switch", "catch", "return", "else", "do", "try"]);

const indentDe = (t: string): number => t.length - t.trimStart().length;

interface Declaracion {
  nombre: string;
  /** true si la forma es la de un método de clase (sin `function`/`const`). */
  metodo: boolean;
}

/** Qué función/método/const declara ESTA línea, o null. Tres formas:
 *  `function f(`, `const f = ` y el método de clase `async f(...): T {`. */
function declaraFuncion(texto: string): Declaracion | null {
  const t = texto.trimStart();
  let m = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(t);
  if (m) return { nombre: m[1], metodo: false };
  m = /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=/.exec(t);
  if (m) return { nombre: m[1], metodo: false };
  m = /^(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\(.*\{\s*$/.exec(t);
  if (m && !NO_SON_FUNCION.has(m[1])) return { nombre: m[1], metodo: true };
  return null;
}

/** La función que envuelve la línea `line` (1-based), como `nombre` o
 *  `Clase.metodo`, o null si no se encuentra. Sube por la INDENTACIÓN: la
 *  primera línea menos indentada que declara algo es la dueña. Es la misma
 *  heurística del guion de QA que descubrió el hueco; no parsea TypeScript,
 *  y por eso vive detrás de un campo OPCIONAL de la exención: quien lo
 *  declare acepta que su puerta tenga una de las tres formas de arriba. */
export function enclosingFunction(text: string, line: number): string | null {
  const lineas = text.split("\n");
  if (line < 1 || line > lineas.length) return null;
  let decl: Declaracion | null = declaraFuncion(lineas[line - 1]);
  let lineaDecl = line;
  if (!decl) {
    let indent = indentDe(lineas[line - 1]);
    for (let i = line - 2; i >= 0; i--) {
      const texto = lineas[i];
      if (texto.trim() === "") continue;
      const ind = indentDe(texto);
      if (ind >= indent) continue;
      indent = ind;
      decl = declaraFuncion(texto);
      if (decl) {
        lineaDecl = i + 1;
        break;
      }
      if (ind === 0) break;
    }
  }
  if (!decl) return null;
  if (!decl.metodo) return decl.nombre;
  for (let i = lineaDecl - 2; i >= 0; i--) {
    const m = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/.exec(lineas[i]);
    if (m) return `${m[1]}.${decl.nombre}`;
  }
  return decl.nombre;
}

/** Las violaciones de una PUERTA: el fichero eximido con `funcion`. Cero
 *  coincidencias es una exención sin sujeto; toda coincidencia fuera de la
 *  función nombrada salta; y dentro de ella solo cabe UNA. */
function violatesPuerta(rule: ArchRule, exc: { path: string; funcion?: string }, file: SourceFile): Violation[] {
  const funcion = exc.funcion!;
  const matches = violatesText(rule, file);
  if (matches.length === 0) {
    return [
      {
        ruleId: rule.id,
        severity: rule.severity,
        path: file.path,
        line: 1,
        detail:
          `exención sin sujeto: \`${funcion}\` ya no casa ${JSON.stringify(rule.text!.pattern)} en este fichero — ` +
          "borra la exención o vuelve a nombrar la puerta",
      },
    ];
  }
  const out: Violation[] = [];
  let dentro = 0;
  for (const m of matches) {
    const env = enclosingFunction(file.text, m.line);
    if (env !== funcion) {
      out.push({
        ...m,
        detail: `fuera de la puerta \`${funcion}\`: esta llamada vive en \`${env ?? "(ninguna función reconocible)"}\``,
      });
      continue;
    }
    dentro++;
    if (dentro > 1) {
      out.push({ ...m, detail: `la puerta \`${funcion}\` es UNA llamada; esta es la ${dentro}ª` });
    }
  }
  return out;
}

/** Aplica todas las reglas a todos los ficheros. Orden estable: por regla (en
 *  el orden del JSON) y dentro de cada regla por ruta y línea. Un fichero
 *  eximido SIN `funcion` no se mira; uno eximido CON ella se mira como puerta. */
export function checkArchitecture(config: ArchConfig, files: readonly SourceFile[]): Violation[] {
  const out: Violation[] = [];
  for (const rule of config.rules) {
    const found: Violation[] = [];
    for (const file of files) {
      if (!matchesAny(file.path, rule.files)) continue;
      const exc = rule.exceptions.find((e) => matchesAny(file.path, [e.path]));
      if (exc) {
        if (exc.funcion) found.push(...violatesPuerta(rule, exc, file));
        continue;
      }
      found.push(...(rule.imports ? violatesImport(rule, file) : violatesText(rule, file)));
    }
    found.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    out.push(...found);
  }
  return out;
}

/** Una exención que ya no tiene sujeto: su `path` es literal y no casa con
 *  ningún fichero escaneado. */
export interface DeadException {
  ruleId: string;
  path: string;
  reason: string;
}

/** `*` o `?`: un `path` con metacaracteres es un PATRÓN (puede cubrir
 *  ficheros que aún no existen), no la promesa de un fichero concreto. */
const EXCEPTION_META = /[*?]/;

/** Excepciones sin sujeto.
 *
 *  `checkArchitecture` filtra con `matchesAny(f.path, exceptions)`: una
 *  excepción que apunta a un fichero borrado no se queja: se queda ahí
 *  pudriéndose y le regala barra libre al siguiente que cree esa ruta —
 *  heredando un `reason` que ya no dice la verdad. Así que toda `path`
 *  literal debe casar con ≥1 fichero escaneado. Los `path` con
 *  metacaracteres se saltan: son patrones y pueden legítimamente no casar
 *  con nada hoy. */
export function deadExceptions(config: ArchConfig, files: readonly SourceFile[]): DeadException[] {
  const scanned = new Set(files.map((f) => f.path));
  const out: DeadException[] = [];
  for (const rule of config.rules) {
    for (const exc of rule.exceptions) {
      if (EXCEPTION_META.test(exc.path) || scanned.has(exc.path)) continue;
      out.push({ ruleId: rule.id, path: exc.path, reason: exc.reason });
    }
  }
  return out;
}

/** Texto del fallo de `deadExceptions`, escrito para quien borró el fichero
 *  y no sabe por qué se le ha puesto rojo el checker. */
export function formatDeadExceptions(dead: readonly DeadException[]): string {
  return [
    "Excepciones de arch-rules.json sin sujeto: el fichero exento ya no existe.",
    "Bórralas del JSON — si no, la exención revive sola el día que alguien",
    "vuelva a crear esa ruta, con un motivo que ya no es cierto.",
    ...dead.map((d) => `  [${d.ruleId}] ${d.path} — "${d.reason}"`),
  ].join("\n");
}

export interface RuleReport {
  rule: ArchRule;
  violations: Violation[];
  /** Solo en reglas `warn`: cómo queda el conteo frente al `max` congelado. */
  budget: "ok" | "excedido" | "mejorable" | null;
}

/** Agrupa por regla y decide el veredicto de cada una. Una regla `error` falla
 *  con una sola violación; una `warn` falla solo si CRECE sobre su `max`, y
 *  avisa (sin fallar) cuando alguien ha bajado la deuda y toca reapretar. */
export function reportByRule(config: ArchConfig, violations: readonly Violation[]): RuleReport[] {
  return config.rules.map((rule) => {
    const own = violations.filter((v) => v.ruleId === rule.id);
    let budget: RuleReport["budget"] = null;
    if (rule.severity === "warn") {
      const max = rule.max ?? 0;
      budget = own.length > max ? "excedido" : own.length < max ? "mejorable" : "ok";
    }
    return { rule, violations: own, budget };
  });
}

/** Texto del fallo para el test: qué se rompió, dónde y cómo se repara. */
export function formatFailure(report: RuleReport): string {
  const lines = [
    `[${report.rule.id}] ${report.rule.desc}`,
    `  invariante: ${report.rule.why}`,
    ...report.violations.slice(0, 20).map((v) => `  ${v.path}:${v.line} — ${v.detail}`),
  ];
  if (report.violations.length > 20) lines.push(`  … y ${report.violations.length - 20} más`);
  lines.push(
    report.rule.severity === "error"
      ? "  Repara el import/patrón, o añade una excepción CON MOTIVO en data/contract/arch-rules.json"
      : `  Deuda congelada en max=${report.rule.max}; este cambio la sube a ${report.violations.length}`,
  );
  return lines.join("\n");
}
