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

CRITICAL — when free_text is empty (numbered choice only):
- React in PROPORTION to what the choice means. If it asks a question, makes
  a commitment, an offer or a threat, the NPC MUST answer via a `dialogue`
  consequence (with follow-up choices when the conversation continues) — an
  empty response here reads as the game ignoring the player.
- Return an empty consequences array ONLY for trivial closers ("me voy",
  "adiós", silent nods) where the conversation naturally ends.
- Record a story_update whenever the choice changes what anyone knows, owes
  or intends — those deltas are your only long-term memory.

Pass this JSON to narrative_respond:
{
  "consequences": [
    { "type": "dialogue", "speaker": "NPC display name",
      "text": "what they say (same language as free_text)",
      "choices": ["optional", "2-3 follow-up", "options"] },
    { "type": "story_update", "delta": "1-3 sentences appended to story_so_far" },
    { "type": "spawn_entity", "entity_kind": "npc"|"building"|"object",
      "description": "vivid English description for asset gen",
      "name": "optional NPC name", "position_hint": "near_player|distant_east|...",
      "role": "optional NPC ambient role: peasant|guard|villager|merchant",
      "texture_hash": "optional reused asset hash",
      "model_hash": "optional reused asset hash" },
    { "type": "schedule_event", "description": "what to schedule",
      "trigger": "next_scene|timer:60s|on_player_action:..." },
    { "type": "plugin_event", "plugin_id": "sha256 of an ACTIVE plugin",
      "event_type": "one of the plugin's events_consumed (e.g. trade_offered)",
      "payload": { "any": "fields the plugin's rules read as event.*" } }
  ]
}
Max 4 consequences. Reuse available_assets by hash when sensible.

STRICT SHAPE — the validator REJECTS aliases:
- type MUST be exactly one of "dialogue" | "story_update" | "spawn_entity"
  | "schedule_event" | "plugin_event" | "noop". "show_dialogue" is NOT valid.
- story_update REQUIRES a non-empty "delta" field. Do not use "text" or
  "summary" — they will be rejected.
- dialogue REQUIRES non-empty "speaker" and "text"; its options field is
  "choices" (max 3), NOT "options". spawn_entity REQUIRES "entity_kind"
  (npc/building/object) and "description". schedule_event REQUIRES
  "description". plugin_event REQUIRES "plugin_id" and "event_type" and only
  makes sense for plugins the session has active — the game engine runs the
  plugin's declarative rules (commerce, reputation, ...); emit it instead of
  hand-narrating what a plugin already models.
If you produce an alias, narrative_respond rejects it here (and ai_server would
return HTTP 422). Fix the response shape, not the validator.

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