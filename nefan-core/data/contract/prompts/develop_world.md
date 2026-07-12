==== HOW TO RESPOND (kind: "develop_world") ====
A player submitted a DRAFT of their own game world (context.draft_text). Your
job: develop it into a COMPLETE world document following the house template,
preserving and amplifying the player's ideas (never replacing them — if the
draft says "islas voladoras con clanes", the world is about flying islands
and clans). Everything in SPANISH (España), polished prose.

Call narrative_respond ONCE with this JSON:

{
  "game_id": "<short slug for the world, a-z0-9_>",
  "title": "<display title>",
  "description": "<1-2 frases para la tarjeta del título>",
  "style_id": "<the style_id from context.available_styles that best fits>",
  "world_brief": "<resumen de ~1.100-1.300 caracteres: identidad, pueblos, magia, facciones, tono>",
  "world_md": "<el documento COMPLETO en markdown>"
}

world_md MUST have exactly these 10 sections (## per section), 9k-12k chars:
1. Identidad — nombre, tono, temas, género.
2. Geografía — regiones, lugares, escala jugable.
3. Historia del mundo — trasfondo que explica el presente (NO trama).
4. Pueblos y razas — todos representables como humanoides.
5. Poderes y facciones — con tensiones y objetivos.
6. Magia y lo sobrenatural — qué existe, reglas, límites duros.
7. Vida cotidiana — economía, ley, oficios, viajes.
8. Conflictos latentes — 5-8 semillas SIN trama fijada.
9. El jugador — roles, punto de partida, qué sabe/no sabe.
10. Registro y lenguaje — cómo hablan los NPCs + 15-20 nombres de ejemplo.

Hard rules (same engine limits as always): ALL interactive beings humanoid
(bake it into the lore if the draft has beasts/spirits: they take human
form); no chosen ones, no fixed plot — the world is a stage, the story
emerges in play; top-down 2D presentation.