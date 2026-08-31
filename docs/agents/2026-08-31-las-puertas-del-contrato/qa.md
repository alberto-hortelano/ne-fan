# QA — Las puertas que esquivan el contrato (#334 + #195 + #336 + #337)

Validado sobre `tanda/puertas-del-contrato` (5 commits sobre `3f6feab`, árbol limpio),
2026-08-31. Vara de medir: los 9 criterios de `requisitos.md` (con las dos decisiones del
usuario: fallo ruidoso y `migrations.ts` entero fuera). Todo lo afirmado abajo lo ejecuté yo;
nada se da por bueno por estar en `implementacion.md`.

## Criterios

| # | Criterio | Veredicto | Evidencia |
|---|----------|-----------|-----------|
| 1 | El save se valida al cargarse, canal distinguible de «no existe» | ✅ cumple | Sonda con `FsSessionStorage` sobre disco real: save v5 corrompido a mano (entity npc `footprint:[8,8]`) → `loadSession` LANZA: `save "…": la escena "plaza", entity "gigante", campo `footprint` viola el contrato de escena cargable: …lo declarado no puede ser mayor que lo que la colisión honra…`; la sesión anterior queda intacta (`session_id === ""` tras el throw). `loadSession("fantasma")` → `false`. Y por el flujo REAL: guion nuevo `qa/guiones/46-un-save-que-no-vale-no-revive-a-ciegas.mjs` (abajo) |
| 2 | `recordSceneLoaded` valida contra `ExpandedSceneSchema` | ✅ cumple | La misma sonda: `recordSceneLoaded` con la entity `[8,8]` lanza nombrando escena, entity y campo; la escena no se registra. Los 5 escritores de `scene_data` en producción pasan por él (verificado con `git grep scenes_loaded[`: solo `narrative-state.ts:549` escribe; el viaje de vuelta `scene.ts:105` re-valida al pasar otra vez). Adversarial clave: las **20 escenas de snapshot commiteadas** de los 4 juegos base (18 con `style_ref`) pasan el gate — el arranque pre-generado de alta_fantasia/colonia_aster NO muere (el OJO del criterio, respetado) |
| 3 | El banco emite lo que el contrato del rol acepta, candado propio | ✅ cumple | `test/fake-motor-contract.test.ts`: 3/3 verdes contra `EmittedSceneSchema` importado de src. **Probado en negativo por mí**: `style_ref` reinsertado a mano en `bootstrapTile` → `fail 1` con el issue del zod en el mensaje; revertido. `git grep style_ref labs/narrative/` → 0 hits (el fake nunca declaró el de NPC; el de escena murió). Adversarial: los ÚNICOS caminos de escena del fake (`/generate_scene` → `bootstrapTile()` / `makeTile(gt)` con memoización) pasan por los builders candados |
| 4 | `POST /scene/validate` sin 500 por escena mal formada; `normalizeGrid` muerto; reclamo del corpus corregido; un solo grid | ✅ cumple | Sonda por **HTTP de verdad** (`createStateHttpServer` en puerto efímero): los 3 vectores → `[200] ok=false` con defecto y salida nombrados (transcripción abajo). `normalizeGrid` borrado (diff + `git grep` 0). Reclamo de `tileExpandido` corregido (corpus:55). Identidad de grid candada por test (`view.grid === view.scene.terrain`) y por código (una sola referencia). Batería adversarial de 13 vectores vecinos: **cero 500** (abajo) |
| 5 | `__expanded` no cruza el gate de `narrative_respond` (rechazo dirigido, TS y Python) | ✅ cumple | Fixture compartida `invalid/tile_marcado_expandido.json` verde en `contract-fixtures.test.ts` (66 pass) Y en la suite Python (136 tests OK, unittest). Sonda directa: `EmittedSceneSchema` rebota `__expanded` con CUALQUIER valor (`true/false/0/"sí"`, vía `in`) y `validate_scene_response` hace `raise ValueError` también con `False` — paridad del `in`. Censo del passthrough actualizado en la cabecera del schema |
| 6 | 127 filas sin `__expanded` sigue dando `{ok:false}` accionable | ✅ cumple | Caso nuevo del corpus `tile-con-127-filas-sin-marca` (golden) + mi sonda HTTP: `[200] ok=false "un tile no lleva size/terrain completos: la base es \`biome\` + primitivas…"` |
| 7 | `migrations.ts` muere entero; suelo `schema_version !== 5` ruidoso | ✅ cumple | El fichero y `test/fixtures/saves-v3/` no existen; `git grep migrateActiveSceneToTile\|migrateWorldMapFromV1\|saves-v3` fuera de docs → 0. Sonda en disco: v4 y v3 lanzan `save "…" incompatible: schema_version N ≠ 5 — pre-producción, sin migraciones (#336): bórralo o empieza partida nueva`. Cobertura perdida declarada en `implementacion.md` §cobertura (verificada contra los diffs de los tests) |
| 8 | El error de spawn nombra el volumen; «footprint» desaparece | ✅ cumple | Sonda por el flujo real del motor (escena Format D → `POST /scene/validate`): volumen declarado → `…lo cubre la masa del volumen "taberna" del plan — muévelo fuera o mueve el volumen`; derivado de entity → `…volumen "derived_ent_mesa"…`; char sólido con leyenda declarada → `la celda es "R" (roca), terreno sólido — muévelo a una celda pisable`. `grep footprint scene-validate.ts` → solo el comentario histórico. Golden: exactamente los 3 textos `nace-en-solido` cambiados, 33 entradas viejas intactas (diff revisado línea a línea, 3 borrados + 4 entradas nuevas) |
| 9 | `verify` verde; deuda sin crecer; golden a mano; issues desde la PR | ✅ cumple (PR pendiente) | `npm run verify` corrido por mí: exit 0, `tests 1667 · pass 1667 · fail 0` (build+typecheck:scripts+typecheck:labs+lint+test). `npm run coverage && npm run crap -- --check`: ✔ dentro de los umbrales (1133 funciones, 0 sobre el tope; `migrations.ts` CRAP 23 fuera de la cola). Golden: diff verificado puramente aditivo + 3 textos. `gen:contract`: «sin cambios (sincronizado)». Los `Closes #334 #195 #336 #337` van en la PR, que aún no existe (rama sin push) — no verificable aquí |

### Los tres vectores del criterio 4, por HTTP real (transcripción)

```
[200] ok=false __expanded + terrain:[]   → "terrain tiene 0 filas y un tile expandido lleva exactamente 128 — si la
                                            emites tú, quita `__expanded` y declara `biome` + primitivas: el engine sintetiza el grid"
[200] ok=false __expanded sin terrain    → "terrain no es un array (un tile expandido lleva 128 filas de 128 chars) — …"
[200] ok=false __expanded + biome bogus  → "tile.biome \"bogus\" desconocido — usa el catálogo (grass, forest_floor,
                                            meadow, sand, dirt, stone, snow, swamp) o un char reservado (g/a/d/s/o)"
```

Leídos con ojos de motor: nombran el defecto exacto (fila, número, catálogo entero) y la
salida («quita `__expanded` y declara `biome` + primitivas»), en español. Corregibles sin
adivinar.

### Pasada adversarial del criterio 4 (vectores vecinos, todos por HTTP)

Cero 500 en los 13: fila 64 con 127 chars (`terrain[64] tiene 127 chars…`), fila no-string,
`terrain` string, `biome` ausente y `biome` numérico con la marca (el gate cae a `grass`,
igual que `computeTileEdges` — coherentes), `__expanded:false` + grid roto, `entities`
no-array y `entities:[{}]` (veredicto `falta la entity kind "player"`), `terrain_legend`
numérica, `volumes`/`ground` basura (rechazo del zod de primitivas con el path), `tile.tx`
float, sin `tile`, y el control verde. Ningún vector deja al motor sin mensaje.

### Pasada adversarial del criterio 5

Otros campos «internos» que el passthrough aún sostiene: `ambient_event`, `place_anchors`,
`terrain_patches` — los tres CENSADOS a propósito en la cabecera del schema (tráfico legítimo
del motor real; cerrarlos es #335/otro issue, fuera de esta tanda por decisión escrita).
`size`/`terrain` completos sí cruzan el gate emitido, pero el expander los rechaza en
ruidoso aguas abajo («un tile no lleva size/terrain completos») — no hay corrupción muda.
No encontré ninguna otra marca interna que cruce sin censar.

## El flujo real del jugador: guion nuevo

**`qa/guiones/46-un-save-que-no-vale-no-revive-a-ciegas.mjs`** (en el árbol, SIN commitear,
con su fila en la tabla de `qa/README.md` también sin commitear — los commitea quien cierre
la tanda). Corre en la batería estándar (`node qa/run.mjs 46-un-save`): partida real desde el
título → save de DISCO corrompido → resume por el cable Y por el botón «Reanudar».

- Verde en la primera corrida: `save_invalido` nombra save/escena/entity/campo por el cable;
  `session_not_found` queda para el id inexistente; `schema_version:4` → `save_invalido` con
  la versión; «Reanudar» no cuelga ni monta el mundo corrupto; restaurado el fichero, el mismo
  resume carga (el rechazo era del contenido).
- **Probado en negativo**: con el gate de `loadSession` neutralizado a mano (2 líneas), el
  resume del save corrupto salió `ok:true` y el guion se puso rojo en las líneas exactas;
  revertido (`git checkout`, 0 cambios en src).

## Hallazgos

### Importante

1. **El jugador que reanuda un save inválido lee un consejo que no puede funcionar nunca.**
   Captura `46-…-01-titulo-tras-reanudar-save-corrupto.png`: el título muestra «No se pudo
   reanudar la partida. **El servidor del juego no pudo completarlo; inténtalo de nuevo.**»
   Reintentar fallará SIEMPRE (el save es inválido en disco), el motivo real («bórralo o
   empieza partida nueva», que el bridge SÍ manda en el error) no llega, y el botón «Borrar»
   —la única salida— está delante sin que nada apunte a él. Es exactamente el patrón que el
   guion 27 nació rojo por denunciar («un fichero que falta disfrazado de servidor con hipo»):
   `motivoDeSesionParaElJugador` (`nefan-core/src/protocol/status-labels.ts:240`) no tiene
   rama para `save_invalido`. Reproducir: guion 46, línea `lo que lee el jugador`. La
   implementación lo declara fuera de alcance («el camino de save_invalido en el CLIENTE») y
   `requisitos.md` efectivamente no lo pide — por eso no es bloqueante — pero el usuario de la
   decisión «fallo ruidoso» es el jugador, y hoy el ruido se queda en el log. Sugerencia:
   una rama en `motivoDeSesionParaElJugador` (mismo molde que `session_not_found`).

### Menor

2. **El consejo del volumen derivado habla de mover un volumen que el motor no declaró.**
   `…lo cubre la masa del volumen "derived_ent_mesa" del plan — muévelo fuera o mueve el
   volumen`: el id es veraz (es el volumen real del plan compuesto, y el prefijo
   `derived_ent_` contiene el id de la entity), pero el motor declaró una *entity* `mesa`,
   no un volumen — «mueve el volumen» le pide tocar algo que no está en su escena. Desviación
   3 del ingeniero, aceptable (id real, determinista); el texto podría decir «o mueve la
   entity que lo deriva» cuando el prefijo es `derived_ent_`.
3. **El char de agua rasterizado del plan sale sin nombre de leyenda.** Escena real con
   `ground` de agua → el agua se rasteriza al grid y el error dice `la celda es "w", terreno
   sólido` sin `(río)`: la leyenda por defecto no nombra `w`, así que la mitad «con su entrada
   de leyenda» del criterio 8 solo aplica cuando la escena la declara (verificado que con
   leyenda declarada sí sale: `"R" (roca)`). El motor puede mapear `w` igualmente; pulir sería
   dar nombre a los chars reservados en la leyenda por defecto.
4. **`terrain: []` sin `__expanded` se ignora en silencio** (el expander trata el array vacío
   como ausente y sintetiza el grid; con contenido sí rechaza). Un array vacío no lleva
   información, así que no hay pérdida muda real — se anota por completitud de la pasada.

## Desviaciones declaradas del ingeniero — verificadas una a una

1. **Save v5 (no v4) en el test de entity inválida**: legítima y además obligada — comprobado
   en mi sonda que un v4 rebota por VERSIÓN antes de tocar el gate de contrato; el v4 válido
   cubre el canal de versión en su propio test. La intención del criterio (no depender de
   `saves-v3`) se cumple: ambos saves se construyen en el test.
2. **`legacyVectorSave` sube a v5 en vez de reescribirse a `save_invalido`**: legítima —
   verificado en el diff que su sujeto es `character_mode` ausente (rama de disco de
   `set_render_mode`) y que el caso «resume de save viejo → `save_invalido`» se AÑADIÓ como
   test nuevo en `bridge-session.test.ts` (`schema_version:3` → `/^save_invalido: /` +
   `/schema_version 3/`), sin sustituir a nadie.
3. **`derived_ent_mesa` sin traducir**: legítima (id real del plan que pinta el cliente,
   prefijo determinista); deja el hallazgo menor 2.
4. **unittest en vez de pytest**: verificado — `python -m pytest` no existe en el venv y el
   CI usa unittest; corrí la suite entera: `Ran 136 tests — OK`.
5. **El test del fake en la batería de mutación `contrato-escena`**: verificado en el diff de
   `mutation-targets.json` (entrada en `tests` con su porqué ampliado); coherente con el
   candado de baterías que lo exige.

## Workarounds usados durante la prueba (regla del workaround)

- **Ninguno en el camino del usuario**: las sondas de save corrompen el `state.json` en disco
  a mano, pero ESO ES el escenario que se valida (un save de una era anterior del contrato);
  el resume posterior va por el cable y el botón reales. El guion 46 corrompe DESPUÉS de
  volver al título (bridge quieto) y asserta que el fichero corrupto sigue intacto tras el
  intento — sin esa guarda, un `save()` del bridge intercalado habría hecho medir otra cosa.
- Las sondas HTTP montan `createStateHttpServer` en puerto efímero en vez del stack entero:
  es el MISMO servidor y el mismo router que levanta el bridge (el que usan los tests de
  contrato); la ruta `POST /scene/validate` ejercida es la de producción. El extremo
  MCP (`narrative-mcp` `scene_validate` → `bridgePost`) no se levantó — cubierto por
  transitividad (misma URL, mismo body), declarado en «No probado».
- El negativo del guion 46 editó `narrative-state.ts` en local para neutralizar el gate;
  revertido con `git checkout` y verificado árbol limpio (`git status` 0 cambios en src).

## No probado

- **La tool MCP `scene_validate` extremo a extremo** (terminal de Claude Code → narrative-mcp
  → bridge): exigiría un motor real en `:3737`; el tramo narrativo-mcp → bridge es un
  `bridgePost` a la misma ruta que sondeé por HTTP. Riesgo residual bajo.
- **`Closes #…` y CI de la PR**: la rama no está pusheada; el hook `Stop` del repo lo
  vigilará cuando exista la PR.
- **La mutación de `contrato-escena`**: pedida y pendiente de autorización del usuario
  (verificado con `npm run mutacion -- pendiente`: la tanda fuerza la corrida completa —
  `migrations.ts` borrado, golden y `tsconfig.labs`/`mutation-targets` figuran como
  forzadores). No bloquea por diseño del proceso.
- **Un save v5 con `scenes_loaded` no-objeto** (corrupción externa arbitraria): lanza un
  TypeError feo en vez del mensaje bonito, pero CAE en el catch del resume → `save_invalido`
  igual. No probado más allá de la lectura del código; el canal no se pierde.

## Crítica visual

La tanda no toca render y las capturas lo confirman: revisadas las corridas
`qa/capturas/2026-08-31T10-53-59-159Z-60814` (del ingeniero) y las mías
(`…T11-09-59…` guion 46 suelto, `…T11-12-04…` batería completa). `17-…-03-partida-reanudada` pinta el pueblo
del bench correcto (taberna, camino, HUD, panel Salidas); `32-…-02` muestra los checkers del
fake-surface-model y el aviso conocido del sheet `walk` del bench (gotcha documentado del
guion 15, previo a la tanda). La captura nueva del guion 46 muestra el título con el error
en rojo, legible y sin solaparse — el contenido del texto es el hallazgo 1, no su pintado.

## Corridas completas

- `npm run verify` → exit 0, 1667/1667 (corrido por mí sobre la rama).
- `node qa/run.mjs` (batería entera, 45 guiones con el nuevo, bloque de puertos propio, cero
  créditos) → **45 en verde · 0 en rojo · exit 0**, capturas en
  `qa/capturas/2026-08-31T11-12-04-569Z-77580`.
- `npm run coverage && npm run crap -- --check` → ✔ dentro de los umbrales.
- Suite Python: `Ran 136 tests — OK`.

## Veredicto

**Apto.** Los 9 criterios se cumplen y aguantaron la pasada adversarial (13 vectores vecinos
sin un 500, passthrough sin marcas sin censar, snapshots reales contra el gate nuevo, candado
del fake y del guion probados en negativo). Los 4 hallazgos no bloquean: el 1 (la traducción
de `save_invalido` al jugador) está fuera del alcance escrito de la tanda pero es la mitad
visible de la decisión «fallo ruidoso» — recomiendo hacerlo en la corrección de hallazgos o
abrir issue antes de mergear, para que no se pudra.
