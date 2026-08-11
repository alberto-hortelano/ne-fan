/** Validadores espejo de los de ai_server/narrative_schemas.py — pre-flight
 *  local para que el motor MCP reciba el error preciso ANTES de reenviar al
 *  ai_server (que aplica las mismas reglas y responde 422). Mantener en sync;
 *  las fixtures compartidas de nefan-core/data/contract/fixtures/ los
 *  ejecutan junto a los de Python y CI grita si divergen. */

import { parseVolumes, parseGround } from '@nefan/core';

/** Pre-flight check of a narrative_event response (kind === 'narrative_event')
 *  BEFORE it is forwarded to the Python ai_server. The ai_server applies the
 *  same strict rules (ai_server/narrative_schemas.py:validate_narrative_reaction)
 *  and returns HTTP 422 on any deviation — but that rejection never reaches this
 *  MCP session, so narrative_respond would report success while the player sees
 *  nothing. Validating here gives the engine the precise error so it can fix the
 *  shape and resend. Keep this mirror in sync with the Python validator. */
export function validateNarrativeReaction(data: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: `payload must be an object, got ${Array.isArray(data) ? 'array' : typeof data}` };
  }
  const raw = (data as Record<string, unknown>).consequences;
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'payload missing list `consequences`' };
  }
  if (raw.length > 4) {
    return { ok: false, error: `returned ${raw.length} consequences, max is 4` };
  }
  const validTypes = new Set(['dialogue', 'story_update', 'spawn_entity', 'schedule_event', 'plugin_event', 'noop']);
  const validKinds = new Set(['npc', 'building', 'object']);
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  for (let idx = 0; idx < raw.length; idx++) {
    const c = raw[idx];
    if (typeof c !== 'object' || c === null || Array.isArray(c)) {
      return { ok: false, error: `consequence[${idx}] is not an object` };
    }
    const o = c as Record<string, unknown>;
    const t = o.type;
    if (typeof t !== 'string' || !validTypes.has(t)) {
      return { ok: false, error: `consequence[${idx}].type='${String(t)}' is invalid; allowed: ${[...validTypes].sort().join(', ')}` };
    }
    if (t === 'noop') continue;
    if (t === 'dialogue') {
      if (!str(o.speaker)) return { ok: false, error: `dialogue[${idx}] missing required field \`speaker\`` };
      if (!str(o.text)) return { ok: false, error: `dialogue[${idx}] missing required field \`text\`` };
      if (o.choices !== undefined && o.choices !== null) {
        if (!Array.isArray(o.choices)) return { ok: false, error: `dialogue[${idx}].choices must be a list` };
        const trimmed = o.choices.map(str).filter(Boolean);
        if (trimmed.length > 3) return { ok: false, error: `dialogue[${idx}].choices has ${trimmed.length} entries, max is 3` };
      }
    } else if (t === 'story_update') {
      if (!str(o.delta)) return { ok: false, error: `story_update[${idx}] missing required field \`delta\` (non-empty string)` };
    } else if (t === 'spawn_entity') {
      if (typeof o.entity_kind !== 'string' || !validKinds.has(o.entity_kind)) {
        return { ok: false, error: `spawn_entity[${idx}].entity_kind='${String(o.entity_kind)}' invalid; allowed: ${[...validKinds].sort().join(', ')}` };
      }
      if (!str(o.description)) return { ok: false, error: `spawn_entity[${idx}] missing required field \`description\`` };
    } else if (t === 'schedule_event') {
      if (!str(o.description)) return { ok: false, error: `schedule_event[${idx}] missing required field \`description\`` };
    } else if (t === 'plugin_event') {
      if (!str(o.plugin_id)) return { ok: false, error: `plugin_event[${idx}] missing required field \`plugin_id\`` };
      if (!str(o.event_type)) return { ok: false, error: `plugin_event[${idx}] missing required field \`event_type\`` };
      if (o.payload !== undefined && (typeof o.payload !== 'object' || o.payload === null || Array.isArray(o.payload))) {
        return { ok: false, error: `plugin_event[${idx}].payload must be an object` };
      }
    }
  }
  return { ok: true };
}

/** Pre-flight estructural del array `ground` (rasgos de suelo declarativos:
 *  path/area/water/deck), espejo laxo de validate_ground
 *  (ai_server/narrative_schemas.py) y de parseGround (nefan-core, zod — la
 *  fuente de verdad). */
export function validateGroundFeatures(raw: unknown): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'ground must be an array of feature objects' };
  if (raw.length > 64) return { ok: false, error: `ground has ${raw.length} features, max is 64` };
  const kinds = new Set(['path', 'area', 'water', 'deck']);
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
  const types = new Set(['building', 'wall', 'tower', 'gate', 'tree', 'bush', 'rock', 'fountain', 'prop']);
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

/** Pre-flight de una respuesta blueprint_review, espejo de
 *  ai_server/narrative_schemas.py:validate_blueprint_review. Misma razón que
 *  validateNarrativeReaction: el 422 del ai_server no vuelve a esta sesión. */
export function validateBlueprintReview(data: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: `payload must be an object, got ${Array.isArray(data) ? 'array' : typeof data}` };
  }
  const o = data as Record<string, unknown>;
  if (typeof o.approved !== 'boolean') {
    return { ok: false, error: 'missing boolean `approved`' };
  }
  if (o.issues !== undefined && (!Array.isArray(o.issues) || o.issues.some((i) => typeof i !== 'string'))) {
    return { ok: false, error: '`issues` must be a list of strings' };
  }
  if (o.approved === false && (!Array.isArray(o.issues) || o.issues.length === 0)) {
    return { ok: false, error: 'approved=false requires a non-empty `issues` list explaining what is wrong' };
  }
  if (o.fixes !== undefined && o.fixes !== null) {
    if (typeof o.fixes !== 'object' || Array.isArray(o.fixes)) {
      return { ok: false, error: '`fixes` must be an object' };
    }
    const f = o.fixes as Record<string, unknown>;
    const allowed = new Set(['terrain', 'terrain_features', 'entity_moves', 'ground', 'volumes']);
    for (const k of Object.keys(f)) {
      if (!allowed.has(k)) return { ok: false, error: `fixes.${k} is not a valid fix; allowed: ${[...allowed].sort().join(', ')}` };
    }
    if (f.ground !== undefined) {
      const g = validateGroundFeatures(f.ground);
      if (!g.ok) return { ok: false, error: `fixes.ground must be the FULL replacement ground array: ${g.error}` };
    }
    if (f.volumes !== undefined) {
      const v = validateVolumes(f.volumes);
      if (!v.ok) return { ok: false, error: `fixes.volumes must be the FULL replacement volumes array: ${v.error}` };
    }
    if (f.terrain !== undefined && (!Array.isArray(f.terrain) || f.terrain.some((r) => typeof r !== 'string'))) {
      return { ok: false, error: 'fixes.terrain must be the FULL list of terrain row strings' };
    }
    if (f.terrain_features !== undefined && !Array.isArray(f.terrain_features)) {
      return { ok: false, error: 'fixes.terrain_features must be the FULL replacement list' };
    }
    if (f.entity_moves !== undefined) {
      if (!Array.isArray(f.entity_moves)) return { ok: false, error: 'fixes.entity_moves must be a list' };
      for (let i = 0; i < f.entity_moves.length; i++) {
        const m = f.entity_moves[i] as Record<string, unknown>;
        if (
          typeof m !== 'object' || m === null || typeof m.id !== 'string' ||
          !Array.isArray(m.cell) || m.cell.length !== 2 ||
          m.cell.some((v) => typeof v !== 'number')
        ) {
          return { ok: false, error: `fixes.entity_moves[${i}] must be { id: string, cell: [col,row] }` };
        }
      }
    }
  }
  return { ok: true };
}

/** Pre-flight de una respuesta scene_classify, espejo de
 *  ai_server/narrative_schemas.py:validate_scene_classify_response. Misma
 *  razón que validateNarrativeReaction: el 422 del ai_server no vuelve a esta
 *  sesión. `expectedIndices` viene del context.regions de la petición. */
export function validateSceneClassify(
  data: unknown,
  expectedIndices: number[] | null,
): { ok: true } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: `payload must be an object, got ${Array.isArray(data) ? 'array' : typeof data}` };
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.segments)) {
    return { ok: false, error: 'missing `segments` list' };
  }
  const seen = new Set<number>();
  for (let i = 0; i < o.segments.length; i++) {
    const s = o.segments[i] as Record<string, unknown>;
    if (typeof s !== 'object' || s === null) {
      return { ok: false, error: `segments[${i}] must be an object` };
    }
    if (!Number.isInteger(s.index) || (s.index as number) < 0) {
      return { ok: false, error: `segments[${i}].index must be a non-negative integer` };
    }
    if (seen.has(s.index as number)) {
      return { ok: false, error: `segments[${i}].index ${s.index} is duplicated` };
    }
    seen.add(s.index as number);
    if (typeof s.label !== 'string' || s.label.length === 0) {
      return { ok: false, error: `segments[${i}].label must be a non-empty string` };
    }
    if (typeof s.solid !== 'boolean' || typeof s.tall !== 'boolean') {
      return { ok: false, error: `segments[${i}].solid and .tall must be booleans` };
    }
    if (s.element_id !== undefined && (typeof s.element_id !== 'string' || s.element_id.length === 0)) {
      return { ok: false, error: `segments[${i}].element_id must be a non-empty string when present` };
    }
  }
  if (expectedIndices) {
    const missing = expectedIndices.filter((idx) => !seen.has(idx));
    if (missing.length > 0) {
      return { ok: false, error: `missing classifications for indices: ${missing.join(', ')} — every region must appear` };
    }
  }
  return { ok: true };
}

/** Pre-flight de una respuesta image_review, espejo de
 *  ai_server/narrative_schemas.py:validate_image_review. */
export function validateImageReview(data: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: `payload must be an object, got ${Array.isArray(data) ? 'array' : typeof data}` };
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.extras)) {
    return { ok: false, error: 'missing `extras` array (use { "extras": [] } if the image invented nothing)' };
  }
  if (o.extras.length > 12) {
    return { ok: false, error: `too many extras (${o.extras.length}); prioritise the 12 that matter for gameplay` };
  }
  for (let i = 0; i < o.extras.length; i++) {
    const e = o.extras[i] as Record<string, unknown>;
    if (typeof e !== 'object' || e === null) return { ok: false, error: `extras[${i}] must be an object` };
    if (typeof e.label !== 'string' || e.label.length === 0) {
      return { ok: false, error: `extras[${i}].label must be a non-empty string` };
    }
    if (e.action !== 'keep' && e.action !== 'remove') {
      return { ok: false, error: `extras[${i}].action must be "keep" or "remove"` };
    }
    if (
      !Array.isArray(e.box_px) || e.box_px.length !== 4 ||
      e.box_px.some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
      (e.box_px[2] as number) <= 0 || (e.box_px[3] as number) <= 0
    ) {
      return { ok: false, error: `extras[${i}].box_px must be [x, y, w, h] with w,h > 0` };
    }
    if (e.action === 'keep') {
      if (typeof e.tall !== 'boolean' || typeof e.solid !== 'boolean') {
        return { ok: false, error: `extras[${i}] keep requires boolean \`tall\` and \`solid\`` };
      }
      if (e.h !== undefined && (typeof e.h !== 'number' || e.h <= 0)) {
        return { ok: false, error: `extras[${i}].h must be a positive number of cells` };
      }
      if (e.depth_cells !== undefined && (typeof e.depth_cells !== 'number' || e.depth_cells <= 0)) {
        return { ok: false, error: `extras[${i}].depth_cells must be a positive number of cells` };
      }
    }
  }
  return { ok: true };
}

/** Pre-flight de una respuesta stage_review (inventario COMPLETO del plató
 *  pintado), espejo de ai_server/narrative_schemas.py:validate_stage_review.
 *  `expectedIds` (del listen) exige que cada elemento declarado aparezca
 *  exactamente una vez, found (con box_px) o missing. */
export function validateStageReview(
  data: unknown,
  expectedIds: string[] | null,
): { ok: true } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: `payload must be an object, got ${Array.isArray(data) ? 'array' : typeof data}` };
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.expected)) {
    return { ok: false, error: 'missing `expected` array — every declared element must appear as found or missing' };
  }
  const isBox = (b: unknown): b is number[] =>
    Array.isArray(b) && b.length === 4 &&
    b.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    (b[2] as number) > 0 && (b[3] as number) > 0;
  const seen = new Set<string>();
  for (let i = 0; i < o.expected.length; i++) {
    const e = o.expected[i] as Record<string, unknown>;
    if (typeof e !== 'object' || e === null) return { ok: false, error: `expected[${i}] must be an object` };
    if (typeof e.id !== 'string' || e.id.length === 0) {
      return { ok: false, error: `expected[${i}].id must be a non-empty string` };
    }
    if (seen.has(e.id)) return { ok: false, error: `expected id "${e.id}" appears twice` };
    seen.add(e.id);
    if (e.status !== 'found' && e.status !== 'missing') {
      return { ok: false, error: `expected[${i}].status must be "found" or "missing"` };
    }
    if (e.status === 'found' && !isBox(e.box_px)) {
      return { ok: false, error: `expected[${i}] ("${e.id}") is found but box_px is not [x, y, w, h] with w,h > 0` };
    }
  }
  if (expectedIds) {
    const missing = expectedIds.filter((id) => !seen.has(id));
    if (missing.length > 0) {
      return { ok: false, error: `incomplete inventory — these declared elements are unaccounted for: ${missing.join(', ')}` };
    }
    const unknown = [...seen].filter((id) => !expectedIds.includes(id));
    if (unknown.length > 0) {
      return { ok: false, error: `unknown expected ids (not in expected_elements): ${unknown.join(', ')}` };
    }
  }
  // floor: calibración de la perspectiva pintada — obligatoria.
  const floor = o.floor as Record<string, unknown> | undefined;
  if (typeof floor !== 'object' || floor === null) {
    return { ok: false, error: 'missing `floor` object — give wall_base_px (y where the walkable floor meets the back wall)' };
  }
  if (typeof floor.wall_base_px !== 'number' || !Number.isFinite(floor.wall_base_px) || floor.wall_base_px <= 0) {
    return { ok: false, error: 'floor.wall_base_px must be a positive number (y pixel)' };
  }
  if (floor.front_px !== undefined) {
    if (typeof floor.front_px !== 'number' || !Number.isFinite(floor.front_px) || floor.front_px <= floor.wall_base_px) {
      return { ok: false, error: 'floor.front_px must be a number below wall_base_px in the image (front edge is LOWER in the frame)' };
    }
  }
  // Trapecio lateral del suelo pintado (opcional, los 4 juntos): x de los
  // bordes izquierdo/derecho del suelo transitable en la línea de la pared y
  // en el frente. Calibra px_per_m/focal/centro lateral.
  const trapKeys = ['left_wall_px', 'right_wall_px', 'left_front_px', 'right_front_px'] as const;
  const present = trapKeys.filter((k) => floor[k] !== undefined);
  if (present.length > 0) {
    if (present.length !== trapKeys.length) {
      return { ok: false, error: `floor trapezoid needs all four of ${trapKeys.join(', ')} (got only ${present.join(', ')})` };
    }
    for (const k of trapKeys) {
      if (typeof floor[k] !== 'number' || !Number.isFinite(floor[k])) {
        return { ok: false, error: `floor.${k} must be a finite number (x pixel)` };
      }
    }
    const lw = floor.left_wall_px as number, rw = floor.right_wall_px as number;
    const lf = floor.left_front_px as number, rf = floor.right_front_px as number;
    if (lw >= rw) return { ok: false, error: 'floor.left_wall_px must be < right_wall_px' };
    if (lf >= rf) return { ok: false, error: 'floor.left_front_px must be < right_front_px' };
    if (rw - lw >= rf - lf) {
      return { ok: false, error: 'painted floor must converge toward the back: (right_wall_px - left_wall_px) must be < (right_front_px - left_front_px)' };
    }
  }
  // Los extras comparten forma con image_review (reutilizamos su validación).
  return validateImageReview({ extras: o.extras ?? [] });
}
