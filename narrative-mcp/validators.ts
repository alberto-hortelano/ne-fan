/** Validadores espejo de los de ai_server/narrative_schemas.py — pre-flight
 *  local para que el motor MCP reciba el error preciso ANTES de reenviar al
 *  ai_server (que aplica las mismas reglas y responde 422). Mantener en sync;
 *  las fixtures compartidas de nefan-core/data/contract/fixtures/ los
 *  ejecutan junto a los de Python y CI grita si divergen. */

import {
  parseVolumes,
  parseGround,
  validateContract,
  NarrativeReactionSchema,
  WeaponOrientSchema,
  WeaponVerifySchema,
  FormatDSceneSchema,
} from '@nefan/core';

/** Gate ESTRUCTURAL de una escena Format D (entities, size, terrain, legend,
 *  tile/biome + sub-partes ground/volumes). Delega en el zod SoT. Antes
 *  el top-level de la escena no se validaba en ninguna parte que volviera al
 *  modelo: ai_server lo DEGRADABA en silencio (terrain mal → padding, entities
 *  malformadas → clamp). La jugabilidad la valida aparte /scene/validate. */
export function validateFormatDScene(data: unknown): { ok: true } | { ok: false; error: string } {
  return validateContract(FormatDSceneSchema, data);
}

/** Pre-flight de una respuesta weapon_orient / weapon_verify — delega en el
 *  zod SoT. Antes NO existía: el kind pasaba directo a sendVisionResponse sin
 *  validar, y el ai_server devolvía None en silencio (503), así que una malla
 *  mal orientada por el modelo NUNCA volvía al modelo. */
export function validateWeaponOrient(data: unknown): { ok: true } | { ok: false; error: string } {
  return validateContract(WeaponOrientSchema, data);
}
export function validateWeaponVerify(data: unknown): { ok: true } | { ok: false; error: string } {
  return validateContract(WeaponVerifySchema, data);
}

/** Pre-flight check of a narrative_event response (kind === 'narrative_event')
 *  BEFORE it is forwarded to the Python ai_server. Delegates to the zod SoT
 *  (`NarrativeReactionSchema` in nefan-core) — the SAME schema that renders the
 *  contract block injected into narrative_event.md and the narrative_react.json
 *  tool, so "optional in the prompt" == "optional in the validator" by
 *  construction. The ai_server applies the mirror rules
 *  (ai_server/narrative_schemas.py:validate_narrative_reaction) and returns 422,
 *  but that rejection never reaches this MCP session — validating here hands the
 *  engine the precise error so it can fix the shape and resend. */
export function validateNarrativeReaction(data: unknown): { ok: true } | { ok: false; error: string } {
  return validateContract(NarrativeReactionSchema, data);
}

/** Pre-flight estructural del array `ground` (rasgos de suelo declarativos:
 *  path/area/water/deck/hill), espejo laxo de validate_ground
 *  (ai_server/narrative_schemas.py) y de parseGround (nefan-core, zod — la
 *  fuente de verdad). */
export function validateGroundFeatures(raw: unknown): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'ground must be an array of feature objects' };
  if (raw.length > 64) return { ok: false, error: `ground has ${raw.length} features, max is 64` };
  const kinds = new Set(['path', 'area', 'water', 'deck', 'hill']);
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const pair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(num);
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i] as Record<string, unknown>;
    if (typeof f !== 'object' || f === null) return { ok: false, error: `ground[${i}] must be an object` };
    if (typeof f.id !== 'string' || !f.id) return { ok: false, error: `ground[${i}].id must be a non-empty string` };
    if (seen.has(f.id)) return { ok: false, error: `ground id "${f.id}" appears twice` };
    seen.add(f.id);
    if (typeof f.kind !== 'string' || !kinds.has(f.kind)) {
      return { ok: false, error: `ground[${i}].kind='${String(f.kind)}' invalid; allowed: ${[...kinds].sort().join(', ')}` };
    }
    if (f.kind === 'path') {
      if (!Array.isArray(f.points) || f.points.length < 2 || !f.points.every(pair)) {
        return { ok: false, error: `ground[${i}] path needs \`points\` (≥2 [col,row] pairs)` };
      }
    } else {
      let shapes = 0;
      if (f.rect !== undefined) {
        if (!Array.isArray(f.rect) || f.rect.length !== 4 || !f.rect.every(num)) {
          return { ok: false, error: `ground[${i}].rect must be [col, row, w, d]` };
        }
        shapes++;
      }
      if (f.polygon !== undefined) {
        if (!Array.isArray(f.polygon) || f.polygon.length < 3 || !f.polygon.every(pair)) {
          return { ok: false, error: `ground[${i}].polygon must be ≥3 [col,row] pairs` };
        }
        shapes++;
      }
      if (f.ellipse !== undefined) {
        const e = f.ellipse as Record<string, unknown>;
        if (typeof e !== 'object' || e === null || !pair(e.center) || !num(e.rx) || !num(e.ry)) {
          return { ok: false, error: `ground[${i}].ellipse must be { center: [col,row], rx, ry }` };
        }
        shapes++;
      }
      if (shapes !== 1) {
        return { ok: false, error: `ground[${i}] ("${f.id}") needs exactly one of rect | polygon | ellipse (has ${shapes})` };
      }
      if (f.kind === 'hill' && (!num(f.h) || f.h === 0 || Math.abs(f.h) > 6)) {
        return { ok: false, error: `ground[${i}] hill needs \`h\` in METRES (-6..6, non-zero; positive knoll, negative hollow)` };
      }
    }
  }
  // Pasada final con el zod de produccion (mismas razones que en volumes:
  // p.ej. \`area\` sin \`material\` o un material fuera del enum).
  const strictG = parseGround(raw);
  if (!strictG.ok) return { ok: false, error: strictG.error };
  return { ok: true };
}

/** Pre-flight estructural del array `volumes` — espejo de parseVolumes
 *  (nefan-core/src/scene/blueprint/volumes.ts, zod — la fuente de verdad).
 *  FAIL-LOUD con reintento: el primer volumen inválido detiene la respuesta
 *  con el índice y el motivo, y el motor re-responde corregido. Sin esto, el
 *  saneador del ai_server descartaba y el pueblo llegaba mutilado en
 *  silencio (2026-08-11: un prop sin shape ⇒ tile sin un solo edificio). */
export function validateVolumes(raw: unknown): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'volumes must be an array of typed objects' };
  if (raw.length > 160) return { ok: false, error: `volumes has ${raw.length} items, max is 160` };
  const types = new Set(['building', 'wall', 'tower', 'gate', 'tree', 'bush', 'rock', 'fountain', 'prop', 'prism', 'custom']);
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const pair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(num);
  const rect4 = (v: unknown): boolean => Array.isArray(v) && v.length === 4 && v.every(num);
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i] as Record<string, unknown>;
    const ctx = `volumes[${i}]`;
    if (typeof v !== 'object' || v === null) return { ok: false, error: `${ctx} must be an object` };
    if (typeof v.id !== 'string' || !v.id) return { ok: false, error: `${ctx}.id must be a non-empty string` };
    if (seen.has(v.id)) return { ok: false, error: `volumes id "${v.id}" appears twice` };
    seen.add(v.id);
    if (typeof v.label !== 'string' || !v.label) {
      return { ok: false, error: `${ctx} ("${v.id}") needs a Spanish \`label\`` };
    }
    if (typeof v.type !== 'string' || !types.has(v.type)) {
      return { ok: false, error: `${ctx} ("${v.id}") type='${String(v.type)}' invalid; allowed: ${[...types].sort().join(', ')}` };
    }
    if (v.type === 'building') {
      if (!rect4(v.rect)) return { ok: false, error: `${ctx} ("${v.id}") building needs \`rect\`: [col, row, w, d]` };
      if (v.cutaway === true && v.angle !== undefined) {
        return { ok: false, error: `${ctx} ("${v.id}") cutaway buildings cannot take \`angle\`` };
      }
    } else if (v.type === 'wall') {
      if (!Array.isArray(v.points) || v.points.length < 2 || !v.points.every(pair)) {
        return { ok: false, error: `${ctx} ("${v.id}") wall needs \`points\` (≥2 [col,row] pairs)` };
      }
    } else if (v.type === 'gate') {
      if (!pair(v.at) || (v.orient !== 'x' && v.orient !== 'y')) {
        return { ok: false, error: `${ctx} ("${v.id}") gate needs \`at\`: [col,row] and \`orient\`: "x"|"y"` };
      }
    } else if (v.type === 'prop') {
      if (v.shape !== 'box' && v.shape !== 'cylinder') {
        return { ok: false, error: `${ctx} ("${v.id}") prop needs \`shape\`: "box"|"cylinder"` };
      }
      const hasAt = pair(v.at);
      const hasRect = rect4(v.rect);
      if (hasAt === hasRect) {
        return { ok: false, error: `${ctx} ("${v.id}") prop needs exactly one of \`at\` | \`rect\`` };
      }
      if (hasAt && v.angle !== undefined) {
        return { ok: false, error: `${ctx} ("${v.id}") prop \`angle\` requires \`rect\` (an \`at\` point has nothing to rotate)` };
      }
    } else if (v.type === 'prism') {
      if (!Array.isArray(v.points) || v.points.length < 3 || !v.points.every(pair)) {
        return { ok: false, error: `${ctx} ("${v.id}") prism needs \`points\` (≥3 [col,row] pairs — the outline)` };
      }
      if (!num(v.h) || v.h <= 0) {
        return { ok: false, error: `${ctx} ("${v.id}") prism needs a positive \`h\` (height in cells)` };
      }
    } else if (v.type === 'custom') {
      if (!pair(v.at)) {
        return { ok: false, error: `${ctx} ("${v.id}") custom needs \`at\`: [col, row]` };
      }
      if (!Array.isArray(v.parts) || v.parts.length === 0 || v.parts.length > 24) {
        return { ok: false, error: `${ctx} ("${v.id}") custom needs \`parts\` (1..24 pieces)` };
      }
    } else if (!pair(v.at)) {
      return { ok: false, error: `${ctx} ("${v.id}") ${v.type} needs \`at\`: [col, row]` };
    }
    if (v.angle !== undefined && (v.type === 'building' || v.type === 'prop')) {
      if (!num(v.angle) || v.angle < -180 || v.angle > 180) {
        return { ok: false, error: `${ctx} ("${v.id}") \`angle\` must be a number in [-180, 180] degrees` };
      }
    }
  }
  // Pasada final con el zod de PRODUCCION (el que ejecuta el cliente): las
  // reglas que este espejo no replica (claves desconocidas, rangos, enums)
  // rebotan aqui al motor en vez de tumbar el array entero en el cliente.
  const strict = parseVolumes(raw);
  if (!strict.ok) return { ok: false, error: strict.error };
  return { ok: true };
}


