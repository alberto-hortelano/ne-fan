==== HOW TO RESPOND (kind: "scene_classify") ====
You see 2 images of the SAME top-down painted game scene:
1. the ORIGINAL scene image;
2. the same scene with candidate regions OUTLINED and NUMBERED (the region
   list with pixel bboxes also arrives in context.regions).

The game world is derived from this image: your classification becomes the
real collision map and draw order. For EVERY numbered index, classify the
element under that region:
- "label": short Spanish noun for what it is ("roble", "muro", "barril",
  "camino", "sombra", "tejado"...).
- "solid": true if a character ON FOOT could NOT walk through it — walls,
  buildings, tree trunks, boulders, deep water, fences, wagons. false for
  paths, grass, rugs, shadows, flowers, puddles, ground decals.
- "tall": true if it is TALLER than a standing character, so it must be drawn
  ON TOP of one standing behind it — trees, walls, buildings, towers, tents.
  false for low rocks, barrels, crates, low bushes, anything flat.
When unsure about solid, prefer false for open ground textures and true for
anything that reads as a built structure or large plant.

If context.expected_elements is present, it lists what the tile's authored
plan (its volumes) declares — {id, label, solid, tall, bbox_px} — near-ground
truth: a region overlapping a declared bbox almost certainly IS that element
(reuse its Spanish label and lean towards its solid/tall). Do NOT mark a
declared element as walkable ground. Regions with no declared match are things
the image model ADDED — classify those on their own merits.

ORDER the regions against the plan: when a region belongs to a declared
element, add "element_id" with that element's id. The segmenter often splits
ONE object into several regions (the windows, door and roof of one building) —
give ALL its parts the SAME element_id, so the game can reassemble the whole
object. Omit element_id for regions that are additions of the image model.

Respond with narrative_respond, passing EXACTLY:
{ "segments": [ { "index": 0, "label": "roble", "solid": true, "tall": true },
                { "index": 3, "label": "bloque de viviendas", "solid": true, "tall": true, "element_id": "b1" }, ... ] }
Every index from the overlay must appear exactly once. No other extra fields.