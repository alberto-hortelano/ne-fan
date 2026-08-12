/** Renderizador zod → firma TypeScript-ish legible por el modelo.
 *
 *  Fuente única de verdad (SoT): los schemas zod de `model-io/schemas.ts`
 *  producen el TEXTO de contrato que se inyecta en los prompts (.md) Y el
 *  validador del pre-flight MCP. Así la prosa no puede decir "opcional" cuando
 *  el tipo exige el campo: el bloque de schema del prompt ES el tipo.
 *
 *  El formato es una firma tipo TypeScript compacta (no JSON Schema): un
 *  modelo la lee de un vistazo y ve required (`x:`) vs optional (`x?:`), enums
 *  y rangos (en comentarios). No pretende cubrir TODO zod, solo el subconjunto
 *  que usan los contratos del motor narrativo; un typeName no soportado lanza
 *  (fail-loud: preferimos romper el codegen a emitir un contrato incompleto). */

import type { ZodTypeAny } from "zod";

interface RenderOpts {
  indent: string;
}

/** Def interno de zod (v3). Accedemos a `_def` porque zod no expone
 *  introspección pública; acotado a los typeName que usamos. */
interface ZodDefLike {
  typeName: string;
  [k: string]: unknown;
}

function def(schema: ZodTypeAny): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def;
}

/** Descripción declarada con `.describe(...)`, si la hay. */
function description(schema: ZodTypeAny): string | undefined {
  const d = def(schema).description;
  return typeof d === "string" && d.length > 0 ? d : undefined;
}

/** Sufijo de comentario con rango/descr para números y strings. */
function numericAnnotations(d: ZodDefLike): string[] {
  const notes: string[] = [];
  const checks = (d.checks as Array<{ kind: string; value?: number; inclusive?: boolean }>) ?? [];
  for (const c of checks) {
    if (c.kind === "int") notes.push("entero");
    else if (c.kind === "min") notes.push(`≥${c.value}`);
    else if (c.kind === "max") notes.push(`≤${c.value}`);
    else if (c.kind === "gt") notes.push(`>${c.value}`);
    else if (c.kind === "lt") notes.push(`<${c.value}`);
  }
  return notes;
}

function stringAnnotations(d: ZodDefLike): string[] {
  const notes: string[] = [];
  const checks = (d.checks as Array<{ kind: string; value?: number }>) ?? [];
  for (const c of checks) {
    if (c.kind === "min") notes.push(c.value === 1 ? "no vacío" : `≥${c.value} chars`);
    else if (c.kind === "max") notes.push(`≤${c.value} chars`);
  }
  return notes;
}

function arrayAnnotations(d: ZodDefLike): string[] {
  const notes: string[] = [];
  const min = d.minLength as { value: number } | null;
  const max = d.maxLength as { value: number } | null;
  const exact = d.exactLength as { value: number } | null;
  if (exact) notes.push(`exactamente ${exact.value}`);
  else {
    if (min) notes.push(`≥${min.value}`);
    if (max) notes.push(`≤${max.value}`);
  }
  return notes;
}

/** Renderiza un schema a su firma. `opts.indent` es la sangría actual (para
 *  objetos anidados multilínea). Devuelve el texto SIN sangría inicial. */
function renderNode(schema: ZodTypeAny, opts: RenderOpts): string {
  const d = def(schema);
  switch (d.typeName) {
    case "ZodString": {
      const notes = stringAnnotations(d);
      return notes.length ? `string /* ${notes.join(", ")} */` : "string";
    }
    case "ZodNumber": {
      const notes = numericAnnotations(d);
      return notes.length ? `number /* ${notes.join(", ")} */` : "number";
    }
    case "ZodBoolean":
      return "boolean";
    case "ZodUnknown":
    case "ZodAny":
      return "unknown";
    case "ZodLiteral":
      return JSON.stringify((d.value as unknown));
    case "ZodEnum":
      return (d.values as string[]).map((v) => JSON.stringify(v)).join("|");
    case "ZodNativeEnum":
      return Object.values(d.values as Record<string, string | number>)
        .filter((v) => typeof v === "string")
        .map((v) => JSON.stringify(v))
        .join("|");
    case "ZodOptional":
      return renderNode(d.innerType as ZodTypeAny, opts);
    case "ZodNullable":
      return `${renderNode(d.innerType as ZodTypeAny, opts)}|null`;
    case "ZodDefault":
      return renderNode(d.innerType as ZodTypeAny, opts);
    case "ZodEffects":
      // .refine/.superRefine/.transform envuelven el schema real.
      return renderNode(d.schema as ZodTypeAny, opts);
    case "ZodTuple": {
      const items = (d.items as ZodTypeAny[]).map((it) => renderNode(it, opts));
      return `[${items.join(", ")}]`;
    }
    case "ZodArray": {
      const inner = renderNode(d.type as ZodTypeAny, opts);
      const notes = arrayAnnotations(d);
      const suffix = notes.length ? ` /* ${notes.join(", ")} items */` : "";
      return `Array<${inner}>${suffix}`;
    }
    case "ZodRecord": {
      const val = renderNode(d.valueType as ZodTypeAny, opts);
      return `Record<string, ${val}>`;
    }
    case "ZodObject":
      return renderObject(schema, opts);
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = d.typeName === "ZodDiscriminatedUnion"
        ? [...(d.options as Map<unknown, ZodTypeAny> | ZodTypeAny[]).values?.() ?? (d.options as ZodTypeAny[])]
        : (d.options as ZodTypeAny[]);
      const inline = (options as ZodTypeAny[]).map((o) => renderNode(o, opts));
      // Uniones de objetos: una variante por línea con "| " para legibilidad,
      // con el cuerpo sangrado bajo el "| ".
      const multiline = inline.some((r) => r.includes("\n")) || inline.length > 3;
      if (multiline) {
        const pad = opts.indent + "  ";
        const rendered = (options as ZodTypeAny[]).map((o) => renderNode(o, { indent: pad }));
        return rendered.map((r) => `\n${pad}| ${r}`).join("");
      }
      return inline.join(" | ");
    }
    default:
      throw new Error(`render: typeName no soportado '${d.typeName}' — amplía render.ts`);
  }
}

function renderObject(schema: ZodTypeAny, opts: RenderOpts): string {
  const d = def(schema);
  const shape = (d.shape as () => Record<string, ZodTypeAny>)();
  const keys = Object.keys(shape);
  if (keys.length === 0) return "{}";
  const pad = opts.indent + "  ";
  const childOpts = { indent: pad };
  const lines: string[] = [];
  for (const key of keys) {
    const field = shape[key];
    const optional = isOptional(field);
    const rendered = renderNode(field, childOpts);
    const desc = description(field);
    const comment = desc ? `  // ${desc}` : "";
    lines.push(`${pad}${key}${optional ? "?" : ""}: ${rendered};${comment}`);
  }
  return `{\n${lines.join("\n")}\n${opts.indent}}`;
}

function isOptional(schema: ZodTypeAny): boolean {
  const t = def(schema).typeName;
  if (t === "ZodOptional" || t === "ZodDefault") return true;
  if (t === "ZodEffects") return isOptional(def(schema).schema as ZodTypeAny);
  return false;
}

/** Punto de entrada: renderiza un schema con nombre a un bloque de contrato
 *  listo para inyectar en un prompt. `name` es el nombre del tipo raíz. */
export function renderContract(name: string, schema: ZodTypeAny): string {
  const body = renderNode(schema, { indent: "" });
  return `${name} = ${body}`;
}
