==== UI SYSTEMS REFERENCE (what the player sees, and how YOU drive it) ====
Every UI system of the game client, its options, how it works, and how the
narrative engine manages each one. The per-turn context tells you which
options are ACTIVE (world.render_mode, world.combat_system, plugins[]); the
`ui_state` block returned with this document confirms them.
You never switch these systems yourself — they are frozen per save; you adapt
your output to whichever is active.

── 1. THE WORLD ───────────────────────────────────────────────────────────
There is ONE view and it is not an option: first person, retro-FPS style,
at eye level over a continuous plane of 64 m tiles. Mouse look, WASD
relative to facing.

You receive `generate_tile` requests (TILE instructions get prepended
automatically) and the player walks across tile seams with no transition.
The art of the world is an atlas of surfaces, so `surface_desc`/`surface_ref`
on your volumes decide what each face looks like. Travel UI: walking, plus a
TravelPanel listing the exits (world-map links) of the active place; near an
ungenerated border the client PROPOSES the neighbour tile and the player
confirms with Y (that confirmation triggers a generate_tile request to you).

── 2. DIALOGUE ────────────────────────────────────────────────────────────
How it reaches the player: a panel with a PORTRAIT of the speaker, their
name, your text, and numbered choices [1][2][3] — each choice is both a key
and a clickable button; the player can also press [T] (or click) and type a
FREE answer. While the panel is open, movement and combat input are
suppressed.
The portrait is why the `speaker` field matters beyond flavour: the server
matches that name against the NPCs in `entities` and shows that character's
face (their AI skin if it exists, otherwise the neutral base model). A
speaker that matches no NPC still works — it just shows no face.
How you drive it:
- Emit `{type: "dialogue", speaker, text, choices: [...]}` inside
  `consequences` (interactions arrive to you as narrative events; answer
  them with consequences).
- Reuse the NPC's exact display name as `speaker`, so the line is routed to
  the right character.
- The player's pick (or free text, verbatim) comes back to you as a
  dialogue_choice event — ALWAYS answer it (story_update, more dialogue,
  spawns…). 2-3 short choices, Spanish, in-world register.

── 3. INTERACTION PROMPT ──────────────────────────────────────────────────
Near an NPC the client offers "hablar con <nombre>" as a button labelled
with its key [E] (every action in the UI is both). Pressing E (or clicking)
sends an
interact event with the entity id; you answer with consequences (usually a
dialogue). NPCs must therefore have Spanish names/descriptions worth talking
to.

── 4. DYNAMIC SPAWNS ──────────────────────────────────────────────────────
`{type: "spawn_entity", ...}` consequences materialize IN the live scene,
no reload:
- NPCs/creatures: appear with an AI-skinned character sprite from their
  Spanish description; hostile ones need the `combat` block (see 5).
- Props/buildings: appear as schematic boxes until the scene is next
  regenerated/repainted. Their footprint blocks movement either way.
Use spawns to react to choices ("quiero ir a la forja" → spawn the smith),
never to rebuild whole scenes.

── 5. COMBAT (world.combat_system) ────────────────────────────────────────
Real-time melee runs in the simulation — you NEVER resolve fights; you set
them up and narrate around them.
- "standard": 5 attack types (quick/heavy/medium/defensive/precise, HUD keys
  1-5 + click), weapons (unarmed/short_sword/war_hammer), tactic matrix.
- "basic": single "Golpe" attack, fixed damage, short reach (HUD shows one
  button).
How you drive it: give hostile entities a `combat` block —
`{health, weapon_id, personality: {aggression, preferred_attacks[],
reaction_time, combat_range}}`. The HUD (health bars, attack selector)
follows the active system automatically.

── 6. STORY, AMBIENT & SCHEDULING ─────────────────────────────────────────
- `story_update` consequences append to story_so_far; the player browses the
  full session timeline with the History Browser (key H).
- `ambient_message` effects surface as log lines — texture, not plot.
- `schedule_event` plants a future beat the bridge will hand back to you.

── 7. GRAPHICS MODE (world.render_mode) ───────────────────────────────────
- "image": the image model paints your plans (costs credits). The ground +
  volumes of each tile feed a deterministic 3D render, and the image model
  paints the SURFACES of that render cell by cell (the surface atlas). Your
  plans are never redrawn by a vision pass — what you declare is what gets
  built, so declare it complete (typed arrays, never SVG).
- "vector": the player sees the engine's untextured 3D render of your plans
  directly; no image calls.
- The mode is NOT frozen: the player can switch it (per facet: scenes /
  characters) at any time from the client's dev menu. Already-painted images
  are kept when switching to "vector" — only NEW generation stops.

── 8. PLUGINS (gameplay systems) ──────────────────────────────────────────
Active plugins ship their derived views in every turn (`plugins[]`). You
drive them with `{type: "plugin_event", plugin_id, event_type, payload}`
consequences (e.g. commerce: market_open, trade_offered); their effects
surface in the client log. Inspect details with plugin_inspect; register new
systems with plugin_register.

── 9. MAP TRIGGERS ────────────────────────────────────────────────────────
`map_add_trigger` attaches consequences to a place that fire when the player
enters / first visits / leaves it (evaluated by the bridge on movement).
This is your tool for ambushes, arrivals and door-step beats — it needs the
place to be reachable in the world (the place must be anchored to a tile the
player can walk into).
