# QA-D · PR #458 / issue #407 — «`W` sale del engine: el único sólido del grid es el agua `w`»

**VEREDICTO: APTO CON HALLAZGOS** (ninguno bloqueante; cuatro rastros de prosa que la regla de la casa
—«ningún rastro»— manda barrer antes de mergear, y un silencio pre-existente que el issue deja al
descubierto y que se declara con su severidad).

Worktree `/home/al/code/ne-fan-t13-qa-d`, HEAD `39d0880` (rama `t13/w-sale-del-engine`), base `main` =
`3a0f8ef`. `NEFAN_PORT_OFFSET=800`, `--parar` al terminar (bloque libre al cierre). Cero créditos:
presets `e2e-sin-creditos` (motor falso, `fake:true` declarado por cliente y bridge) y `html-fixtures`.
No se tocó nada fuera del worktree; en el worktree solo se añadieron el guion nuevo, su fila en
`qa/README.md` y este documento. Las dos ediciones de la fuente para probar en negativo se revirtieron
con `git checkout` y el árbol quedó limpio (`git status` al final: solo los tres ficheros de QA).

## Criterio de cierre literal del issue

> O `W` tiene productor (…) o sale de `DEFAULT_SOLID_CHARS`, de los dos comentarios y de los 52 literales
> (que pasan a un char sólido que SÍ produzca alguien), con término en `campos-retirados-no-vuelven`.

| Criterio | Veredicto | Evidencia |
|---|---|---|
| `W` fuera de `DEFAULT_SOLID_CHARS` | ✅ | `scene-normalize.ts:165` → `["w"]`; `formatDToWorld` emite `solid_chars: ["w"]` (guiones 05/06 y guion nuevo lo leen del wire y del cliente) |
| Fuera de los comentarios de producción | ⚠️ parcial | Los 5 que censó el plan + 3 más, sí. Quedan **4 rastros** que siguen hablando de «muro» como char/sólido del grid (hallazgos 1-4) |
| Los literales pasan a un char que SÍ produce alguien | ✅ | Remedido con la regex del informe sobre `main` (`git show 3a0f8ef:…`) y la rama: **47 líneas / 60 ocurrencias → 0** salvo los 3 `W` deliberados de los tests en negativo (tabla abajo). `w` lo produce `GROUND_WATER_CHAR` (`ground-collision.ts:25`); `S` lo produce `IMAGE_SOLID_CHAR` (`image-collision.ts:12`, `planCollisionGrid`) |
| Ningún test modela algo imposible | ✅ con matiz | Ningún test distinguía agua de muro (revisado el diff completo de los 5). El puente `b` sigue transitable (`terrain-collision.test.ts:121-128`). Matiz menor en el hallazgo 6 |
| Término en `campos-retirados-no-vuelven` | ❌ no hecho, **desviación declarada** | Plan §1 e informe: `W` no es token candable con `\b` (tecla WASD: `paso-del-jugador.ts:38`, guion 37, `puerta-de-teclado.ts:22`). Sustituto: el test en negativo (4 rojos). Lo doy por razonado, no por cumplido en su letra (hallazgo 7) |
| Candado en negativo | ✅ | Repuesto `["W","w"]` en la fuente: `npm test` → **fail 4** (`terrain_grid carries…`, `el agua es el ÚNICO sólido…`, `abre un tile ya expandido…`, `integrates with formatDToWorld…`); revertido → 2092/2092. El test nuevo pone `W` y `w` en la **misma** celda (10,10) de un tile REAL (`expandScenePrimitives`): `W` → collider `null`, `w` → `isSolidCell` y `blocksCircle` |
| Jugabilidad con bridge (`e2e-sin-creditos`) | ✅ | `node qa/run.mjs 01-arranque 05-terreno 06-el-rio` → **3 en verde · 0 en rojo**; el jugador cruza el río por el puente (x 8.3→15.3) y rebota contra el agua (x 8.3→9.5) |
| Jugabilidad sin bridge (`html-fixtures`) | ✅ | Guion nuevo `qa/las-fixtures-solo-chocan-con-el-agua.mjs`: las 3 fixtures pintan (frames crecen), `solid_chars === ["w"]`, 0 celdas `W`, el agua bloquea (robledo `[85,1]`, puerto `[1,63]`), los edificios del plan bloquean (`casa_concejo`, `lonja`, `casa` de zorder_test vía `__plan.volumes`), el arranque no |
| `scene-validate` sigue tratando `w` como sólido | ✅ | `scene-validate.ts:362` `solid: new Set(DEFAULT_SOLID_CHARS)`; test `openTile` espera `["w"]` |
| `npm run verify` | ✅ | exit 0 · `tests 2092 · pass 2092 · fail 0` |
| `npm run deuda` | ✅ | **83 items** (15 fronteras + 11 CRAP + 57 supervivientes) = 83 |
| `npm run coverage && npm run crap -- --check` | ✅ | «✔ dentro de los umbrales» · CRAP ≤ 73: 0 por encima · cobertura 89,2 % ≥ 89 % |
| Cero créditos | ✅ | guardarraíl del runner: `fake:true` en cliente y bridge; `html-fixtures` sin backend |

### Remedida de los literales (regex `"[gowWbsSP_.~]*W[gowWbsSP_.~]*"`)

| Test | `main` líneas/occ | rama líneas/occ | Qué queda |
|---|---|---|---|
| scene-validate-pasadas | 29 / 39 | 0 / 0 | — |
| terrain-collision | 15 / 17 | 2 / 2 | el `gridDe(["WgwP",…])` del test «la W ya no es muro» (deliberado) |
| plan-collision | 1 / 2 | 0 / 0 | — |
| scene-normalize | 1 / 1 | 1 / 1 | `conCelda("W")` del candado nuevo (deliberado) |
| sim-collision | 1 / 1 | 0 / 0 | — |
| scene-expand | 0 / 0 | 0 / 0 | ya estaba a 0 (la crítica tenía razón) |
| **total** | **47 / 60** | 3 / 3 | los 3 son los negativos |

Coincide con el informe del ingeniero (47/60). Ningún otro `test/*.test.ts` de `main` tenía literales.

## Hallazgos

Ninguno bloquea la jugabilidad; los cuatro primeros son la regla «los rastros confunden a los agentes»
(la misma que motiva el issue) aplicada al propio diff.

1. **Importante (prosa, mismo fichero de la PR)** — `nefan-core/src/scene/scene-normalize.ts:341`:
   `// Chars que bloquean movimiento (muro y agua). Los consume createTerrainCollider…`, a 180 líneas
   del comentario nuevo que dice lo contrario. Repro: `grep -n "muro y agua" nefan-core/src/scene/scene-normalize.ts`.
   Esperaba: «(el agua)». Es exactamente el comentario que un agente lee al lado de `solid_chars`.
2. **Importante (texto de producción que ve el motor)** — `nefan-core/src/contract/model-io/retired-terrain-fields.ts:28`,
   `MOTIVO_DEL_TERRENO = "… la solidez la fija el engine (agua y muro bloquean)"`. Es el mensaje que el zod
   devuelve al motor cuando rebota `terrain_legend`/`terrain_patches`: le sigue diciendo que hay un muro en el
   grid. Repro: `grep -n "agua y muro" nefan-core/src/contract/model-io/retired-terrain-fields.ts`.
3. **Menor** — `qa/guiones/06-el-rio-solo-se-cruza-por-el-puente.mjs:4`: la cabecera del guion que la PR
   reescribió sigue diciendo «`DEFAULT_SOLID_CHARS`: muro y agua» mientras su aserto de la línea 122 afirma
   que solo es el agua. Un guion que se contradice a sí mismo.
4. **Menor** — `qa/guiones/62-un-save-con-terreno-por-chars-no-carga.mjs:6`: «la solidez la fija
   `DEFAULT_SOLID_CHARS` (agua y muro)».
   (`labs/narrative/stage-cutouts-e2e.md:47` «muros W del terrain» lo declaró el ingeniero como documento
   histórico del plató retirado; no lo cuento: es material de sesión y requiere confirmación del usuario.)
5. **Menor, pre-existente y ahora visible — un grid con `W` (o cualquier char fuera del alfabeto) es SUELO
   en silencio.** Medido con tsx sobre el core de la rama, un tile expandido real con una columna entera de
   `W` (128 celdas) partiéndolo en dos:
   - `ExpandedSceneSchema.safeParse` → **ACEPTA** (no hay alfabeto en el zod: `terrain: z.array(z.string())`).
   - `validateScene` → **`ok: true`, 0 errores, 0 avisos, `reachable 16384 = walkable 16384`**: la pared es
     pisable. Con la `W` repuesta (comportamiento pre-PR): `reachable 12800 / walkable 16256`, la pared partía
     el tile.
   - `formatDToWorld` → `solid_chars: ["w"]`; `createTerrainCollider` → `null`.
   - El cliente no pinta desde los chars (el grid solo alimenta `createTerrainCollider`; el suelo sale de
     `__plan`), así que la celda ni se ve ni bloquea.
   El motor NO puede colar un grid (`sceneBaseShape` rechaza `terrain` en un tile: «un tile no lleva grid
   `terrain` completo»); solo llega por un save/snapshot ya expandido, y ningún productor escribió `W` jamás,
   así que hoy no hay dato real afectado. Pero `openTile` ya rechaza fail-loud filas cortas y biomas fuera de
   catálogo, y un char fuera del alfabeto del engine es el mismo tipo de defecto. Severidad honesta: menor;
   no es de esta PR (antes `X` se comportaba igual), pero esta PR convierte la `W` en ese caso. Cabe un issue.
6. **Menor (modelado de test)** — `scene-validate-pasadas.test.ts:805-813`: el `describe` sigue siendo
   «floodFill con cuerpo · la puerta de 1 m» y el comentario «`hueco` es exactamente lo que mide la puerta»,
   pero el mecanismo es ahora un canal `www` con un vado de 2-3 celdas. Las puertas del juego son `gates` de
   volúmenes del plan (`PlanMask`), no huecos en el agua, y el diseño dice que «si algún día hace falta un
   vado, irá como propiedad del rasgo `water`». El test mide la mecánica del flood con cuerpo y sigue
   valiendo; solo el rótulo describe algo que el juego no produce. El resto de rótulos («canal», «orillas»,
   «río») sí se reescribieron.
7. **Observación** — el criterio literal pide «término en `campos-retirados-no-vuelven`» y no se añadió. La
   razón está escrita (plan §1, PR) y la comprobé: `W` aparece como tecla en producción, tests y guiones, y la
   regla parsea nombres con `\b`. El sustituto (test en negativo con 4 rojos) es más fuerte que un término que
   no podría existir. Lo dejo escrito para que el cierre del issue lo diga.

## Lo verificado, con comando y salida

- **Grep de rastros** (`W` como char de grid en `nefan-core/src`, `bridge`, `nefan-html/src`, `labs/`, `qa/`,
  `CLAUDE.md`, `docs/arquitectura/`; excluidos WASD, `E/W` de espejo, `KeyW`): 0 `"W"` literales; prosa
  «muro» junto a grid/solid/char → los 4 hallazgos de arriba + `stage-cutouts-e2e.md:47`. `docs/arquitectura/`
  limpio. `CLAUDE.md:210` ya dice `["w"]`.
- **Negativo del candado**: `sed` a `["W", "w"]` → `npm test`: `tests 2092 · pass 2088 · fail 4` (los cuatro
  nombrados en la tabla). `git checkout -- src/scene/scene-normalize.ts`; `grep` confirma `["w"]`.
- **Banco con bridge** (`NEFAN_PORT_OFFSET=800 node qa/run.mjs 01-arranque 05-terreno 06-el-rio`):
  `3 en verde · 0 en rojo de 3`, capturas en `qa/capturas/2026-09-05T15-28-08-128Z-242111/`. 05 generó un tile
  EN VIVO con el motor falso (`source: "engine"`) y su grid trae `{"g":15840,"_":544}`: sin `W`, como debe.
- **Banco sin bridge**: `NEFAN_PORT_OFFSET=800 node qa/las-fixtures-solo-chocan-con-el-agua.mjs` → verde en las
  tres (salida íntegra en el guion; capturas `qa/capturas/solo-agua-{robledo_tile,puerto_tile,zorder_test}.png`).
  **Probado en negativo dos veces** contra el stack en marcha (vite sirve el core desde `src`): con
  `["W","w"]` → 3 rojos («`solid_chars` es EXACTAMENTE ["w"]» en cada fixture); con `[]` → los mismos 3 rojos,
  y NO el aserto «el agua bloquea», porque en el cliente el agua bloquea por dos fuentes en unión (grid y
  `planCollisionGrid` del `ground`). Está escrito en la cabecera del guion: ese aserto mide que el agua bloquea,
  no que lo haga POR el grid; eso lo mide el test de core sobre el grid a secas.
- **Tests de arquitectura e higiene con el guion nuevo en `qa/`**: `npx tsx --test test/architecture.test.ts
  test/repo-hygiene.test.ts` → 84/84.
- **Capturas (ojo de jugador)**: 05-02 «contra el agua» y 06-01 «cruzado por el puente» muestran lo que dicen
  (orilla del estanque con el HUD encima; el camino de tierra y la casa al cruzar). En la 06-01 aparece un
  toast de error del cliente: «el bridge mueve al NPC "barkeep" y el cliente no lo tiene en escena: anda
  invisible» — es el sim del bridge moviendo NPCs de la partida anterior mientras el guion carga una fixture;
  no lo causa esta PR (misma secuencia en `main`), pero es ruido que un jugador no debería ver en un guion
  «sin motor». Las mías (`solo-agua-*`) son el clay sin bridge: edificios, NPC de clay «Muriel», panel
  «Errores (4)» esperado sin bridge. Nada tapa nada tras corregir la espera del muro (ver workarounds).

## Workarounds usados

- **Ninguno sobre el juego.** El único apaño fue MÍO: la primera versión de mi guion cerraba el muro del
  socket (~0 ms) y el del bootstrap (~5 s) se quedaba encima de las capturas. Lo corregí esperando al titular
  «No se pudo arrancar la partida» como hace `fixtures-sin-bridge.mjs`. Las medidas (`probeCollide`, frames)
  no dependían del muro; las capturas sí.
- Las hojas de sprites que el coordinador copió a `nefan-html/public/sprites/` son estado de clon (ya lo
  documentó el ingeniero); sin ellas el 05 no arranca partida. No es de esta PR.

## No probado

- **Mutación de `scene-normalize`** (313 mutantes > `tope_local` 120): pedida por el ingeniero, no se espera.
- **Un save real con `W`**: no existe ninguno (ningún productor lo escribió); el hallazgo 5 se midió con un
  tile sintético, no con un save de disco.
- **Gasto real de créditos**: no aplica (todo mockeado).

## Guion entregado

`qa/las-fixtures-solo-chocan-con-el-agua.mjs` — **grupo: corrida LOCAL** (abre Chromium y conduce
`./start.sh --preset html-fixtures`; no entra en `candados-headless`). Declarado en `qa/README.md` (fila de la
tabla «Fuera» y párrafo bajo «El tercer ejecutable»). Cubre el camino cliente → `formatDToWorld` que los
guiones 05/06 (con bridge) no pisan.
