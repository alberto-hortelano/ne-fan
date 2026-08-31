# VIGENTE (#334, #195, #337) · REENCUADRADA (#336 y los criterios 2, 3 y 5)

La tanda debe hacerse y la agrupación es correcta; tres criterios describen la solución con
un ejemplo o un menú que contradice decisiones ya escritas en el propio código.

## El problema real, en una frase

Cuatro entradas de escena cruzan sin contrato (save al cargar, escritura del bridge, tool
`scene_validate`, passthrough de `narrative_respond`) y lo inválido acaba en 500 mudo o estado
corrupto en vez del error que el modelo puede corregir.

## La premisa, verificada a HEAD (`3f6feab`) — todo comprobado por mí, no citado

1. **Bridge sin zod** — CIERTO: `git grep` → 1 hit y es comentario (`bridge/context.ts:342`).
2. **`loadSession` asigna a pelo** — CIERTO: `narrative-state.ts:373-398`, solo mira
   `schema_version`. La propia migración lo declara medido (`migrations.ts:59-66`).
3. **El banco emite `style_ref` de escena** — CIERTO: `fake-ai-server.ts:339,470`; el rechazo
   vive en `scene-schema.ts:281-289`.
4. **«Si se valida la carga, el banco empieza a fallar»** — **FALSO con el schema coherente.**
   `recordSceneLoaded` recibe SOLO población expandida (sus 5 callers expanden antes:
   `bootstrap-tile.ts:86-87`, `tile.ts:156`, `scene.ts:105`, `session.ts:457,460`), y el gate
   de esa población es `ExpandedSceneSchema`, que **tolera `style_ref` por decisión escrita**
   (`scene-schema.ts:305-308`, #237): 18 de 20 escenas de snapshot commiteadas lo llevan
   (medido: alta_fantasia 9/9, colonia_aster 9/9) y rechazarlo **apaga el arranque** de esos
   dos juegos. El ejemplo del criterio 2 nombra justo el campo que el gate de lectura decidió
   tolerar; el candado de la instancia B no puede ser «la validación del bridge».
5. **Los tres vectores del 500** — EJECUTADOS por mí contra `validateScene`:
   `__expanded+terrain:[]` → throw `computeTileEdges` (`tile-edges.ts:69`); `__expanded` sin
   `terrain` → TypeError (`normalizeGrid`, `scene-validate.ts:271`); `biome:"bogus"` → throw
   **solo con `__expanded`** (sin él ya sale `{ok:false}` accionable de `prepareTileBase` —
   el test del criterio 4.3 debe incluir la marca). 127 filas sin `__expanded` → `{ok:false}`
   (criterio 6 correcto). Ruta sin try/catch (`scene-routes.ts:44-50`, con el hueco anotado
   para #195) y 500 fabricado en `state-http-server.ts:101-103`: confirmados.
6. **Passthrough** — CIERTO (`scene-schema.ts:243`), pero su cabecera (`:20-29`) ya CENSA lo
   que sostiene: `ambient_event` (fixtures), `place_anchors` (los emite el MOTOR REAL en el
   bootstrap y el fake también; `recordSceneLoaded:517` lo consume) y `terrain_patches` (espejo
   Python — el sujeto de #335). Cerrarlo «estricto» arrastra ese censo y a #335 a la tanda.
7. **`migrations.ts`** — son **158 líneas y DOS migraciones**: v3→v4 (~120) y `migrateWorldMapFromV1`
   (v1→v2, solo usada en `loadSession:403`), más el shim v2→v3 (`plugins ?? []`, `:406`). El
   issue borra media doctrina y deja el museo viejo en pie.
8. **#337** — CIERTO todo: causa «footprint» muerta (`composePlan`, comentario `:379-384`),
   anillo cutaway sin char (`collision.ts:131-152`), mensaje en `:492-494`. Pero nombrar el
   **id del volumen** no es reescribir un string: la máscara compuesta no guarda procedencia
   celda→volumen — hay que atribuirla (las funciones de marcado por-volumen existen; acotado,
   pero es lógica nueva, no un mensaje).

## El día después

- Cada endurecimiento futuro de `EntitySchema` matará saves existentes al cargar, en ruidoso.
  Es la doctrina decidida — pero escribidlo en el requisito, que nadie lo redescubra.
- `loadSession` devuelve `boolean`: implementar el fallo como `return false` colapsa «no
  existe» con «no valida» y produce EXACTAMENTE el descarte silencioso que la pregunta
  abierta 1 teme. La convención del repo (`Result<T,E>` cuando vacío y error se confunden)
  ya lo prohíbe: que el criterio 1 exija canal distinguible.
- Lo que nadie borrará si no está en un criterio: `normalizeGrid`, el reclamo falso de
  `tileExpandido` (`scene-validate-corpus.ts:52`) y el doble grid (`view.grid` vs
  `view.scene.terrain` en `computeTileEdges`) — los tres vienen del reencuadre del 23-08 y
  ninguno figura en los criterios. Añadirlos al 4 o quedarán como documentación falsa.
- El test del criterio 1 no puede apoyarse en `saves-v3/v3_aldea`: el criterio 7 la borra.
  Save v4 construido en el test.

## Conflictos

- **Ninguna PR abierta** ni trabajo en vuelo sobre estos ficheros.
- **#335**: sin conflicto SI el criterio 5 se queda en rechazo dirigido; el «schema estricto»
  sí lo arrastraría (decide `terrain_patches`). A favor: borrar la migración (#336) elimina un
  escritor de `terrain_patches` (`migrations.ts:98`) — esta tanda ANTES de #335 la adelgaza.
- **#332/#331** (tanda 2): superficie distinta (`qa/`). Toca de refilón: el corolario de #334
  («el verde de la batería no ejerce el zod») invalida la opción «candado = batería» del
  criterio 3 — el candado que funciona es un test del fake contra `EmittedSceneSchema`, el
  contrato del rol que suplanta.
- **Decisiones vivas**: la crítica del 23-08 está incorporada (bien); doctrina pre-producción
  y fail-loud al modelo, alineadas. El menú del criterio 5 es lo único que choca (abajo).
- La agrupación NO esconde dos tandas: #336 y #334-A tocan las mismas líneas de `loadSession`
  (la llamada a migrar vive en `:415-417`, dentro del tramo que el criterio 1 reescribe), y
  #195/#337 comparten `scene-validate` y UNA revisión manual del golden en vez de dos.

## Coste contra valor

Vale. Cierra la clase entera de puertas sin contrato, borra CRAP 23 y convierte tres crashes
en errores que el motor corrige solo. No hacerlo es sostenible pero deja el bug invisible que
ya mordió una vez (#300) y un 500 por turno de motor cuando toque. #337 entra si el arquitecto
acepta su coste real (atribución celda→volumen); si engorda, fuera sin dolor.

## Qué cambiar en `requisitos.md` (pegable)

> **Criterio 2**: el ejemplo `style_ref` es inválido — `recordSceneLoaded` solo ve población
> expandida y `ExpandedSceneSchema` tolera `style_ref` por decisión escrita (#237; 18/20
> snapshots commiteados lo llevan — rechazarlo apaga el arranque de alta_fantasia y
> colonia_aster). Ejemplo correcto: `footprint:[8,8]` en npc, que ambos schemas rechazan.
> **Criterio 3**: el candado NO puede ser «la validación del bridge ejercida por la batería»
> (esa validación tolera `style_ref`): es un test del fake contra `EmittedSceneSchema`.
> **Criterio 4**: el vector `biome` inválido requiere `__expanded:true` (sin él ya da
> `{ok:false}`); y añadir: `normalizeGrid` borrado, reclamo de `tileExpandido` corregido,
> `computeTileEdges` leyendo el mismo grid que las demás pasadas.
> **Criterio 5**: del menú, `strip` está proscrito (los schemas son predicados que no
> reescriben — candado en `scene-schema.test.ts` — y tirar en silencio lo que el modelo emitió
> es saneo mudo) y «schema estricto» arrastra el censo del passthrough (`place_anchors` del
> motor real, `ambient_event`, `terrain_patches`/#335): queda el rechazo dirigido de
> `__expanded` en el `superRefine`, mismo patrón que `style_ref`.
> **Criterio 7**: borrar TAMBIÉN `migrateWorldMapFromV1` y el shim v2→v3 — misma doctrina,
> mismo fichero; suelo en `schema_version < SCHEMA_VERSION` → fallo ruidoso. El fichero entero
> muere (158 líneas), no media migración. El test del criterio 1 usa un save v4 propio.
> **Criterio 1**: el fallo de carga debe ser distinguible de «no existe» (no un `return false`
> del `loadSession` actual): canal `Result` o throw, que nombre entity y campo.
