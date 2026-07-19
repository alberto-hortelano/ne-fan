/** Validadores espejo de los de ai_server/narrative_schemas.py — pre-flight
 *  local para que el motor MCP reciba el error preciso ANTES de reenviar al
 *  ai_server (que aplica las mismas reglas y responde 422). Mantener en sync;
 *  las fixtures compartidas de nefan-core/data/contract/fixtures/ los
 *  ejecutan junto a los de Python y CI grita si divergen. */

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
    const allowed = new Set(['terrain', 'terrain_features', 'entity_moves', 'map_ground', 'volumes']);
    for (const k of Object.keys(f)) {
      if (!allowed.has(k)) return { ok: false, error: `fixes.${k} is not a valid fix; allowed: ${[...allowed].sort().join(', ')}` };
    }
    if (f.map_ground !== undefined && (typeof f.map_ground !== 'string' || !f.map_ground.trim().startsWith('<svg'))) {
      return { ok: false, error: 'fixes.map_ground must be the FULL corrected SVG document (a string starting with <svg)' };
    }
    if (f.volumes !== undefined && !Array.isArray(f.volumes)) {
      return { ok: false, error: 'fixes.volumes must be the FULL replacement volumes array' };
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
