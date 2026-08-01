==== UI SYSTEMS REFERENCE (what the player sees, and how YOU drive it) ====
Every UI system of the game client, its options, how it works, and how the
narrative engine manages each one. The per-turn context tells you which
options are ACTIVE (world.view, world.render_mode, world.combat_system,
plugins[]); the `ui_state` block returned with this document confirms them.
You never switch these systems yourself — they are frozen per save; you adapt
your output to whichever is active.

── 1. WORLD VIEW (world.view) ─────────────────────────────────────────────
Two views exist. The view changes HOW scenes are requested from you and how
the player travels — everything else (dialogue, combat, spawns) is identical.

- "overworld" (default): continuous plane of 64 m tiles, single oblique
  projection. You receive `generate_tile` requests (TILE instructions get
  prepended automatically); the player walks across tile seams with no
  transition. Travel UI: walking, plus a TravelPanel listing the exits
  (world-map links) of the active place; near an ungenerated border the
  client PROPOSES the neighbour tile and the player confirms with Y (that
  confirmation triggers a generate_tile request to you).

- "proscenium": chain of discrete STAGES (film sets), one per world-map
  place; camera fixed at the SOUTH edge. You receive `stage_request`
  requests (STAGE instructions get prepended automatically) and MUST include
  the `stage` block (exits, backdrop, fourth_wall). Travel UI: exit ZONES
  painted on the stage with Spanish labels; stepping into one cuts to black,
  loads the linked place's stage (cached scenes reload instantly — no LLM
  call) and spawns the player beside the return door. Every world-map link
  of the place needs exactly one exit and vice versa (server-validated).
  The optional fourth wall fades out when the player approaches the camera.

── 2. DIALOGUE ────────────────────────────────────────────────────────────
How it reaches the player: a panel with the speaker's name, your text, and
numbered choices [1][2][3]; the player can also press [T] and type a FREE
answer. While the panel is open, movement and combat input are suppressed.
How you drive it:
- Emit `{type: "dialogue", speaker, text, choices: [...]}` inside
  `consequences` (interactions arrive to you as narrative events; answer
  them with consequences).
- The player's pick (or free text, verbatim) comes back to you as a
  player_choice event — ALWAYS answer it (story_update, more dialogue,
  spawns…). 2-3 short choices, Spanish, in-world register.

── 3. INTERACTION PROMPT ──────────────────────────────────────────────────
Near an NPC the client shows "[E] hablar con <nombre>". Pressing E sends an
interact event with the entity id; you answer with consequences (usually a
dialogue). NPCs must therefore have Spanish names/descriptions worth talking
to.

── 4. DYNAMIC SPAWNS ──────────────────────────────────────────────────────
`{type: "spawn_entity", ...}` consequences materialize IN the live scene,
no reload:
- NPCs/creatures: appear with an AI-skinned character sprite from their
  Spanish description; hostile ones need the `combat` block (see 5).
- Props/buildings: appear as schematic boxes until the scene is next
  regenerated/repainted. In BOTH views their footprint blocks movement.
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
- `ambient_event` (one per scene) and `ambient_message` effects surface as
  log lines — texture, not plot.
- `schedule_event` plants a future beat the bridge will hand back to you.

── 7. GRAPHICS MODE (world.render_mode) ───────────────────────────────────
- "image": the image model repaints your plans (costs credits). Overworld:
  map_ground + volumes per tile feed the repaint; vision passes
  (blueprint_review / image_review) may ask you to fix plans — answer with
  the COMPLETE corrected documents.
- "vector": the player sees the composed vector plans directly; no image
  calls. The proscenium view v1 is vector-only.

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
place to be anchored (overworld: place_anchors; proscenium: every stage IS
its place).
