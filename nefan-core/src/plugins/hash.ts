/** Hash canónico de manifests (next.md §7.5).
 *
 * plugin_id = sha256(canonical_json(manifest sin `origin` ni `id`)). Mismo
 * manifest ⇒ mismo id, independientemente de quién o cuándo lo creó, del
 * orden de claves del JSON de origen, o de si los arrays opcionales se
 * escribieron vacíos u omitidos (el hash se calcula sobre el manifest
 * normalizado por PluginManifestSchema.parse, con defaults aplicados).
 *
 * Módulo aislado de types.ts a propósito: arrastra `node:crypto`, y los
 * consumidores browser (nefan-html) deben poder importar los tipos sin él.
 */
import { createHash } from "node:crypto";

import type { PluginManifest } from "./types.js";

/** JSON canónico: claves ordenadas recursivamente, sin whitespace, arrays en
 *  su orden, claves con valor `undefined` omitidas. Números no finitos o
 *  tipos no serializables (function, symbol, bigint) lanzan — fail-loud. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`canonicalJson: número no finito (${value})`);
      }
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: tipo no serializable (${typeof value})`);
  }
}

/** sha256 hex (64 chars) del manifest canónico, excluyendo `origin` (metadatos
 *  de trazabilidad, §7.1) e `id` (es el propio resultado). */
export function computePluginId(manifest: PluginManifest): string {
  const { id: _id, origin: _origin, ...hashable } = manifest;
  return createHash("sha256").update(canonicalJson(hashable)).digest("hex");
}
