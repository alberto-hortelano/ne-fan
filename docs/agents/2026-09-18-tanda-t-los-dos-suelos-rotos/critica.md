# Crítica — Tanda T (#675 + #676)

**Veredicto: REENCUADRADA.** Los dos suelos están rotos de verdad y hay que recuperarlos sin tocar cifras, pero
los dos enunciados describen mal DÓNDE está el agujero, y el criterio 1 de `requisitos.md` para el 404, tal
como está escrito, produce un test que **ya existe y no mata al mutante**: la tanda volvería con el suelo roto
y pagando otra corrida autorizada.

## El problema real, en una frase

El gate de mutación lleva dos corridas en rojo por dos suelos conocidos y ya no distingue un rojo nuevo; hay
que devolver `npc-director` a ≥ 81 y `state-http-dispatch` a 100 matando mutantes, no moviendo números.

## La premisa, afirmación por afirmación

**Los informes están.** `nefan-core/reports/mutation/corrida.json` es la `35354800866` (sha `e8bd1f02`,
desde `900b5b71`), con `npc-director.json` y `state-http-dispatch.json` dentro y línea:columna de cada
mutante. La huella (`mutacion-huella.json`) solo guarda hashes (`12f706ba…`), no sirve para localizarlos. Los
dos blobs casan con HEAD (`place-target.ts` = `02cffcbf`, `dispatch.ts` = `aa1632d2`): la medida habla de
este código.

**#675 — «18 supervivientes de `place-target.ts`».** Cierto en la cuenta, falso en la naturaleza: el informe
dice **4 `Survived` + 14 `NoCoverage`**, y la huella ya lo registra (`sin_ejercer: 14`; `npm run deuda` lo
rotula «ahí no falta un aserto, falta un test», `scripts/deuda.ts:266`). Los 14 son dos ramas que ningún test
de la batería entra:
- `place-target.ts:28` (anchor SIN `rect` → centro del tile): 5 mutantes + el `Survived` de `21:9`.
- `place-target.ts:31-35` (sin anchor, `realized_scene_id` que es tile): 9 mutantes + los dos `Survived` de `31:7`.
- El cuarto `Survived`, `16:7`, es «place inexistente → null», que nadie prueba.
El único test que llama a la función de verdad es `test/npc-director.test.ts:111-137`, con dos casos: anchor
con rect (`plaza`) y sin nada (`lejos`). Los otros callers de la batería son mocks (`npc-behavior.test.ts:57…`).
Así que **no es deuda de asertos sobre 18 literales: es que dos de las tres vías que el propio docblock declara
(`place-target.ts:3-6`) no tienen test**. Con fixtures en un tile con `tx≠0` y `ty≠0` (si no, `minZ+maxZ` es 0
y los `*2` sobreviven por simetría), un caso de realizado que NO es tile (`"escena_x"`, mata `33:9→true` porque
`tileWorldRect(null.tx)` lanza) y un place inexistente, **mueren los 18, no 9**: el módulo queda 131/150 =
87,33 %, no 81,33 %.

**#676 — «nadie mira lo que dice el error; se puede vaciar entero».** Falso desde #670 (`a8e63da6`, ancestro de
las DOS corridas): `test/state-http-dispatch.test.ts:744` define `ESE_404 = /^no_session: GET \S+ describe una
partida/` y `:766-767` lo afirma junto a `/abre o reanuda una partida/` para las cuatro rutas. Por eso el
informe da **muertos** los fragmentos `133:9` y `135:9` y vivo SOLO `134:9-134:97`: el fragmento del medio,
`(ni start_session ni resume_session han corrido, o el save se borró). No hay nada que `. Lo que nadie
comprueba son **las dos CAUSAS**, no la ruta ni la salida. Y el gemelo del 409 (`dispatch.ts:114`) sale muerto
por accidente tipográfico: `/No se ha aplicado nada/` (`:626`) cruza el salto de línea entre los fragmentos 114
y 115; un reflow de la cadena lo resucita. La regla que falta es una y vale para los dos mensajes: **todo
`no_session` nombra las dos causas** (start/resume no corrido, save borrado).

**Topes.** `npc-director` 150 y `state-http-dispatch` 75 + 64 = 139 mutantes, ambos > `tope_local` 120: la
verificación a mano del rojo que pide el criterio 2 es la vía correcta.

## El día después

- Para quien juega: nada. Es deuda declarada (gate rojo que no discrimina), y se dice.
- Se cierra una puerta pequeña y buena: una fixture con un `anchor` sin `rect` y otra con tile realizado
  quedan escritas, que es justo lo que #646/#465 discuten (el destino del NPC). Las aserciones sobre «centro»
  cementan lo que hoy hace la función y documenta `bridge/handlers/scene.ts:100`; #646 dice explícitamente que
  su arreglo no es en `resolvePlaceTarget` sino en el NPC (rodear = #618), así que no las va a tener que tirar.
- El `break` de `npc-director` seguirá en 81 aunque el módulo salga a 87: el `porque` del contrato dice que se
  mueve tras la corrida, no antes. Quien reparta la corrida autorizada decide si sube; la tanda no lo toca.
- Arbitrario dentro de un mes: nada, si los tests se cuelgan del docblock de `place-target.ts` y no de la
  lista de mutantes.

## Conflictos

- **#646** (bloqueado): mismo fichero, otra conducta; fuera de alcance y compatible (ver arriba).
- **Tanda AA** toca `bridge/state-http/session-routes.ts`, no `dispatch.ts`; ninguna otra tanda de hoy nombra
  `place-target`, `npc-director` ni `dispatch.ts` en su sección propia. Rozadura solo si alguna añade un test
  que importe `place-target.ts` (el candado de batería lo exigiría en `tests` de `npc-director`).
- Ningún candado de `arch-rules.json` ni decisión de `CLAUDE.md` implicada: son tests nuevos.

## Coste contra valor

Barato y necesario: dos o tres casos en `npc-director.test.ts` (o un test propio de `place-target` añadido a la
batería del módulo) y un aserto sobre las causas en el 404 (y el mismo en el 409, que hoy vive de un salto de
línea). No hacerlo deja el gate ciego a un rojo nuevo en cada corrida. El riesgo real era hacerlo **como está
escrito**: un aserto de «ruta + salida» duplicaría `:766-767` y el 404 seguiría a 99,28 %.

## Qué le cambiaría a `requisitos.md` (pegar tal cual)

Sustituir el criterio 1 por:

> 1. `place-target.ts`: los 18 «supervivientes» son 4 `Survived` + **14 `NoCoverage`** (dos ramas del contrato
>    del docblock `place-target.ts:3-6` que ningún test entra: anchor sin `rect` → centro del tile, línea 28; y
>    `realized_scene_id` tile → centro del tile, líneas 31-35). Los tests se escriben sobre ESA regla —las tres
>    vías de resolución y los dos `null` (place inexistente, realizado que no es tile)—, con fixtures en un tile
>    `tx≠0, ty≠0` para que la aritmética del centro no sobreviva por simetría. Objetivo: los 18, que dejan el
>    módulo en 87,33 %; el mínimo que recupera el suelo son 9.
>    `dispatch.ts`: el mutante vivo es `134:9-134:97`, el fragmento de las **causas** del 404 («ni start_session
>    ni resume_session han corrido, o el save se borró»). La ruta y la salida YA se afirman en
>    `test/state-http-dispatch.test.ts:744,766-767` y no lo matan. La regla nueva: **todo `no_session` (404 y
>    409) nombra las dos causas**; el 409 (`dispatch.ts:114`) hoy muere solo porque `/No se ha aplicado nada/`
>    cruza un salto de línea, así que la misma regla lo sujeta de verdad.

Y en «Fuera de alcance» añadir: «Subir el `break` de `npc-director`: se decide al repartir la corrida, con el
número medido.»
