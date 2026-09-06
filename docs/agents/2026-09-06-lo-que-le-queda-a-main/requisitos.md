# Programa «Lo que le queda a main.ts» — #358

## La petición, literal

Mandato del 2026-09-02: «Vamos a centrarnos en ir cerrando issues. La parte central hay que dejarla bien pero
los plugins los podemos dejar para mas adelante, el combate, el movimiento, el comercio... todo eso deben ser
plugins y tienen baja prioridad en cuanto a calidad del codigo. Haz una seleccion de los issues centrales y
marca los demas para mirar a futuro».

Orden aprobado el 2026-09-05: T13 → #439 → T12 → **programas** (#358, #346, #241, #224, #388, #356, #293),
«uno por vez y con freno puesto». Hoy (2026-09-06), al proponer #358 como primero: «abrelo».

## El issue, tal como está escrito (#358, revisión de arquitectura del 2026-09-01)

`nefan-html/src/main.ts` concentra game loop, carga de tiles, colisión, diálogo, viaje, HUD, arranque, título
y bootstrap. Cuerpo original: 3.079 líneas, 41 funciones top-level, 40 `let` de módulo, y ningún candado de
tamaño. **Aceptación del issue**: «main.ts troceado por responsabilidad (los 40 `let` de módulo son el mapa de
qué módulos faltan), y valorar un candado de tamaño».

**Parcial ya hecho en #387 (T3, `docs/agents/2026-09-01-el-cliente-deja-de-crecer/`)**, anotado en el propio
issue el 2026-09-01: bajó a 2.326 líneas y 22 `let`; `gameLoop` pasó de 410 a 194 líneas; salieron cinco
piezas con nombre; y el candado de tamaño **existe** en dos motores que no pueden callarse el uno al otro
(`client-file-size.json` → `eslint max-lines` + `test/client-file-size.test.ts` que impide que las excepciones
envejezcan, más la regla `el-tope-de-tamano-no-se-apaga-con-un-comentario`). Lo que NO se hizo, con motivo
escrito: **no se creó `src/game-loop.ts`** porque al bucle le quedaban ~35 colaboradores de `main.ts` y sacarlo
exigía «el objeto de contexto de treinta campos que el plan rechaza por escrito» (`implementacion.md` §4.2 y
`qa.md` §2 de esa tanda, ambos de acuerdo). El comentario del issue lo declara «mecánico sobre este resultado
si se decide hacerlo».

## Medido hoy (2026-09-06, `main` = `3d8252c`), no recordado

| | Cuerpo del issue | Comentario 09-01 | Hoy |
|---|---|---|---|
| `main.ts` líneas | 3.079 | 2.326 | **2.371** |
| `let` de módulo | 40 | 22 | **23** |
| funciones top-level | 41 | — | **41** |
| `title-screen.ts` | 1.605 | 1.651 | 1.732 |
| `fps-gl.ts` | 1.687 | — | 1.687 |
| `style-apply.ts` | — | — | 531 |

- Subió 45 líneas desde el comentario, todas con motivo escrito en `client-file-size.json` (#306: el único
  suscriptor de avisos al jugador vive aquí porque aquí están los dos destinos; #383: un import que pasa a dos;
  bajadas por #405 y QA-F). El trinquete funciona en las dos direcciones: cada cambio de cifra pasó por el JSON.
- Los 23 `let`, por línea, con lo que parecen ser sus grupos (a verificar por el crítico, NO es un plan):
  `playerModel`, `playerSkinPrompt`, `baseSheetsLoaded` (personaje/skins) · `devMenu`, `graphicsChip` (UI de
  desarrollo) · `mundoPintadoDe`, `dialogoDeSesion`, `fixtureCargada`, `ultimaCargaDeFixture` (qué sesión/escena
  está pintada) · `scenesMode`, `charactersMode` (modo de render) · `input`, `attackCatalog`,
  `sessionCombatSystemId` (input y combate) · `gameClient` · `lastRenderError`, `lastTime` (bucle) ·
  `ratonCapturadoAntesDelDialogo` (diálogo) · `muroPuestoPorAviso`, `motivoDelUltimoMuro`, `loaderStartedAt`,
  `loaderTicker` (muro de arranque y loader) · `tituloEnMarcha` (título).
- Los cuatro ficheros por encima del tope 450 son exactamente las cuatro excepciones congeladas: el candado no
  tiene deuda no declarada. `fps-gl.ts` sigue sin issue propio (su excepción lo dice: trocearlo exige decidir
  quién hereda el permiso `three-solo-en-fps-gl`).
- #346 (`title-screen.ts`, seis pantallas) sigue abierto y comparte con este programa el mismo candado y la
  misma excepción; `style-apply.ts` cuelga de #346.
- El cliente NO entra en `npm run crap` ni en mutación (solo `nefan-core`): la única medida ejecutable que hoy
  sujeta a `main.ts` es el tamaño. No hay cobertura ni CRAP del cliente que diga qué función es la peor.

## Lo que este programa tiene que decidir antes de tocar nada (para el crítico)

1. **¿Sigue vigente la mitad viva del issue?** El candado ya está (la mitad «que más pagaba»). Lo que queda es
   «troceado por responsabilidad»: ¿cuál es hoy el **problema real** que 2.371 líneas en un fichero causan, con
   evidencia del repo (PRs de los últimos 30 días que tocaron `main.ts`, conflictos, bugs de estado compartido
   entre los 23 `let`, tiempo de un ingeniero para encontrar algo)? Si la evidencia es «es grande», el crítico
   debe decir si eso basta.
2. **El objeto de contexto**: T3 lo rechazó por escrito. Si trocear exige compartir estado entre módulos, ¿cuál
   es la forma que NO es una bolsa de treinta campos? (Candidatos a examinar contra el código, no a elegir aquí:
   módulos con estado propio y API pequeña —como ya se hizo con las cinco piezas de T3—, o que el estado
   volátil viva en `GameStore` vía `dispatch()`, que es el sitio que CLAUDE.md nombra para el runtime volátil.)
3. **¿Qué se corta primero y cuánto baja?** Un programa «con freno» es varias PR pequeñas, cada una con su cifra
   nueva en `client-file-size.json`. El crítico debe decir si hay un corte con **frontera limpia** hoy (pocos
   colaboradores, `let` propios) o si todo son 35-colaboradores como el bucle. La medida de colaboradores es
   la que decide, no la longitud.
4. **Conflicto con #346**: `title-screen.ts` y `main.ts` se hablan (`tituloEnMarcha`, `titleScreen`,
   `setLoaderState`, el suscriptor de avisos de #306). ¿Hay un corte de `main.ts` que #346 luego deshaga, o
   que le deje el terreno preparado? Orden entre los dos.
5. **¿Cuándo se cierra #358?** El issue no tiene cifra objetivo, así que hoy se cierra «por acumulación» o
   nunca. Propuesta a criticar: se cierra cuando `main.ts` ya no sea excepción de `client-file-size.json`
   (≤ 450) **o** cuando lo que quede en él sea UNA responsabilidad con nombre (el bootstrap) aunque supere el
   tope, con la excepción reescrita para decir eso. El crítico dice cuál de las dos es honesta, o propone otra.
6. **Lo que no cubre el candado**: la concentración (siete ficheros de 430) y el CSS. Si el troceo produce eso,
   no ha resuelto nada. ¿Hace falta algún candado nuevo, o basta con la revisión?

## Restricciones que no se negocian

- **No se matan servidores ajenos**: arrancar con `./start.sh --preset <slug>` y `NEFAN_PORT_OFFSET` propio;
  parar con `./start.sh --parar`. Prohibido `pkill`, prohibido matar por puerto.
- **Cero créditos.** La verificación del cliente con `html-fixtures` o `e2e-sin-creditos`; los guiones de
  `qa/guiones/` que tocan el arranque, el título, el loader, el diálogo y el viaje son la red de este programa
  y tienen que seguir verdes SIN retocarlos (si hay que retocar un guion para que pase, es un hallazgo).
- **Lógica en core, el cliente solo pinta**: trocear `main.ts` no puede mover lógica AL cliente ni duplicar la
  del core; si al cortar aparece lógica que debería estar en core, se anota, no se reubica dentro del cliente.
- **Cero rastros**: lo que se mueva no deja stubs, re-exports de compatibilidad ni comentarios «antes vivía
  en». `grep` a cero.
- **Cada PR baja la cifra de `main.ts` en `client-file-size.json` en el mismo commit** (el trinquete). Ningún
  fichero nuevo del cliente pasa de 450. Ningún umbral se toca.
- **Sin compatibilidad**: pre-producción. Un `let` que resulte muerto se borra.
- Mutación: el cliente no entra; no hay corrida que pedir por este programa.
- Los issues se cierran con el código hecho y verificado; #358 tiene que salir de este programa con criterio
  de cierre en cifras, escrito en el propio issue.

## Aceptación de la petición (a reencuadrar por el crítico si toca)

- Hay un veredicto escrito sobre la mitad viva de #358: vigente / reencuadrada / obsoleta, con la evidencia
  del repo y no con la longitud del fichero como único argumento.
- Si vigente: un **orden de cortes** con la frontera de cada uno medida (colaboradores, `let` propios, quién
  lo importaría), la primera PR definida, y el criterio de cierre de #358 en cifras.
- Cada corte: `npm run verify` verde, `client-file-size.json` con la cifra nueva en el mismo commit, los guiones
  de navegador que tocan lo movido en verde sin retocarlos, cero rastros, y una nota en el issue con la medida.

## Tras la crítica — decisión del usuario (2026-09-06)

Veredicto del crítico: **REENCUADRADA** (`critica.md`). El problema vivo es el churn (72 commits en 41 PR en
30 días), no el estado compartido; el mapa de los `let` está muerto (12 de 23 ya son privados de un bloque);
`GameStore` no es el sitio; el tope 450 no se alcanza sin el objeto de 34 campos que T3 rechazó.

Decisiones, literales de la pregunta y su respuesta:
- Alcance: **«Los siete cortes»** — loader+aviso → etiquetas del mundo → fixtures/selector → spawn →
  personaje/skins → diálogo → HUD de combate, en PR pequeñas y en ese orden. Los tres bloques grandes (bucle,
  arranque, eventos del motor) son la raíz de composición y NO se cortan.
- #469: **«PR propia tras el corte 1»** — primero se mueve el loader tal cual; #469 se arregla después sobre
  el módulo nuevo, con su QA.

## Aceptación reencuadrada

- #358 se cierra cuando `main.ts` tenga **≤ 6 `let` de módulo y ≤ 1.550 líneas**, con su excepción en
  `client-file-size.json` reescrita como «raíz de composición: cableado, bucle, arranque y suscripciones al
  motor». Las cifras van al issue.
- Cada corte es una PR con: `npm run verify` verde, la cifra nueva de `main.ts` en `client-file-size.json` en
  el mismo commit, ningún fichero nuevo > 450, los guiones que ejercen lo movido en verde sin retocarlos, cero
  rastros (ni re-exports ni «antes vivía en»), y el patrón de dependencias ya existente en el cliente
  (`DepsDeCargaDeTile` + fábrica, getter `() => gameClient`), nunca un objeto de contexto.
- El corte 3 reescribe el `path` de la excepción de `solo-el-bridge-normaliza-la-escena` en el mismo commit y
  la PR lo dice.

## Tras el corte 4 — decisión del usuario (2026-09-06)

Medida tras fusionar los cortes 1-4 (`main` = `a6ce5dd7`): `main.ts` 1.836 líneas, 17 `let`. Proyección tras los cortes 5-7,
contada por el ingeniero y por QA por separado y coincidente: **11 `let`** (4 de modos de render + chip + menú dev, 2 destinos de
facetas de sesión `mundoPintadoDe`/`dialogoDeSesion`, 5 de la raíz) y **≈ 1.585 ± 7 líneas**. No alcanza el cierre aprobado.

Pregunta: «La aritmética de los siete cortes deja main.ts en ≈ 1585 líneas y 11 let, por encima del cierre aprobado (≤ 1550 / ≤ 6).
¿Qué hacemos?» Respuesta literal: **«Corte 8 + porValor»**.

Consecuencia: el programa pasa a **ocho cortes** más una mejora estructural en core:
- **Corte 8**: modos de render, chip de gráficos y menú de desarrollo (`scenesMode`, `charactersMode`, `graphicsChip`, `devMenu`;
  ~150 líneas; la crítica midió 10-11 deps, que es la razón por la que quedó fuera de los siete). Necesita plan del arquitecto:
  si las deps no bajan al partir el bloque en dos (modos ↔ menú), se para y se consulta.
- **`porValor`** en `nefan-core/src/session/session-facets.ts` (o donde el arquitecto decida): el ayudante que hace innecesarios
  los dos `let` de facetas en `main.ts`. Es core: entra en `npm run crap` y, si el módulo `session-facets` está medido, en su
  suelo de mutación (35 mutantes, 0 vivos; cabe en `local`).
- El criterio de cierre **no cambia**: ≤ 6 `let` y ≤ 1.550 líneas, excepción reescrita como «raíz de composición» en el último corte.
