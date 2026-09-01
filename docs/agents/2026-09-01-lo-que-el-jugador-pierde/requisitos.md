# Requisitos — «Lo que el jugador pierde» (#350 + #351 + #352)

> **LEE PRIMERO el § «Reencuadre tras la crítica» del final.** #179 queda FUERA, #351 y #352
> crecen de sujeto, y **todas mis citas de `main.ts` están 13 líneas atrasadas**. Donde este
> documento y ese § discrepen, **manda el §**.

## De dónde sale

Petición literal del usuario, del 2026-09-01:

> Se ha hecho un analisis de arquitectura y hay nuevos issues, planifica como seguir desde aqui

Del plan que salió de ahí y que el usuario aprobó (`~/.claude/plans/federated-spinning-flamingo.md`),
esta es la **tanda T2**, descrita así:

> **T2 · «Lo que el jugador pierde» — #350 + #351 + #352 (+#179 si el arquitecto lo admite)**
> Los tres residuos visibles del QA de la serie anterior. Cierra **3-4**.

La T1 («Un error que nadie oye», #365 #366 #367 #236) está **cerrada y mergeada** en PRs #373 y
#374, más `sprite-forge#2`. `main` = `1e17c1b`.

## El hilo común

Los tres primeros salieron del **QA de la tanda #326** («El mundo vuelve como lo dejaste»), y los
tres son la misma promesa rota vista desde el sofá: **lo que el mundo te había dado deja de estar,
o vuelve mal, y el juego no te explica por qué**. Ninguno es un fallo de infraestructura: los tres
los ve quien juega, sin abrir una consola.

#179 es de la misma familia —lo que el resume no re-enriquece— pero es más caro y vive en el
bridge, no en el cliente. **Entra solo si el arquitecto lo admite sin engordar la tanda.**

## Los cuatro, con la medida de HOY

Verificado contra el código el 2026-09-01. Donde el issue y la medida discrepen, **manda la medida**.

### #350 — «Un objeto o edificio spawneado en runtime desaparece al re-emitir su tile»

Un objeto o edificio que el motor puso con `spawn_entity` desaparece al viajar por «Salidas» y
volver. No hace falta re-entrar por el borde ni reanudar.

> `addTile` purga `objectEntities` **por rect** (`!ids.has(o.id) && !inRect(o.pos)`), mientras NPCs
> y enemigos se purgan **por `tileKey`** — y un spawn de runtime no tiene `tileKey`, así que
> sobrevive. El objeto no tiene esa salvaguarda.

**Medido hoy**: vigente. `nefan-html/src/main.ts:980` sigue purgando por rect; `:987-988` purgan por
`tileKey`. La asimetría se cierra en `:2726-2738`: el push de object/building de `materializeSpawn`
**no escribe `tileKey`** (el de NPC, `:2716-2718`, tampoco — por eso ese sí sobrevive).

**El candado ya está escrito y solo hay que activarlo**: el guion 49
(`qa/guiones/49-el-mundo-de-runtime-aguanta-dos-resumes.mjs:217,279`) lleva la marca `⚠ HALLAZGO`
con la medida exacta. El criterio de cierre del issue pide convertirla en aserto.

**Agravante que el issue nombra bien**: el mundo **se cura solo al reanudar** (el resume sí repara
esa clase), así que el jugador ve desaparecer un cofre, y reaparecer más tarde sin haber hecho nada.

### #351 — «Al reanudar, el enemigo de la escena vuelve a su celda de spawn»

El enemigo de runtime reanuda donde estaba; el de la **escena** reanuda en su celda de spawn del
Format D. Medido en su día: `bandido_1` en (8,01 · 0,70) reanuda en **(12,25 · 0,75)**, con y sin
daño. La vida viaja para los dos; la posición, solo para uno.

**Medido hoy**: la posición **sí** llega al save (`nefan-core/src/narrative/narrative-state.ts:329`,
`rec.position = toTuple(c.position)`). Quien no la devuelve es
`escenaConCombateVivo` (`nefan-core/src/session/mundo-persistido.ts:181-219`), que solo reescribe
`combat.health` / `max_health` y nunca `npc.position`.

**La trampa, y es la razón de que sea tanda propia**: el fail-loud de
`nefan-html/src/main.ts:1106-1109` recorre `[...newNpcs, ...enemies]` —lo que este tile **acaba de
declarar**— con un `!inRect`. Poner la posición viva en `npcs[].position` mete al rehidratado en esa
lista, así que un enemigo guardado fuera del rect de su tile **encendería un error falso** en el
panel del jugador. El arreglo exige que ese candado distinga «recién declarado» de «rehidratado»
**sin debilitarse**.

### #352 — «El aviso de "no pude restaurar esto del save" llega bajo un titular que culpa al motor»

Al reanudar una partida con un bloque de combate ilegible, el jugador ve a pantalla completa
**«El motor narrativo rechazó la respuesta»** sobre un cuerpo que habla de otra cosa. El cuerpo es
exacto y está en idioma de jugador (fue el hallazgo H-2 de #326, cerrado); **lo que miente es el
rótulo**.

**Medido hoy — el issue sitúa mal el fichero**: el rótulo NO vive en
`nefan-html/src/ui/status-labels.ts` sino en **`nefan-core/src/protocol/status-labels.ts:148-153`**
(se mudó al core para que ningún rótulo quedara suelto en `main.ts`). El emisor es
`nefan-core/bridge/handlers/session.ts:295-303` con `kind: "consequences"`, y hoy hay **tres** kinds
(`nefan-core/src/protocol/messages.ts:358`).

**El candado sale casi gratis**: el `Record<NarrativeStatusDeSesion["kind"], string>` de
`status-labels.ts:80` ya obliga a que **añadir un kind sin rótulo no compile**. El cuarto kind entra
con red desde el primer día.

### #179 — «Un map_link creado a mitad de sesión no aparece en el panel de salidas» *(a decidir)*

El motor te promete un destino en el diálogo y el panel «Salidas» no lo tiene. **Ya tiene crítica
propia**, del 2026-08-23, en `docs/agents/2026-08-23-salidas-en-vivo/critica.md`, y su reencuadre
está pegado en el cuerpo del issue: las `exits` son un derivado del world map que se **sella en la
escena y se persiste**, así que **cerrar y reanudar no arregla el panel**; el único hermano real es
`map_upsert_place` (renombrar deja la etiqueta vieja); y **no se arregla re-difundiendo la escena
entera**, que pagaría el atlas y movería el mundo para pintar un botón.

**Medido hoy**: vigente íntegro y **desbloqueado**. `enrichSceneWithExits` sigue teniendo un único
llamante, `nefan-core/bridge/context.ts:329`, dentro de `broadcastScene`; `addLink` solo muta el
world map y marca sucio (`bridge/state-http/map-routes.ts:42-52`); el resume sirve el `scene_data`
persistido sin pasar por el enrich (`bridge/wire-scene.ts:96-107`).

**La dependencia de orden que el issue declara ya se disolvió**: decía que había que esperar a que
#225 partiera la función `handle` de complejidad 158. Ya está partida —los endpoints de mapa viven
en `bridge/state-http/map-routes.ts`— y el molde `onProgress` que pedía existe
(`bridge/state-http-server.ts:41`, `bridge/ws-server.ts:177`).

## Criterios de aceptación

1. Spawneo un objeto y un edificio en el tile activo, viajo por «Salidas» y vuelvo: **siguen ahí**,
   sin reanudar. Y el `⚠ HALLAZGO` del guion 49 pasa a ser un **aserto que se pone rojo**.
2. Hiero a un enemigo de la escena, lo alejo de su celda de spawn, guardo y reanudo: **sigue donde
   lo dejé, con su vida**. Y el fail-loud de rect **sigue pudiendo ponerse rojo** con un enemigo
   *recién declarado* fuera de sitio: el candado no se debilita para conseguirlo.
3. El aviso de «no pude restaurar esto del save» sale bajo un **titular que dice lo que pasa**, y
   nada puede volver a emitir un aviso bajo un titular que nombra a otro culpable.
4. *(Si #179 entra)* Un `map_link` creado a mitad de sesión aparece en «Salidas» sin viajar y sin
   reanudar, **sin re-difundir la escena entera**.
5. Los cuatro quedan candados donde el idioma del repo lo permita: primero el tipo, luego el guion
   de `qa/`. Recordatorio medido: `nefan-html` **no tiene tests unitarios ni entra en mutación**, y
   el CI **no corre** la batería de `qa/`.

## Restricciones

- **Cero créditos**: verificación con el preset `e2e-sin-creditos` y el motor falso.
- **No matar procesos ajenos**: hay otras instancias de Claude en esta máquina. Nunca `pkill`, nunca
  matar por puerto. `qa/run.mjs` elige bloque libre él solo.
- **Pre-producción**: lo que se sustituye se borra el mismo día, entero y en todos los procesos.
- Hay un **PDF sin trackear** en `nefan-core/data/styles/anime/characters/` que no es de nadie de
  esta tanda: **no se toca**.
- Aviso de orden con la T3 del plan (trocear `main.ts`): #350 y #351 viven **dentro de `addTile`**
  (`:878-1148`), que es uno de los dos cortes de T3. Esta tanda va **antes** a propósito — un arreglo
  de veinte líneas rebasa sobre un troceo sin dolor, y al revés no.

## Fuera de alcance

- El troceo del cliente (#358 / #346 / #359): es la T3, con alcance ya elegido por el usuario.
- La economía de combate (#325) y la conducta tras huir (#298): necesitan sesión de diseño con el
  usuario, y el cuerpo de #325 ya no describe el estado tras #353.
- Cualquier cambio en el ledger que no sea el estrictamente necesario para el criterio 2.

---

# Reencuadre tras la crítica (2026-09-01) — MANDA SOBRE LO DE ARRIBA

`critica.md` remidió las cuatro premisas: **las cuatro son correctas**, pero dos issues tienen un
sujeto mayor del que declaran, mis citas de `main.ts` están desplazadas y #179 sale de la tanda.

## 0 · Mis citas de `main.ts` están 13 líneas atrasadas — TODAS

Se tomaron antes de `e4279dd` (la tanda anterior, que metió +13 líneas arriba del fichero). Las
correctas a HEAD (`1e17c1b`):

| Donde digo | Es |
|---|---|
| `main.ts:980` (purga por rect) | **:993** |
| `main.ts:987-988` (purga por `tileKey`) | **:1000-1001** |
| `main.ts:2726-2738` (`materializeSpawn`) | **:2739-2751** |
| `main.ts:1106-1109` (fail-loud de rect) | **:1112-1123** |
| `addTile` `:878-1148` | **:891-1161** |
| `messages.ts:358` | **:363** |

Las citas de core (`narrative-state.ts:329`, `mundo-persistido.ts:181`, `status-labels.ts:80`,
`context.ts:329`, `map-routes.ts:42`, `wire-scene.ts:96`) **sí son exactas**.

## 1 · #352 — mi «candado casi gratis» es FALSO en la mitad que importa

El `Record<kind, string>` de `status-labels.ts:80` canda el **cuerpo**, no el **título**. El titular
sale de un `return` **catch-all** al final de `rotuloDeStatus` (`:149-154`), sin `switch` ni `never`:
**un cuarto kind heredaría «El motor narrativo rechazó la respuesta» compilando en verde.**

Y el issue solo cuenta uno de los mentirosos. Hoy, bajo ese titular:

| Emisor | Lo que de verdad pasó |
|---|---|
| `bridge/handlers/session.ts:295-303` | no se pudo restaurar algo del save *(el del issue)* |
| `bridge/handlers/dialogue.ts:44` | takeover de sesión |
| `bridge/handlers/dialogue.ts:77` | no se pudo guardar |
| `bridge/handlers/simulation.ts:67` | no se pudo guardar |
| `bridge/context.ts:414` | falló un **plugin** |
| `bridge/router.ts:265` | reventó un handler |
| `bridge/handlers/dialogue.ts:54` | **el único honesto** |

Seis de siete avisos a pantalla completa culpan al motor narrativo de algo que no ha hecho.

**DECISIÓN DEL USUARIO: mecanismo + todos los emisores.** Se cierra el catch-all —`switch`
exhaustivo, de modo que **un kind sin rótulo propio no compile**— y cada emisor recibe el suyo.
Probablemente tres o cuatro kinds nuevos, porque se agrupan («no se pudo guardar» son dos). Razón
escrita: el jugador lee los seis igual, y arreglar solo el del issue cumple el criterio 3 **de letra
y no de fondo**.

## 2 · #351 — el sujeto no es «el enemigo», es todo NPC de escena que se movió

`src/simulation/npc-behavior.ts:662-663` muta `record.position` de **cualquier** NPC ambiental, y
`escenaConCombateVivo` ni lo mira: un NPC sin bloque `combat` no tiene estado y sale intacto
(`mundo-persistido.ts:203-208`). **El tabernero que paseó también vuelve a su celda.**

Y `EstadoEnElWire` (`mundo-persistido.ts:77-79`) **no tiene sitio para una posición**: hay que
ensancharlo, y eso no estaba en estos requisitos.

**DECISIÓN DEL COORDINADOR: entra el sujeto entero.** Excluirlo dejaría el mismo bug en el NPC con
el que más habla el jugador, por el mismo camino de código y en la misma función. El criterio 2 se
reescribe abajo.

**Lo que NO esconde una tanda**: el bit «recién declarado vs rehidratado» ya existe **dos veces** en
el mismo fichero — `addTile:1049-1054` conserva la entidad existente en vez de recrearla, y
`materializeSpawn` ya lleva `opts.rehidratado` (`:2673`), puesto por la tanda anterior para esta
misma distinción. Dos vías al alcance sin debilitar el candado: que lo diga el wire (el bridge
sobreescribe la posición y la sabe) o el llamante del resume (`:3010-3057`, ruta única).

**Trampa real y alcanzable**: `src/combat/enemy-ai.ts:87` pone `engaged` y **no lo quita nunca** —
no hay correa ni límite de tile. El arquitecto decide si entra o va a issue, pero que lo decida.

## 3 · #350 — vigente, con una trampa concreta

Tras el arreglo **no queda ninguna otra clase purgada por rect**: `inRect` (`:989`) se queda
sirviendo solo al fail-loud. Y **el resume no es código muerto** ni «cura» nada: es la única vía por
la que un spawn vuelve tras recargar la página.

**Trampa**: si el `tileKey` se escribe en el **llamante** y no *dentro* de `materializeSpawn`, el
objeto rehidratado vuelve sin dueño y el bug **reaparece tras resume + viaje**.

## 4 · #179 — FUERA, por coste medido

Su crítica del 2026-08-23 aguanta íntegra a HEAD, verificada línea a línea. Su mitad cara incluso se
**abarató**: `alWire` (`bridge/wire-scene.ts`, nacido con #353) es el molde exacto de «derivado
encima de lo persistido, en el cable, nunca sellado», ya candado, y el arch-rule
`una-sola-salida-de-escena-del-bridge` **nombra a #179 por su número**.

Pero el molde `onProgress` **no sirve tal cual**: emite un `narrative_status`, y empujar salidas
pide un `ServerMessage` nuevo más su handler de cliente. **Esta tanda ya gasta su presupuesto de
protocolo en los kinds de #352.** #179 se queda con su molde identificado, que es más de lo que
tenía.

## 5 · Criterios de aceptación — versión que manda

1. *(#350, sin cambios)* Spawneo un objeto y un edificio, viajo por «Salidas» y vuelvo: siguen ahí
   sin reanudar. El `⚠ HALLAZGO` del guion 49 pasa a **aserto que se pone rojo**. Y sigue en pie
   **tras resume + viaje**, que es donde la trampa del §3 lo rompería.
2. *(#351, reescrito)* **Cualquier NPC de escena que se haya movido** —enemigo herido o tabernero
   que paseó— reanuda **donde lo dejé**, con su vida. Y el fail-loud de rect sigue pudiendo ponerse
   rojo con un NPC *recién declarado* fuera de sitio: el candado no se debilita.
3. *(#352, reescrito)* **Ningún aviso sale bajo un titular que nombra a otro culpable**, y añadir un
   kind sin rótulo propio **no compila**. Los siete emisores de hoy dicen lo que de verdad pasó.
4. *(retirado: #179 sale de la tanda)*
5. Candado donde el idioma lo permita: primero el tipo, luego el guion de `qa/`. `nefan-html` no
   tiene tests unitarios ni entra en mutación, y el CI **no corre** `qa/`.

## 6 · Dos avisos de deuda que el arquitecto tiene que tener delante

- **`mundo-persistido` está en mutación a `break: 0` con la medida YA PEDIDA.** Tocarlo enturbia esa
  atribución. No bloquea (doctrina: una petición pendiente no bloquea nada), pero se dice en la PR.
- **`status-labels` está a `break: 100`.** Los kinds nuevos entran con red y **hay que matar sus
  mutantes**, no bajar el suelo.

## 7 · Orden respecto a la T3, confirmado con mejor razón que la mía

Yo dije «rebase». El crítico mide algo más fuerte: las tandas son secuenciales, así que la T3
arrancará de un `main` que ya trae esto. Lo que decide es que **fixes-primero cuesta cero rework**,
mientras que troceo-primero obligaría a reubicar tres arreglos y re-apuntar sus guiones.
