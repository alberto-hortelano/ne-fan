/** Conversor zod → JSON Schema (draft-07, subconjunto Anthropic `input_schema`).
 *
 *  Sirve al camino de FALLBACK por API directa: `tools/*.json` se regeneran
 *  desde el MISMO zod SoT que el pre-flight MCP y el bloque de prompt, para
 *  que el `input_schema` que ve el modelo por API no contradiga al validador.
 *
 *  Acotado al subconjunto de zod que usan los contratos; un typeName no
 *  soportado lanza (fail-loud, igual que render.ts). No emite `$ref`: inlina
 *  todo (los schemas son pequeños y Anthropic no comparte definiciones). */

import type { ZodTypeAny } from "zod";

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema | JsonSchema[];
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  anyOf?: JsonSchema[];
  [k: string]: unknown;
}

interface ZodDefLike {
  typeName: string;
  [k: string]: unknown;
}

function def(schema: ZodTypeAny): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def;
}

function withDescription(schema: ZodTypeAny, out: JsonSchema): JsonSchema {
  const d = def(schema).description;
  if (typeof d === "string" && d.length > 0) out.description = d;
  return out;
}

function numberConstraints(d: ZodDefLike, out: JsonSchema): void {
  const checks = (d.checks as Array<{ kind: string; value?: number; inclusive?: boolean }>) ?? [];
  for (const c of checks) {
    if (c.kind === "int") out.type = "integer";
    else if (c.kind === "min") {
      if (c.inclusive) out.minimum = c.value;
      else out.exclusiveMinimum = c.value;
    } else if (c.kind === "max") {
      if (c.inclusive) out.maximum = c.value;
      else out.exclusiveMaximum = c.value;
    } else if (c.kind === "gt") out.exclusiveMinimum = c.value;
    else if (c.kind === "lt") out.exclusiveMaximum = c.value;
  }
}

function stringConstraints(d: ZodDefLike, out: JsonSchema): void {
  const checks = (d.checks as Array<{ kind: string; value?: number }>) ?? [];
  for (const c of checks) {
    if (c.kind === "min") out.minLength = c.value;
    else if (c.kind === "max") out.maxLength = c.value;
  }
}

export function toJsonSchema(schema: ZodTypeAny): JsonSchema {
  const d = def(schema);
  switch (d.typeName) {
    case "ZodString": {
      const out: JsonSchema = { type: "string" };
      stringConstraints(d, out);
      return withDescription(schema, out);
    }
    case "ZodNumber": {
      const out: JsonSchema = { type: "number" };
      numberConstraints(d, out);
      return withDescription(schema, out);
    }
    case "ZodBoolean":
      return withDescription(schema, { type: "boolean" });
    case "ZodUnknown":
    case "ZodAny":
      return withDescription(schema, {});
    case "ZodLiteral": {
      const v = d.value as unknown;
      return withDescription(schema, { const: v, type: typeof v === "string" ? "string" : undefined });
    }
    case "ZodEnum":
      return withDescription(schema, { type: "string", enum: [...(d.values as string[])] });
    case "ZodNativeEnum":
      return withDescription(schema, {
        enum: Object.values(d.values as Record<string, string | number>).filter(
          (v) => typeof v === "string",
        ),
      });
    case "ZodOptional":
    case "ZodDefault":
      return toJsonSchema(d.innerType as ZodTypeAny);
    case "ZodNullable": {
      const inner = toJsonSchema(d.innerType as ZodTypeAny);
      const t = inner.type;
      if (typeof t === "string") inner.type = [t, "null"];
      return inner;
    }
    case "ZodEffects":
      return toJsonSchema(d.schema as ZodTypeAny);
    case "ZodArray": {
      const out: JsonSchema = { type: "array", items: toJsonSchema(d.type as ZodTypeAny) };
      const min = d.minLength as { value: number } | null;
      const max = d.maxLength as { value: number } | null;
      const exact = d.exactLength as { value: number } | null;
      if (exact) {
        out.minItems = exact.value;
        out.maxItems = exact.value;
      } else {
        if (min) out.minItems = min.value;
        if (max) out.maxItems = max.value;
      }
      return withDescription(schema, out);
    }
    case "ZodTuple": {
      const items = (d.items as ZodTypeAny[]).map(toJsonSchema);
      return withDescription(schema, {
        type: "array",
        items,
        minItems: items.length,
        maxItems: items.length,
      });
    }
    case "ZodRecord":
      return withDescription(schema, {
        type: "object",
        additionalProperties: toJsonSchema(d.valueType as ZodTypeAny),
      });
    case "ZodObject": {
      const shape = (d.shape as () => Record<string, ZodTypeAny>)();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = toJsonSchema(field);
        if (!isOptional(field)) required.push(key);
      }
      const out: JsonSchema = { type: "object", properties };
      if (required.length) out.required = required;
      // zod .strict() ⇒ unknownKeys === "strict"
      if (d.unknownKeys === "strict") out.additionalProperties = false;
      return withDescription(schema, out);
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = d.typeName === "ZodDiscriminatedUnion"
        ? [...((d.options as Map<unknown, ZodTypeAny>).values?.() ?? (d.options as ZodTypeAny[]))]
        : (d.options as ZodTypeAny[]);
      return withDescription(schema, { anyOf: (options as ZodTypeAny[]).map(toJsonSchema) });
    }
    default:
      throw new Error(`toJsonSchema: typeName no soportado '${d.typeName}' — amplía json-schema.ts`);
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  const t = def(schema).typeName;
  if (t === "ZodOptional" || t === "ZodDefault") return true;
  if (t === "ZodEffects") return isOptional(def(schema).schema as ZodTypeAny);
  return false;
}
