# QA — tanda AD · «Cada dueño cuenta su propio arte pendiente» (#492)

> **Renumerados al cerrar (decisión del coordinador, #680):** el guion de esta tanda es el
> **155** y el de esta QA el **156**. Este informe se renumeró ENTERO —etiquetas de captura
> incluidas, que es lo que producen los guiones a partir de ahora—; las corridas que
> describe se hicieron cuando los guiones se llamaban 152 y 153, así que los PNG que
> quedaron de aquellas corridas en `qa/capturas/` llevan el prefijo viejo. Los 152 y 153 de
> `main` son de OTRAS tandas, y por eso no podía quedarse como estaba.

Validado el 2026-09-20 sobre `feature/tanda-ad-cada-dueno-cuenta-su-arte` = `feeea08f` (base `a25d8c2f`;
los siete ficheros que toca la tanda son IDÉNTICOS en `main` `e635159d` y en `a25d8c2f`, así que «contra
`main`» y «contra la base» es la misma comparación). Todo con el preset `e2e-sin-creditos` en el bloque
`NEFAN_PORT_OFFSET=600`, comprobado libre antes (`ss -ltnp`: nada en 3600/10477/10478/19365/4337/9365-9370/
10499) y libre después. Cero créditos. Nunca `pkill`, `--parar-todo` ni matar por puerto.

## Criterios → veredicto → evidencia

| # | Criterio (de `requisitos.md`, con las correcciones del crítico) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | `listFakeItems` fuera de `main.ts`; cada dueño expone su conteo; la raíz solo compone | ✅ cumple | `grep -rn "FakeItem\|listFakeItems\|generateFakeItem\|skinStatus\|activeAngle" nefan-html/src nefan-core/src qa docs/arquitectura` → 0 en código (solo prosa de docblocks que nombran lo retirado). `FpsRenderer.tilesSinAtlas()`, `FpsAtlasController.pendientes()`, `CharacterSpriteManager.pendientes(prompts)`; `main.ts` es un thunk de tres líneas que concatena dos arrays. Matiz: la raíz sigue SABIENDO cuáles son las fuentes de prompts vivos (`aspecto` + `mundo.personajes`), como decidió el coordinador (opción B) |
| 1b | La lista es IDÉNTICA a la de hoy en maqueta, en imagen y con un skin fallido | ✅ cumple | Guion 155 ×3 sobre la rama (`EXIT=0` las tres) y ×1 sobre la base con `listFakeItems` vivo: las cadenas `maqueta · modelo/pintado` e `imagen · modelo` son byte a byte las mismas en los dos árboles (ver «A/B» abajo). Además guion 156 (mío): ocho pares modelo/pintado idénticos entre rama y base |
| 2 | El menú se comporta igual: mismos items, misma generación con el fake-ai-server, desde el arranque | ✅ cumple | Desde `./start.sh --preset e2e-sin-creditos` (lo levanta `qa/run.mjs`), título → mundo → editor → «Comenzar» → botón `Imágenes…`. Generación desde el menú medida en MAQUETA (guion 156: una superficie —POST `/generate_surface_atlas` sin `resolve_only`, botón «Generando…» en vuelo, fila fuera al texturarse— y un skin —POST `/skin_sprite_sheet` con el prompt del jugador, fila fuera al llegar el `idle`—) y en IMAGEN (guion 155: revivir un skin caído, su arte llega). Censo del runner: `puertas pintar-superficies×1` en los dos guiones |
| 2b | Guion nuevo que conduzca `#dev-menu` sobre `e2e-sin-creditos` | ✅ cumple | `qa/guiones/155-el-menu-dev-cuenta-lo-que-cuentan-sus-duenos.mjs` (11 asertos, 3 estados) + el mío `156-el-menu-dev-con-el-jugador-vestido-y-la-partida-reanudada.mjs` (22 asertos, 4 estados más). Los tres sabotajes del ingeniero repetidos por mí sobre el 156: rojo los tres (abajo) |
| 3 | `main.ts` baja y `client-file-size.json` baja a la cifra EXACTA en el mismo commit; el `porque` deja de nombrar el inventario de 8 colaboradores; fuera el docblock «única que lo ve todo» | ✅ cumple | `wc -l main.ts` = **1327** = `client-file-size.json:7` (1381 → 1327, −54). `node --test test/client-file-size.test.ts` → 7/7. `grep "lo ve todo" main.ts` → 0. El `porque` reescrito con el motivo y el número |
| 3b | `character-sprites.ts` ≤ 450 sin subir el tope | ✅ cumple, **con reserva** | `wc -l` = 449 (437 → 449), tope 450 intacto, `eslint` verde. Reserva: el tope se respetó comprimiendo el formato, no el diseño — ver H-1 |
| 4 | `la-logica-de-juego-no-vuelve-al-cliente` y arquitectura verdes; cero conversión celdas→metros nueva | ✅ cumple | `node --test test/architecture.test.ts` → 106/106. `git diff a25d8c2f HEAD -- nefan-html/src \| grep "^+" \| grep -c "TILE_SIZE_M\|cellToWorld"` → 0. Y lo que el crítico ya dijo: ese candado es un censo de identificadores y NO sujeta esto; lo que sostiene la frontera es que es inventario de estado de render |
| — | Unitario del cliente y toolchain | ✅ | `nefan-html`: `npm test` 17/17 (12 nuevos, corridos también aislados: 12/12), `tsc --noEmit` 0, `typecheck:tests` 0, `lint` 0. Core que lee `qa/`: `el-banco-declara-el-modo-de-gasto` 4/4, `esperas-de-qa` 40/40, `la-consulta-de-movimiento-tiene-dueno` 11/11, `candados-headless-totalidad` 18/18 (con el 156 dentro) |
| — | El menú se ve igual (crítica visual) | ✅ | Capturas `155-…-01-155-maqueta-el-menu-dev.png` de la base (`qa/capturas/2026-09-20T11-22-17-541Z-361424/`) y de la rama (`qa/capturas/2026-09-20T11-08-33-409Z-284764/`): el recorte del panel (x 892–1272, y 40–412) da **0 de 141.360 píxeles distintos** (comparación entre dos capturas, para la crítica; ningún verde depende de ella). Misma tipografía, mismas miniaturas del y_bot, misma fila de atlas sin miniatura, mismos botones |

### Los cuatro estados que el A/B del ingeniero no cubría (adversarial 1)

Guion 156, verde 3/3 sobre la rama + 1 tras renombrarlo, verde 2/2 sobre la base, cadenas idénticas:

| Estado | Qué se ve (igual en base y rama) |
|---|---|
| **Jugador VESTIDO desde el título** (`#ts-skin`) en maqueta | 4 filas: atlas + «Skin: escudera… (QA-156) (base y_bot)» + tabernero + bandido. Es el sujeto que le faltaba a D-2 |
| **Superficie `inFlight`** (generada desde el menú en maqueta) | primer click «¿Confirmar? Gastará créditos», segundo «Generando…» (leído nada más confirmar), POST sin `resolve_only`, fila fuera al texturar |
| **Skin ya generado y cacheado** (los tres `idle` listos en imagen) | «Sin imágenes fake: todo lo visible está generado.» con el modelo vacío EN EL MISMO TICK y el libro con 3 `idle` (para que dos vacíos no se comparen entre sí) |
| **Partida REANUDADA desde el save** | en maqueta: 3 skins «base y_bot», sin atlas (restaurado de la librería); en imagen: primero atlas + 3 «generándose», luego vacío. `resume` vacía y reinstala el mundo y `surfaces`/`entries` siguen en el mismo orden |

### A/B contra la base, tal como se hizo

Los seis ficheros de producción (`main.ts`, `dev-menu.ts`, `types.ts`, `fps-renderer.ts`, `fps-atlas.ts`,
`character-sprites.ts`) puestos a `a25d8c2f` con `git checkout a25d8c2f --`, conservando el `nefan-hook.ts`
de la rama (el `skinPrompt` de `enemies()` es instrumento del banco, no conducta). `grep -c listFakeItems
main.ts` = 2, `tsc` 0. Corridas: 155 ×1 y 156 ×2, verde. Restauración con `git checkout HEAD --` y
`md5sum -c` de los siete: **OK los siete**; `git status` al final solo con mi guion y la fila del README.

### Sabotajes en negativo (guion 156, con restauración `md5sum -c` OK entre uno y otro)

| Sabotaje | Rojo |
|---|---|
| El thunk deja de pasar `aspecto.skinPrompt()` (`pendientes([aspecto.skinPrompt(), …` → `pendientes([…`) | **2 rojos, los dos del jugador**: «la lista es la del algoritmo de antes» y «SU fila está en el menú» (pintado sin la escudera, modelo con ella). Es exactamente el candado que D-2 declaró no tener |
| `tilesSinAtlas` no resta lo texturado | 4 rojos: la fila del atlas no se va al texturar, la lista no cuadra, y los dos «vacío» de imagen |
| `generar` del skin sin `force` | 3 rojos: el botón dice «Generar y aplicar» y no «Generando…», el skin no llega, «skins del jugador 0 → 0» |

## Hallazgos

**H-1 · Importante — el tope de `character-sprites.ts` se respetó comprimiendo líneas, no cortando.**
Adversarial 4. El método nuevo lleva dos líneas fuera del formato canónico del repo (`.prettierrc`:
`printWidth: 110`): `kind: "skin", id: prompt, label: …, thumb, disabledReason,` en una y `generar: () => {
this.requestSkin(prompt, { force: true }); return Promise.resolve(); },` en otra. `npx prettier` sobre el
fichero de HEAD lo deja en **467 líneas (17 sobre el tope)**; sobre la base daba 448 (11 ya compradas antes
de esta tanda). O sea: la tanda entra 449/450 porque añade **7 líneas más de deuda de formato** a las 11 que
había. `npm run lint` no lo ve (`eslint-config-prettier` solo apaga reglas; nadie corre `prettier --check`),
así que el primer `npm run format` pone el fichero rojo en `max-lines`. El plan decía «apretar el método,
nunca subir el tope ni comprar líneas»: se compraron con formato. **Qué esperaba**: o el corte que la propia
prosa del JSON anuncia («al siguiente que necesite una línea ahí le toca el corte»), o al menos que el
informe dijera que la holgura de 1 es de formato y no de código. Repro: `cd nefan-html && npx prettier
src/renderer/character-sprites.ts | wc -l`. No bloquea (el trinquete sigue en pie y el fichero es legible),
pero la deuda quedó escondida, no pagada, y el informe la presenta como «UNA línea de holgura».

**H-2 · Menor — D-1 se justifica con un gate que no existe.** `implementacion.md` dice que el `skinPrompt`
de `enemies()` «es DEV-only (dentro del gate `import.meta.env.DEV`)». `grep -rn "import.meta.env.DEV"
nefan-html/src` → **0 apariciones en código**; la única es un comentario histórico del docblock del hook
(«estaba… bajo `import.meta.env.DEV`»). `instalarNefanHook` se llama sin condición (`main.ts:837`). El
cambio en sí es correcto y es lo que pide el rol del hook —expone un campo ya público en `npcs()`, sin
lógica, solo lectura— (adversarial 2: **solo expone, no decide nada**), pero la justificación escrita es
falsa y se congela en un informe. Es el patrón de «una decisión correcta con una razón inventada».

**H-3 · Menor — numeración al fusionar (#680).** El 155 de esta rama choca con
`ne-fan-tanda-v-el-presupuesto-del-tile/qa/guiones/155-el-tile-del-falso-llega-en-segundos.mjs`, y `main`
ya tiene el candado `un-numero-un-guion` (`ad973eda`, que esta rama no lleva porque nace antes). El que
fusione segundo se pone rojo: renumerar entonces. Lo mismo vale para mi 156. Hoy contra `main` (150, 151)
no hay choque.

**H-4 · Menor, observación del runner, no de la tanda.** `node qa/run.mjs 155` casa por SUBCADENA del
nombre: mi guion se llamaba `156-…-que-el-155-no-mira` y la corrida «BASE · 155» ejecutó los dos («2 en
verde de 2»). Lo renombré a `156-el-menu-dev-con-el-jugador-vestido-y-la-partida-reanudada.mjs`. Un guion
cuyo nombre cite a otro por número se cuela en la corrida del otro; el docblock puede citarlo, el nombre no.

**H-5 · Menor, experiencia (pre-existente, idéntico en la base).** Tras REANUDAR una partida en maqueta, el
skin del jugador que se generó desde el menú (y se pagó) vuelve a listarse como «base y_bot» y el botón
vuelve a ofrecer «Generar y aplicar» (captura `156-…-03-156-reanudada-en-maqueta.png`): `vestir` en vector
no re-pide skins y el cliente no sabe que ese arte existe. Con el motor real es cache-hit por prompt; con el
falso «cobra siempre». No es de esta tanda —el criterio era lista idéntica y lo es—, pero el menú ofrece
volver a pagar lo ya pagado sin decirlo. Va con el issue de `inFlight`/`running` que el plan ya deja abierto.

**Observaciones sin hallazgo.** (a) `qa/README.md`: la fila del 155 va precedida de una línea en blanco,
que en GFM la saca de la tabla; la tabla ya tiene una docena de filas así (16, 25, 26, 46, 48…), no es de
esta tanda. (b) La línea `imagen · pintado` del 155 se registra ANTES de la espera `cuadraLaLista`, así que
en el log de la rama muestra al bandido «generándose» y en el de la base no: es la foto transitoria que el
propio docblock explica; el aserto es la espera y salió verde en los dos. Menor confusión al leer logs.
(c) No existe TECLA para el menú dev (docblock de `ui/dev-menu.ts`: «todo por ratón»); la única puerta es
`#ds-menu-btn`, y es la que conducen los dos guiones. `G` pide el atlas del tile activo por otro camino y no
es el menú. (d) Adversarial 3: la declaración D-2 era honesta y correcta el 20 a las 13:00; desde el 156
tiene candado (2 rojos con el thunk sin el jugador). Se acepta como declaración cumplida.

## Workarounds usados

- **A/B por sustitución de ficheros en el worktree** (arriba). No es un obstáculo del usuario: es el método
  de comparación; restaurado byte a byte.
- **Instrumentos en la página**: `addInitScript` del modelo de referencia (`window.__qa156`, solo lee hook y
  DOM) y `page.route` para CONTAR peticiones (deja pasar todas; el 155 además sirve un 500 a UNA víctima,
  que es el estado que mide). Ningún overlay ocultado, ningún estado forzado, ninguna pantalla saltada: se
  entra por título → mundo → editor → «Comenzar» → botón «Imágenes…».
- **`comenzarVestido`** en el 156 replica `comenzar` de `lib/sesion.mjs` añadiendo el `fill` de `#ts-skin`
  entre `#ts-continue` y `#ts-start`: el mismo gesto del jugador, no un atajo.

## No probado

- **Orden relativo entre VARIOS tiles de atlas** en el juego real (el motor falso sirve uno; el unitario lo
  mide con tres claves sobre un stub).
- **`CONFIG.graphics.ai_skin = false`** en vivo (solo unitario: `disabledReason`).
- **La miniatura** por píxel (regla 2). A ojo, en las capturas: y_bot en las filas de skin, vacío en la de
  atlas, igual que en la base.
- **Gasto real** (ai_server/remote-gen reales): fuera de alcance por mandato de cero créditos.
- **La batería de navegador completa**: solo el 155 y el 156 aislados (rama ×3/×4, base ×1/×2) más los
  tests de core que leen `qa/`. El 155 y el 156 no entran en CI (abren navegador).

## Qué deja esta QA en el árbol (sin commitear; los commitea quien fusione)

- `qa/guiones/156-el-menu-dev-con-el-jugador-vestido-y-la-partida-reanudada.mjs` (número al fusionar, #680).
- La fila del 156 en `qa/README.md`, debajo de la del 155.
- Capturas en `qa/capturas/2026-09-20T11-*` (rama, base, sabotajes); `qa/capturas/ultima` apunta a la última.

## Veredicto

**Apto con reservas.** Los cuatro criterios se cumplen y están medidos desde el arranque, la lista es
idéntica a la de `main` en siete estados (los tres del crítico y cuatro más), la generación desde el menú
funciona en maqueta y en imagen con el motor falso, y el menú se ve píxel a píxel igual. Las reservas: H-1
(el tope de `character-sprites.ts` se respetó comprando siete líneas de formato que el informe presenta como
«una de holgura»: el corte que el JSON anuncia queda pendiente y debería ir a issue con el número 467), H-2
(una justificación falsa en el informe, no en el código) y H-3 (renumerar al fusionar). Ninguna exige
volver al ingeniero antes de fusionar si el coordinador acepta abrir el issue de H-1.
