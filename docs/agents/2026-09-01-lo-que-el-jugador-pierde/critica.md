# #350 VIGENTE · #351 REENCUADRADA (mayor) · #352 REENCUADRADA (mayor) · #179 VIGENTE pero FUERA — tanda REENCUADRADA

Medido sobre `1e17c1b`. **Las premisas de `requisitos.md` son correctas; sus citas de `main.ts` están 13
líneas atrasadas** — se tomaron antes de `e4279dd`, que metió +13 arriba del fichero: `:980`→993,
`:987-988`→1000-1001, `:2726-2738`→2739-2751, `:2716-2718`→2718-2733, `:1106-1109`→1112-1123, `addTile`
→**891-1161**; también `messages.ts:358`→363 y `ws-server.ts:177`→181. Las de core son exactas.

## El problema real, uno por issue

- **#350** — el cliente usa dos criterios para la misma pregunta («¿de quién es esta entidad?») y el de
  los objetos es geométrico en vez de por identidad. Su solución ataca eso, no un síntoma.
- **#351** — la posición viva se guarda pero **no se sirve**; dice «enemigo» y el sujeto real es **todo
  NPC de escena que se haya movido**.
- **#352** — «El motor narrativo rechazó la respuesta» no es el rótulo de un `kind`: es el **fallback**
  de una función. El issue lo trata como un rótulo entre iguales, y de ahí sale su plan de candado.
- **#179** — las `exits` son un derivado del world map sellado en la escena persistida (sin cambios).

## La premisa, afirmación por afirmación

| Afirmación | Verificación a HEAD |
|---|---|
| #350 · objetos purgados por rect, NPCs/enemigos por `tileKey`, spawn de objeto sin `tileKey` | **CIERTAS**. `main.ts:993` (`!ids.has(o.id) && !inRect(o.pos)`), `:1000-1001`, `materializeSpawn:2739-2751`. `:993` es la **única** purga por rect del cliente |
| #350 · el resume «cura» el síntoma | **CIERTA**. `main.ts:3046`, `materializeSpawn(spawn,{rehidratado:true})` tras los tiles. Y el coste de tipo es **CERO**, cosa que no estaba medida: `Entity.tileKey?: string` ya existe (`renderer/types.ts:38`) |
| #351 · la posición llega al save; quien no la devuelve es `escenaConCombateVivo` | **CIERTAS**. `narrative-state.ts:329` la escribe en el mismo bucle que la vida; `mundo-persistido.ts:181-219` solo reescribe `combat`. **No medido en los requisitos**: `EstadoEnElWire` (`:77-79`) no tiene sitio para una posición — hay que ensancharlo |
| #351 · «es el enemigo de la escena» | **INCOMPLETA — el sujeto es mayor.** `npc-behavior.ts:662-663` mueve `record.position` de CUALQUIER NPC ambiental, y un NPC sin `combat` no tiene estado (`estadoEnElWire`→`null`) y sale intacto (`:203-208`). El tabernero que paseó también vuelve a su celda de spawn |
| #351 · el fail-loud recorre lo recién declarado y el enemigo puede estar fuera del rect | **CIERTAS y alcanzable**: `main.ts:1119`; `enemy-ai.ts:87` pone `engaged` y **no lo quita nunca**, `updateMovement` no tiene correa ni límite de tile (tiles 64 m, aggro 10 m, `hostiles.ts:57`) |
| #352 · el rótulo vive en core; hay tres kinds | **CIERTAS**. `nefan-html/src/ui/status-labels.ts` **no existe**; es `nefan-core/src/protocol/status-labels.ts:149-154`. Kinds en `messages.ts:363` |
| #352 · «el candado sale casi gratis: el `Record` obliga a que un kind sin rótulo no compile» | **FALSA en la mitad que importa.** El `Record` de `:80` canda el **cuerpo**, no el **título**: el título sale de un `return` **catch-all** al final de `rotuloDeStatus` (`:149-154`), sin `switch` ni `never`. Un cuarto kind heredaría el titular mentiroso **compilando en verde**. El candado del criterio 3 no existe hoy y no es gratis |
| #352 · «lo que miente es el rótulo» | **CIERTA, y hay cinco mentirosos más bajo el mismo título**: `dialogue.ts:44` (takeover), `dialogue.ts:77` y `simulation.ts:67` («no se pudo guardar»), `context.ts:414` (falló un **plugin**), `router.ts:265` (reventó un handler). El único honesto es `dialogue.ts:54`; `ws-server.ts:219` es `ready` y no rotula |
| #179 · enrich con un solo llamante, `addLink` solo marca sucio, el resume no re-enriquece, #225 disuelto | **CIERTAS**. `context.ts:244`/`:329`, `map-routes.ts:42-52`, `wire-scene.ts:96-107`, endpoints ya en `state-http/map-routes.ts` |
| #179 · el molde `onProgress` sirve | **NO tal cual**: `ws-server.ts:181` emite un `narrative_status` (`phase:"progress"`, `kind:"scene"`). Empujar salidas pide **un `ServerMessage` nuevo** (`messages.ts:575-589`) + handler de cliente. Ese es su coste vivo |
| requisitos · `nefan-html` sin tests ni mutación; el CI no corre `qa/` | **CIERTAS**. No existe `nefan-html/test`; `.github/workflows/` son `ci.yml` y `mutation.yml`, ninguno invoca `qa/run.mjs` |

## El día después

- **#350 · ¿queda otra clase purgada por rect?** **No.** Tras el arreglo `inRect` (`:989`) sirve **solo** al
  fail-loud: pasa de dos oficios contradictorios (pertenencia y contrato de conversión) a uno — la mejora
  estructural real del issue.
- **#350 · ¿el resume pasa a ser código muerto?** **No, y llamarlo «cura» confunde**: es la única vía por
  la que un spawn vuelve tras recargar la página (`objectEntities` nace vacío, `:695`). Lo que muere es
  la asimetría. **Trampa**: si el `tileKey` se escribe en el llamante y no DENTRO de `materializeSpawn`,
  el objeto rehidratado vuelve sin dueño y el bug reaparece tras resume + viaje.
- **#351**: la escena del cable pasa a ser «Format D + vida + posición», y `npcs[].position` del
  `scene_data` persistido deja de ser lo que el jugador ve — sin un comentario, parecerá arbitrario.
- **#352**: arreglar solo `session.ts:301` cumple el criterio 3 **de letra y no de fondo** — quedan
  cinco avisos mintiendo. Y hay algo que **borrar**: el `return` catch-all, que es el mecanismo que
  fabrica esta clase de bug, no su víctima.
- **Lo que NO hay que hacer**: bajar el fail-loud a `warn`, quitarle los NPCs o ensancharlo a
  `enemyEntities`. Las tres «arreglan» #351 borrando el candado.

## Conflictos

- **Orden con la T3 (#358) — de acuerdo, por una razón más fuerte que la de los requisitos.** No es
  rebase (las tandas son secuenciales: la T3 arranca de un `main` que ya trae esto): es que
  **fixes-primero cuesta cero rework** y troceo-primero obliga a reubicar tres arreglos y re-apuntar sus
  guiones. Contrapartida menor y honesta: #351 mete un bit más en la firma de `addTile`.
- **#241 / #357**: #350 y la mitad cliente de #351 caen donde **nada mide**, y su único candado (`qa/`) es
  el instrumento que #357 dice que no mide nadie. Argumento para poner el candado de #351 **en core**,
  donde sí hay mutación — no para aplazar.
- **Mutación**: `mundo-persistido` está a `break: 0` **con la medida PEDIDA** (lo dice su propio `porque`)
  — tocarlo enturbia esa atribución: no lo impide, lo avisa. `status-labels` está a `break: 100`, así que
  el kind nuevo entra con red y habrá que matar sus mutantes.
- **#306** toca el mismo canal sin solaparse: allí no hay dónde pintarlo, aquí está mal rotulado. Ninguna regla de `arch-rules.json` se opone; `una-sola-salida-de-escena-del-bridge` **nombra a #179 por su número**.

## Coste contra valor

#350 y #352 son baratos y valen. **#351 no esconde una tanda**: el bit «recién declarado vs rehidratado»
no hay que inventarlo — `addTile:1049-1054` ya conserva la entidad existente en vez de recrearla (o sea,
ya distingue) y `materializeSpawn` ya lleva `opts.rehidratado` (`:2673`), puesto por la tanda anterior
para esta misma clase de distinción. Hay dos vías al alcance que **no** debilitan el candado: que lo diga
el **wire** (el bridge sobreescribe la posición, así que lo sabe) o el **llamante del resume**
(`:3010-3057`, ruta única). Lo infravalorado es lo otro: `EstadoEnElWire` y los pacíficos.

**#179: FUERA.** Su reencuadre de 2026-08-23 aguanta entero a HEAD, verificado línea a línea, y **su
mitad cara se ha abaratado**: `alWire` (`wire-scene.ts`, nacido con #353 el 2026-08-31) es el molde
exacto de «derivado encima de lo persistido, en el cable, nunca sellado», y ya está candado. Pero su
mitad viva sigue costando **`ServerMessage` nuevo + handler + guion**, y esta tanda ya gasta su
presupuesto de protocolo en el cuarto `kind` de #352: dos cambios de protocolo en una tanda es lo que
convierte «cierra 3-4» en «cierra 2». No hacerlo nunca no es defendible —desde #178 el panel es la única
puerta de viaje—, pero su sitio es tanda propia, y hoy sale más barata que hace nueve días.

## Qué le cambiaría a `requisitos.md`

1. Refrescar las seis citas de `main.ts` (+13), `messages.ts:363` y `ws-server.ts:181`.
2. En **#351**, cambiar «el enemigo de la escena» por *toda entidad de escena cuya posición se movió —
   enemigo o NPC pacífico: `npc-behavior.ts:662-663` mueve el record de los dos y `escenaConCombateVivo`
   no devuelve la posición de ninguno*. Y añadir: *hay que ensanchar `EstadoEnElWire`
   (`mundo-persistido.ts:77-79`), que hoy solo transporta vida*.
3. Borrar de **#352** «el candado sale casi gratis…» y poner: *el `Record` de `:80` canda el CUERPO; el
   TÍTULO sale de un `return` catch-all (`:149-154`) y un cuarto kind heredaría el titular mentiroso en
   verde. El candado del criterio 3 hay que construirlo.*
4. Reescribir el **criterio 3**: *ningún aviso sale bajo un titular que nombra a otro culpable — y hoy
   son seis, no uno (`session.ts:301`, `dialogue.ts:44`, `dialogue.ts:77`, `simulation.ts:67`,
   `context.ts:414`, `router.ts:265`). Se mide por cuántos de los seis quedan mintiendo.*
5. En el **criterio 1**, añadir: *el `tileKey` se escribe DENTRO de `materializeSpawn`, para que el
   objeto rehidratado tenga dueño y el bug no reaparezca tras resume + viaje.*
6. Mover **#179** a **fuera de alcance**: *fuera por presupuesto de protocolo, no por mérito; su crítica
   de 2026-08-23 sigue vigente y su mitad de resume se abarató con `alWire` (#353). Tanda propia, ya.*
7. En **Restricciones**, cambiar la razón del orden con la T3: *las tandas son secuenciales;
   fixes-primero cuesta cero rework, troceo-primero obliga a reubicar tres arreglos y sus guiones.*
