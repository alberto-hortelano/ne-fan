# REENCUADRADA

El problema es real y la tanda debe hacerse. Está mal **la justificación de dos de las tres entregas**: la 1 acierta de sitio por un motivo falso, y la 2 va primero por un riesgo que el compilador ya caza.

## El problema real, en una frase

Tocar el cliente es caro porque `main.ts` **crece sin freno** —**+894 líneas (+39,9 %) en 30 días**, en **72 de 366 commits (19,7 %)**— no porque hoy tenga 3.136. El candado mide la derivada, que es el dial correcto.

## La premisa, afirmación por afirmación

Re-medida entera sobre `6c0cf7b`. **La tabla de «Medido hoy» cuadra al completo**: 3.136 / 1.687 / 1.651 · 6.474 / 12.915 = 50,1 % · 40 `let` · `addTile` 891-1186 = 296 · `gameLoop` 1901-2310 = 410 · 706 = 22,5 % · `max-lines` cero · 67 ficheros · 56 guiones. Ninguna cita corrida — al contrario que el cuerpo de #358, cuyas 13 líneas de `let` están muertas todas menos una. Reparos:

- **«`arch-rules.json` no puede contar líneas» — FALSA.** Ver abajo.
- **«37 claves»**: el hook define 37, así que el número acierta, pero **el comando de la tabla da 38** y 4 no son claves vivas: `__nefan.` (artefacto), `__nefan?.tiles` (duplicado), `noExiste` (sonda **rota a propósito**, `qa/esperas-candados-en-negativo.mjs:220`) y `stage` (prosa muerta del proscenio, `labs/narrative/stage-cutouts-e2e.md:26`).
- **«los cuatro con `break: 100`»**: 3 de 4 — `mundo-persistido` es **80**. **«`ci.yml:100-104`»**: son **102-104**.
- `deuda.ts:23`, `index.ts` no es puerta, `nefan-html` sin `test`, ⊘ = exit 2 peor que rojo (`qa/run.mjs:716, 744`): ✓. El criterio 3 es lo más sólido del documento.

### La grave: el motor SÍ cuenta líneas

Ejecuté `checkArchitecture` contra el `main.ts` real con una regla `text`: `^(?:[^\n]*\n){3000}` → **1 violación** (no miles: una); `{4000}` → **0**. Y `nefan-html/src` ya es root de escaneo, con 18 reglas hoy. El motivo escrito («inundaría `npm run deuda`») **no ocurre**. Lo que sí medí, y no está en el documento, es un coste real: el caso *conforme* —el que corre siempre— es el lento, porque la regex falla por retroceso: **379 ms un fichero, 207 ms los tres**, en cada `npm test` y cada `npm run deuda`. Ese, y no el inventado, es el argumento a favor de eslint: la conclusión se salva, la razón hay que reescribirla. Es «una decisión correcta con una razón inventada». Al otro extremo, eslint reporta **«File has too many lines (3136)»** —el mismo número que `wc -l`—, así que candado y criterio 2 miden igual y el criterio 1 sale gratis.

## El riesgo de la entrega 2 no es el que se declara

- Escribir desde otro módulo una `let` importada es **`TS2632: Cannot assign to 'X' because it is an import`** — reproducido con el `tsc` del repo. Es fallo de compilación y `npx tsc --noEmit` está en `ci.yml:102`: no llega a guion rojo.
- Leerla sí funciona: verifiqué en Node que un getter en otro módulo ve el valor nuevo (**live binding**) si el escritor viaja **con** la `let`.
- `playerPos` —la más leída— es **`const` mutado in situ** (`main.ts:654`): cruza módulos por referencia. Y **18 de las 37 claves** cuelgan de `const` colaboradores (`tileStore`, `frontier`, `dialoguePanel`…): se mueven baratas.

Queda un riesgo real, pero es otro: **duplicar** la `let` en vez de moverla deja dos copias, compila limpio y miente en silencio. Extraer el hook antes no lo cura.

**Y la colocación está invertida.** Hook y funciones comparten memoria: **7 `let` las escribe `gameLoop`/`addTile` y las lee el hook** (`input`, `playerForward`, `activeTileKey`, `enemyEntities`, `objectEntities`, `npcEntities`, `playerPitch`), **11 con alcance transitivo** (+`sceneData`, `currentExits`, `attackCatalog`, `playerYaw`); 8 se **rebind enteras** (`enemyEntities = []`), no se mutan. Además **el hook llama a `addTile`** (`main.ts:1412`) y ya alcanza hacia delante ~1.700 líneas (`narrativeClient` de `:2319` leído desde `:603`), que es por qué `estilo` va suelta en `:2430`. Sacar el hook *primero* —con `main.ts` sin un solo `export` y sin que nadie lo importe— obliga a exportar desde un punto de entrada con efectos de arranque (ciclo) o a inventar el objeto de contexto que el propio documento teme. La entrega 2 no «hace segura» la 3: es la que **crea** ese riesgo. El orden lo decide el arquitecto; el motivo escrito no se sostiene.

## El día después

`main.ts` no queda peor **si el estado viaja con su escritor** — el lenguaje lo fuerza (TS2632); queda peor solo si alguien reparte estado y consumidor, y eso se ve en el diff. Pero **el candado no mide el problema que abre el documento**: congelado en tres ficheros nombrados impide que esos tres crezcan y nada más — código nuevo en un `main-2.ts` es libre y la concentración (50,1 %) sigue suelta. No es teatro (frena la regresión concreta), pero es un candado de *tres nombres*, no de tamaño: solo un tope global con excepciones por fichero cierra el rodeo. Y **#379 vive dentro de `addTile`**: cortar sin decidirlo reparte la política duplicada en dos módulos, peor que dejarla intacta en uno.

## Conflictos

- **#329 no está en la lista y debería**: sus tres escrituras caen **dentro de `gameLoop` (1901-2310)** y su retirada de `dialogueActive` **dentro del bloque DEV del hook**. Choca con las entregas 2 y 3 a la vez.
- **#378** dice en su cuerpo *«el orden natural es tipo primero»*. Aparcarlo puede estar bien; callar que reclama prioridad, no.
- **#346**: el candado debe decidir si `title-screen.ts` entra — creció +46 líneas hoy. Decisión compartida, no independiente.
- Lo mergeado hoy explica el desfase exacto de #358: **+83/−26** en `main.ts`.

## Coste contra valor

Vale la pena, y **el freno vale más que el corte**: si solo entrara la entrega 1 la tanda ya habría pagado. Coste **no presupuestado**: sacar lógica a `nefan-core/src` la mete en la medida. Modelado sobre la cobertura declarada (90,1 %) y 23.474 líneas de `src`, **+700 líneas al 50 % bajan el global a 88,9 %** y `npm run crap -- --check` (`ci.yml:60`) se pone rojo contra el suelo de 89: lo extraído tiene que llegar a ~90 % o no entra. Y el criterio 5 contradice al 4 — medir código que nadie medía **produce** deuda, la buena noticia que el documento defiende en su §intención. Además `npm run verify` **no** corre `crap` ni `coverage`: no vigila la única puerta que esto puede tirar.

## Qué le cambiaría a `requisitos.md`

1. **Entrega 1, sustituir el «Aviso técnico verificado»**: *«`arch-rules.json` sí puede contar líneas (un `text.pattern` de N saltos da 1 violación, no miles), pero el caso conforme cuesta 379 ms por fichero en cada `npm test` y cada `npm run deuda`. Por eso va a `eslint.config.js`, cuyo contador coincide con `wc -l`.»*
2. **Borrar «Es el paso que hace segura la entrega 3»** y el párrafo del getter en rojo; poner: *«escribir desde otro módulo una `let` importada es TS2632 y lo caza `tsc --noEmit`; el hook comparte 7 `let` (11 transitivas) con `gameLoop`/`addTile` y llama a `addTile` (`main.ts:1412`): las entregas 2 y 3 no son separables. El orden lo fija el arquitecto.»*
3. **Añadir #329 a «Conflictos conocidos»**; anotar que #378 reclama prioridad.
4. **Criterio 1**: decir si el tope es global o de tres nombres, y reconocer que la variante de tres nombres no cubre `main-2.ts`.
5. **Criterio 5**: cambiar «`npm run deuda` sin items nuevos» por «`npm run coverage && npm run crap -- --check` verde (suelo 89 %); los items nuevos de código recién medido se declaran, no se evitan».
6. **Criterio 3**: «las claves vivas del hook» en vez de «las 37», sin `noExiste` ni `stage`.
