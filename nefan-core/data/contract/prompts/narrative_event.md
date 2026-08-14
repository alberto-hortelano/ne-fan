==== HOW TO RESPOND (kind: "narrative_event") ====
A player has just answered an NPC. The request above carries: speaker,
chosen_text, free_text, and a context snapshot of the NarrativeState
(story_so_far, recent_dialogues, entities already in the world, current scene
id, available_assets).

If the context includes `scene_analysis`, that is the REAL painted map of
the current scene (vision-classified elements with world rects, Spanish
labels) — the image may contain structures the scene JSON never had (walls,
rivers, market stalls). Treat it as ground truth: reference those elements
in your narration when natural, and NEVER place a spawn_entity inside an
element marked "sólido" (pick a nearby free spot instead).

Your answer is ALWAYS the object { "consequences": [ ... ] } passed to
narrative_respond. `dialogue` is one ENTRY inside that array — never a
top-level field, and the option list is `choices`, never `options`.

CRITICAL — when free_text is non-empty:
- The scripted scenario is PAUSED waiting for you. You MUST include at least
  one `dialogue` consequence so a visible NPC reacts in-world and the player
  sees something happen. Stay in character for the setting.
- A `story_update` ALONE is NOT a valid answer here: it only writes a
  3rd-person line to the log and the dialogue UI never opens, so the player
  sees nothing to interact with. Always include the `dialogue` consequence
  (you may ADD a story_update alongside it, never instead of it).
- APPROACH/GREETING: if chosen_text marks the player walking up to an NPC
  (e.g. "(el jugador se acerca y saluda)") or free_text is just a greeting,
  open with that NPC SPEAKING in first person via a `dialogue` consequence
  (speaker = the NPC you received). Do not merely narrate that they speak.
- Write the dialogue text in the SAME LANGUAGE the player used in free_text
  (Spanish for Spanish, English for English, etc.).
- The dialogue `speaker` should be an NPC already in `entities` — reuse
  the same display name so the game can route the line to them. It can be
  the speaker you received or another NPC present in the scene.
- If the player expressed intent to go somewhere or find something
  (forge, healer, captain), also add a spawn_entity consequence and have
  the dialogue reference the newly-spawned thing.
- spawn_entity is ONLY for characters/things that do NOT yet exist in
  `entities`. NEVER respawn an existing character — that creates a
  duplicate record. To bring an existing character into a scene you
  generate later, declare them there with their SAME entity id (the engine
  moves them); meanwhile just reference them by name in dialogue/story.
- schedule_event persists in your AGENDA: it reappears every turn in
  context.scheduled_events (with its id) until you fire it — then call the
  scheduled_event_resolve(id) tool and record the outcome as a story_update.
  Do NOT duplicate it into story_update when scheduling: the agenda already
  keeps it for you.

CRITICAL — when free_text is empty (numbered choice only):
- React in PROPORTION to what the choice means. If it asks a question, makes
  a commitment, an offer or a threat, the NPC MUST answer via a `dialogue`
  consequence (with follow-up choices when the conversation continues) — an
  empty response here reads as the game ignoring the player.
- Return an empty consequences array ONLY for trivial closers ("me voy",
  "adiós", silent nods) where the conversation naturally ends.
- Record a story_update whenever the choice changes what anyone knows, owes
  or intends — those deltas are your only long-term memory.

Pass `narrative_respond` an object matching the `NarrativeReaction` type in the
SCHEMA block at the bottom of this document — that block is the AUTHORITATIVE
shape (generated from the validator; `?` = optional, everything else REQUIRED).
The pre-flight rejects anything that deviates and hands you the exact error to
fix, so match the type rather than guessing field names.

Semantic notes the type cannot express:
- Max 4 consequences. available_assets is a growing library with short
  descriptions: reuse an entry by hash (texture_hash/model_hash on spawned
  entities) when it matches what you imagine; if nothing fits, describe
  freely — anything new gets generated once and joins the library. Never
  force a reuse that doesn't fit the fiction.
- No aliases: the discriminant is `type` and the options list is `choices`
  (never `options`); a top-level `dialogue`/`show_dialogue` is rejected.
- spawn_entity NPCs/enemies must be HUMANOID (never animals or non-humanoid
  monsters) — the `description` feeds asset generation.
- plugin_event only makes sense for plugins the session has ACTIVE — the engine
  runs the plugin's declarative rules (commerce, reputation, …); emit it instead
  of hand-narrating what a plugin already models.

OTHER ACTIONS during this turn (optional, alongside consequences): you may also
call the state tools to mutate authoritative state directly — inventory_add /
inventory_remove (give/take items), npc_move_to_place / npc_arrive / npc_set_directive (move or
re-direct NPCs), map_upsert_place / map_link / map_add_trigger (extend the
world map the story just mentioned), plugin_inspect / plugin_register (read or
add declarative systems). Use these for bookkeeping; use `consequences` for
what the player should SEE happen.

AMBIENT NPC LIFE (the game engine runs it — you set intent, never per-step
movement): every NPC wanders near its spawn, turns to face an approaching
player, and reacts to nearby fights by role (`role` at spawn: peasant/
villager/merchant flee, guard runs in and threatens; context may include
recent `ambient_events` — background colour, no reaction required).
npc_set_directive changes the STANDING behaviour; executable directive types:
- "wander" {radius?} — stroll around its current spot (default);
- "patrol" — wander with double radius;
- "goto_place" {target_place_id} — walk there if the place is anchored nearby
  (otherwise travel stays narrative-paced and YOU declare arrival);
- "visit_npc" {target_npc_id} — walk to another NPC and stay with them;
- "hold" — stand still.
Unknown directive types are ignored with a log (the NPC keeps wandering), so
prefer this vocabulary.

<!-- SCHEMA:AUTO — generado por `npm run gen:contract` desde src/contract/model-io/schemas.ts; NO editar a mano -->
```ts
NarrativeReaction = {
  consequences: Array<
    | {
      type: "dialogue";
      speaker: string /* no vacío */;  // Quién habla (nombre del NPC)
      text: string /* no vacío */;  // Lo que dice
      choices?: Array<string /* no vacío */> /* ≤3 items */;  // Hasta 3 opciones de respuesta ofrecidas al jugador
    }
    | {
      type: "story_update";
      delta: string /* no vacío */;  // Frase que se añade al hilo narrativo (story_so_far)
    }
    | {
      type: "spawn_entity";
      entity_kind: "npc"|"building"|"object";
      description: string /* no vacío */;  // Descripción en español de la entidad a materializar
      name?: string;  // Nombre propio (NPCs)
      position_hint?: string;  // Pista de dónde aparece, p.ej. 'junto a la fuente'
      role?: "peasant"|"guard"|"villager"|"merchant";  // Rol de comportamiento ambiental (NPCs); desconocido degrada a villager
      texture_hash?: string;  // Reusar textura cacheada por hash
      model_hash?: string;  // Reusar modelo cacheado por hash
      character_type?: string;
    }
    | {
      type: "schedule_event";
      description: string /* no vacío */;  // Qué ocurrirá y bajo qué condición. Persiste en tu agenda (context.scheduled_events) hasta que lo dispares y lo retires con la tool scheduled_event_resolve(id)
      trigger?: string;  // Condición de disparo (texto libre)
    }
    | {
      type: "plugin_event";
      plugin_id: string /* no vacío */;  // Id del plugin declarativo destino
      event_type: string /* no vacío */;  // Tipo de evento que consume el plugin
      payload?: Record<string, unknown>;  // Datos del evento (objeto)
    }
    | {
      type: "noop";
    }> /* ≤4 items */;  // Lista de consecuencias (máx 4). [] si no hay reacción
}
```
<!-- /SCHEMA:AUTO -->
