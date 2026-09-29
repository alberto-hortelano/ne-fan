==== HOW TO RESPOND (kind: "player_death") ====
The player has died. You decide WHERE they wake up, and what happens when they
do. Call narrative_respond with an object matching the `DeathResolution` type
in the SCHEMA block below.

What the context carries, in `context.muerte` (everything in METRES of world
space, the same frame as the scene positions):
- `cayo_en {x, z}` — where the body fell. `tile` and `place_id` — the tile and
  the map place the player was in (null if none).
- `asesino {id, name}` — who dealt the last blow, or null if unknown.
- `hostiles_vivos[]` — every living hostile: `pos` (where it is now), `casa`
  (where it stands again when the player wakes: every enemy lets go and goes
  back home when the player dies), and `radio_m` (how close the player can be
  before it engages).
- `lugares[]` — map places the player can wake in: `{place_id, name, centro,
  distancia_m}`. Only places whose tile already exists are listed.
- `punto_seguro {x, z}` — the last spot where the player was alive and nobody
  was engaged. A SUGGESTION, not a rule: it may be inside a hostile's radius if
  the hostile appeared later.
- `margen_m` — the extra distance the game demands beyond each `radio_m`.

What the game checks before accepting your answer (if it fails you get the
reason and the request stays pending — fix it and respond again):
- `wake.type: "place"` must name one of `lugares`; the player appears at the
  free spot nearest to that place.
- `wake.type: "point"` must fall inside a tile that already exists, and the
  game moves it to the nearest free spot if it is inside something solid.
- The final spot must be farther than `radio_m + margen_m` from the `casa` of
  EVERY living hostile.
- `consequences` are the same entries as a narrative_event reaction (dialogue,
  story_update, player_healed, spawn_entity…), except that a `spawn_entity`
  with `role: "hostile"` is rejected here.

<!-- SCHEMA:AUTO — generado por `npm run gen:contract` desde src/contract/model-io/schemas.ts; NO editar a mano -->
```ts
DeathResolution = {
  wake: 
    | {
      type: "place";
      place_id: string /* no vacío */;  // Id de un lugar de context.muerte.lugares: despierta en su sitio libre más cercano
    }
    | {
      type: "point";
      x: number;  // Metros de mundo, eje X
      z: number;  // Metros de mundo, eje Z
    };  // Dónde despierta el jugador
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
      entity_kind: "npc"|"building"|"object"|"item";  // Qué clase de cosa es, y con ello si el jugador la RODEA o la PISA: `building` y `object` son sólidos (una forja, un carro, un yunque); `item` NO frena — se le pasa por encima, que es lo que hace de algo un objeto suelto (una bolsa de monedas, una llave caída, una carta en el suelo); `npc` es un personaje. El tamaño lo afina `footprint`, no esto
      footprint?: [number /* entero, ≥1 */, number /* entero, ≥1 */];  // Cuánto ocupa en el suelo: [ancho, fondo] en CELDAS de 0,5 m, enteros ≥ 1. Solo afina el tamaño; lo que decide si frena es `entity_kind`. Ausente ⇒ el de su clase (object 3×3 = 1,5 m, building 8×8 = 4 m, item 1×1 = 0,5 m). Un carro es [6,6] y una moneda [1,1]. Un `npc` no lo declara
      name: string /* no vacío */;  // Etiqueta: lo que el jugador lee al mirarla (el rótulo). Nombre propio si lo tiene
      description?: string /* no vacío */;  // Procedencia: el texto exacto (en español) del que se genera su arte — aspecto, no biografía; en un NPC, el prompt del skin. Sin ella se pinta con `name`
      position_hint?: string;  // Pista de dónde aparece, p.ej. 'junto a la fuente'
      role?: "peasant"|"guard"|"villager"|"merchant"|"hostile";  // NPCs: preset de conducta. Los cuatro ambientales (peasant/guard/villager/merchant) deambulan; `hostile` ATACA al jugador y el motor del juego deriva su vida, arma y agresividad — no las declaras tú. No es el oficio: un bandido o un lobo son `hostile` y su identidad va en `name`/`description`. Ausente ⇒ villager
      style_ref?: string;  // NPCs: id de la referencia de personaje de world.style_refs.characters que mejor case con su aspecto (guía el skin IA). Ausente/desconocido cae al default por rol
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
      type: "player_healed";
      amount: number /* entero, ≥1 */;  // Puntos de vida que recupera el jugador (entero ≥ 1). El juego los topa en su máximo; a un jugador muerto no le hace nada. Su vida actual está en context.player.health
    }
    | {
      type: "noop";
    }> /* ≤4 items */;  // Qué pasa al despertar (máx 4). [] si nada
}
```
<!-- /SCHEMA:AUTO -->
