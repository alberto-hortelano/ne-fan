# QA — Tanda AC (#605) · `scripts/mutacion.ts` troceado por CIERRE de llamadas

Validado sobre `feature/tanda-ac-mutacion-ts-troceado` = `9c67e264` (un commit sobre `main` =
`a25d8c2f`), en el worktree `/home/al/code/ne-fan-tanda-ac-mutacion-ts-troceado`, sin stack, sin
créditos, sin mutación real, sin `traer` ni `repartir` (prohibidos por el coordinador: escriben la
huella o vacían `reports/`). `nefan-core/reports/` es la copia en solo lectura de la corrida
`35354800866` (36 informes + `corrida.json`, `mutation-base` con 60, `mutacion-tiempos.json`).

Máquina con carga 9-11 (otras tandas en paralelo). Todo lo que rompí lo restauré con
`git checkout` y `git status --porcelain` limpio después de cada paso; lo digo fila a fila.

## Criterios → veredicto → evidencia

| # | Criterio (literal de `requisitos.md`) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | `mutacion.ts` se queda con `VERBOS` y el enrutado | ✅ cumple | `wc -l` = 121. AST (`typescript` de nefan-core): 8 sentencias — 5 `import`, `const VERBOS`, `function main`, `main();`. Sin `export`. Lo mide el guion nuevo **158** (bloque A), verde |
| 1 | cada sujeto vive en su módulo, **por CIERRE de llamadas y no por verbo** (un fichero por verbo PROHIBIDO) | ✅ cumple | Seis trozos: `repo` 238 · `informes` 167 · `github` 223 (traer, cola) · `pedir` 150 (pendiente, local, ancla) · `lotes` 395 (lotes, manifiesto, fusionar) · `reparto` 624 (repartir + comparar sobre el cierre compartido). Ningún fichero tiene un solo verbo salvo por cierre; `comparar` NO tiene fichero propio |
| 1 | sin duplicar el lector de la huella ni los tipos | ✅ cumple | **Diff estructural propio por AST** (`scratchpad/diff-estructural.mjs`): 69 declaraciones top-level en `a25d8c2f:mutacion.ts` (sin imports) → **68 reaparecen byte a byte** (módulo `export `, que ganan 32), **0 duplicadas** en más de un trozo, la ÚNICA sin contrapartida es el guardia `if (process.argv[1]?.endsWith("mutacion.ts")) main();` y la ÚNICA nueva es `main();`. Es un MOVIMIENTO, no una reescritura |
| 2 | los `qa/mutacion-*-en-negativo.mjs` en verde después del corte | ✅ cumple (cableado) | `node qa/mutacion-cableado-en-negativo.mjs` ×1 (turno libre): **20 probados / 20 rotos / 0 no se enteran**, exit 0, 1m14s. Ni «patrón obsoleto» ni «VERDE-FALSO». `git status` limpio y `reports/` intacto después (`mutation`, `mutation-base`, `mutacion-tiempos.json`; sin `colado`, sin `mutation.qa-cableado`) |
| 2 | `qa/mutacion-reparto-en-lotes.mjs` en verde | ✅ cumple, con la salvedad dicha | La completa (16 min; la única que ejerce los dos `rompe` repuntados, porque viven en los PROBES y `--solo-vigentes` los deja fuera) la corrí UNA vez, y no sobre el árbol limpio sino con **un comentario añadido a propósito** en `mutacion-lotes.ts` para el negativo del hallazgo 4 (ver abajo). Resultado en la sección «Corrida del duplicado». El `--solo-vigentes` que corre CI no lo repetí: el ingeniero declara 3× |
| 2 | byte a byte de `pendiente`, `lotes`, `comparar` (en seco) sobre el MISMO árbol | ✅ cumple | `git show a25d8c2f:…/mutacion.ts > scripts/vieja-mutacion.ts`, las dos entradas sobre el mismo árbol y el mismo `reports/`, `cmp` de stdout + stderr + código: **`pendiente`, `pendiente --ids`, `lotes`, `lotes --todos`, `comparar` (exit 1, 11.255 B), `comparar --timeouts reports/mutation-base` (exit 1, 14.129 B), `cola 35354800866` (exit 0, `gh` real), `ancla` → IDÉNTICOS**; `manifiesto` (sin flags, exit 1) idéntico salvo las líneas de traza de V8 (fichero:línea), mensaje `Error: manifiesto necesita --origen` igual. `vieja-mutacion.ts` borrada después (`ls scripts \| grep vieja` = 0), árbol limpio |
| 2 | los 16 `rompe` repuntados casan por TEXTO EXACTO y **una sola vez** | ✅ cumple | Cableado: el propio guion exige `veces === 1` y no dijo «patrón obsoleto» en ninguno de los 14. Lotes: sus 2 patrones aparecen exactamente una vez en la familia entera (`git show HEAD:` de los nueve `mutacion*.ts`: `verificaDescarga(parcial, presentes)` solo en `mutacion-lotes.ts`, `Math.max(...medidos)` solo en `mutacion-repo.ts`) — pero **el guion de lotes no lo comprueba** (hallazgo 4) |
| 2 | los tres `poner` sustitutos ponen rojo **por SU razón** (sin `ReferenceError`) | ✅ cumple | Aplicados A MANO, uno por vez, verbo real, restaurado: **`:269` ancla** `commitsDelRango(plan, corrida.sha, corrida.sha)` → con el ensayo del propio guion (copia temporal en `qa/` que imprime el observable entero, filtrada al invariante; borrada) el `repartir` de ensayo lanza `Error: la corrida 999901 dice haber medido el RANGO desde f5b84ba hasta 91fa1ed, y ese rango no tiene ni un commit` en `mutacion-reparto.ts:129`, 0 `ReferenceError`. **`:439` huella** `escribeHuella({ ...ctx.base, ficheros: {} })` → `comparar` exit 1, `git status` = `M data/contract/mutacion-huella.json`, huella escrita con **0 ficheros**, 0 `ReferenceError`. **`:465` reports** `git(["config","--file",…"reports/colado"…])` → `comparar` deja `reports/colado` con `[qa] colado = 1`, 0 `ReferenceError`. Los tres `buscar` aparecen 1 vez |
| 2 | `test/afectado.test.ts` `GUIONES` censa TODOS los ficheros nuevos que hagan `git diff --name-only` | ✅ cumple | `GUIONES` = `instrumentoDeMedida()` filtrado a `scripts/`: **14** ficheros hoy (los seis trozos dentro). Positivo: 9/9. **Negativo**: quitado `...SIN_RENOMBRAR` del `--name-only` de `mutacion-repo.ts:93` → `fail 1`, `AssertionError: scripts/mutacion-repo.ts: 1 \`git diff --name-only\` sin \`...SIN_RENOMBRAR\``. Restaurado |
| 3 | cero cambios de conducta colados | ✅ cumple | Diff estructural (68/69 + guardia) + byte a byte. El único cambio con efecto es el guardia retirado, y su efecto para el CLI es nulo (los 8 `cmp`). Un residuo sin efecto: `gitLineas` sale `export`ado y nadie lo importa (hallazgo 3) |
| 4 | decidido y escrito si los módulos entran en alguna medida; si no, el motivo en los JSON | ✅ cumple | Escrito en `implementacion.md` §«Tests» y en la cabecera de `mutacion.ts` («fuera del perímetro por definición, no por exención»). `git show --stat 9c67e264`: **ningún JSON de `data/contract/` tocado**. `npm run deuda`: no nombra `scripts/`, exit 0. `npm run afectado -- --rango a25d8c2f..HEAD`: **«EJECUTA LOS 65 MÓDULOS»** nombrando los seis trozos como instrumento SIN lista a mano (`ENTRADAS_INSTRUMENTO` sigue siendo dos) |
| — | `npm run verify` | ✅ cumple | build + typecheck:scripts/labs/tests + lint + test: **3117/3117, fail 0**, exit 0, 1m19s, sobre el árbol limpio |
| — | nadie importa `mutacion.ts` (ahora sin guardia: importarlo ejecuta `main()`) | ✅ cumple | 0 importadores en 709 ficheros de `git ls-files` (`.ts/.mts/.js/.mjs/.cjs`, tres puertas: `from`, `import "…"`, `import()`/`require()`). Lo canda el guion **158** (bloque C); negativo: `import "./mutacion.js"` en `deuda.ts` → rojo `nefan-core/scripts/deuda.ts:41` |
| — | retirada entera: `grep` a cero en prosa/yml de lo que se movió | ❌ NO cumple (menor) | Dos rastros. `.github/workflows/ci.yml:291` («rompe `mutacion.ts`, `mutate.ts` y `mutation.yml`»), **declarado** por el ingeniero. **`nefan-core/data/contract/arch-rules.json:992`** (`why` de `comparar-no-escribe`): «las líneas del verbo que viven en `scripts/mutacion.ts` (ese fichero escribe la huella por diseño)» — hoy viven en `mutacion-reparto.ts` y quien escribe la huella es `mutacion-repo.ts`/`reparto`. **NO declarado**: el `grep` del plan (§5) no pasó por `data/contract/` (hallazgo 1) |
| — | orden de fusión (después de repartir la corrida de T, o declararlo) | ⚠️ no probado | Es decisión del coordinador. El commit lo declara en su mensaje («fuerza la corrida COMPLETA … o se fusiona DESPUÉS»); `afectado --rango` lo confirma (65 módulos) |
| — | `traer`, `local <id>` real, `repartir` real | ⚠️ no probado | `traer` no lo ejerce nadie ni antes ni después (red + vacía `reports/`); `local <id>` lanzaría una corrida; `repartir` prohibido. Sus caminos de error sí pasaron por el byte a byte del ingeniero (`local`, `cola` sin id, `fusionar`) |

## Hallazgos

Ninguno bloqueante.

1. **Menor — rastro en un contrato: `nefan-core/data/contract/arch-rules.json:992`.** El `why` de la
   regla `comparar-no-escribe` dice que «las líneas del verbo … viven en `scripts/mutacion.ts` (ese
   fichero escribe la huella por diseño)». Tras el corte ese fichero no escribe nada ni tiene una
   línea de verbo. La regla de la casa es retirada entera el mismo día con `grep` a cero en prosa;
   este fichero se quedó fuera del barrido porque el plan §5 solo grepeó `scripts/`, `test/`,
   `qa/*.mjs` y `qa/README.md`. Repro: `grep -n 'scripts/mutacion.ts' nefan-core/data/contract/arch-rules.json`.
   Lo esperado: que nombre `mutacion-reparto.ts` (el verbo) y `mutacion-repo.ts` (quien escribe).
2. **Menor — `.github/workflows/ci.yml:291`**, el comentario del paso de `cableado`. Declarado por
   el ingeniero como rastro y dejado por el coste de tocar workflows sin scope `workflow`; que lo
   decida el coordinador (una línea, commit suelto).
3. **Menor — `gitLineas` exportado sin importador** (`mutacion-repo.ts`). De las 32 declaraciones
   que ganaron `export`, es la única que nadie de fuera usa (`grep` sobre `scripts/`, `test/`,
   `qa/`). Superficie que no hace falta; lint no ve exports sin uso. Repro:
   `grep -rn '\bgitLineas\b' nefan-core/scripts nefan-core/test qa --include='*.ts' --include='*.mjs' | grep -v mutacion-repo.ts` = 0.
4. **Menor, preexistente y ahora más fácil de pisar — el guion de lotes no exige `veces === 1`.**
   `qa/mutacion-reparto-en-lotes.mjs:657-667` hace `texto.includes(busca)` y
   `texto.replace(busca, pone)`: sustituye la PRIMERA aparición y calla. Con 16 patrones repartidos
   en cuatro ficheros en vez de uno, un patrón duplicado (en un comentario, en un segundo sitio del
   mismo cierre) deja el probe apuntando a donde no es sin que el guion lo diga; el de cableado sí
   lo dice («patrón obsoleto: aparece N veces»). Confirmado con un duplicado sintético (sección
   siguiente). El test de las anclas (`las-anclas-de-los-candados.test.ts`, #486) NO cubre estos
   dos `.mjs`: solo la tabla de `qa/lib/invariantes-en-negativo.mjs`. Merece issue, como dice el
   ingeniero; no se arregla aquí.

   > **Matiz del INGENIERO tras terminar la corrida del duplicado (`exit=1`, 12 min 17 s): la
   > lectura del código está bien, la predicción del observable no.** El duplicado **no** deja el
   > guion «verde y callado». Lo que pasa, medido: `cableado` **sí** exige `veces === 1`, así que
   > con la copia puesta declara «patrón obsoleto» y sale ≠ 0 **sobre el árbol supuestamente
   > limpio** → la línea base del guion de lotes nace envenenada (`bateria:0 · candados:0 ·
   > **cableado:1**`) → su probe muta bien (el `replace` cae en la línea real, que es la primera),
   > pero el checker no cambia de valor → «nadie se entera» → **`✖ SIN CANDADO Y SIN ISSUE` sobre
   > `fusión · fusionar deja de verificar el SELLO`, un diagnóstico FALSO de un invariante sano**,
   > y `exit=1`. O sea: un duplicado no es silencioso, es RUIDOSO y apunta al sitio equivocado —
   > que para quien lo lea es peor, porque manda a arreglar algo que no está roto.
   > La forma silenciosa que este hallazgo describía **existe pero es otra y no está medida**: un
   > patrón duplicado en un fichero que `cableado` NO rompe también — p. ej.
   > `Math.max(...medidos)` en `mutacion-repo.ts`, cuyo único checker es `bateria`—; ahí sí
   > sustituiría la copia que toque sin que nadie lo dijera. El issue **#700** cuenta las dos.
   > Restaurado con `git checkout`, `cableado` vuelve a **20/20 exit 0** y el guion de lotes sobre
   > el árbol limpio da **0 de 11 · 0 nuevos · 0 falsas**, exit 0: el rojo era el sabotaje, no el
   > corte.
5. **Observación, no de esta tanda** — `qa/mutacion-reparto-en-lotes.mjs` promete restaurar con
   SIGINT/SIGTERM (`:579`). Al parar mi primera corrida a mitad de la fase ABIERTA (por la
   herramienta del agente, señal no elegida por mí), los FUENTES sí volvieron pero `reports/` quedó
   apartado en `nefan-core/reports.qa-lotes/` con el ensayo en su sitio y, anidado, el
   `reports/mutation.qa-cableado` del checker de cableado que corría como hijo. Lo restauré a mano
   (`rm -rf reports && mv reports.qa-lotes reports`, comprobado 37 + 60 + tiempos) y el guion se
   habría NEGADO a arrancar hasta entonces (`:541`), que es su guardia funcionando. Si la señal fue
   `SIGKILL` no hay nada que arreglar; si fue `SIGTERM`, el hijo `cableado` no se lleva la señal.
   No lo pude distinguir; lo apunto.

Desviación del plan sin efecto: el plan pedía que el mapa `fuentes` de cada `.mjs` listara «los
SEIS trozos + `mutacion.ts`»; la implementación lista solo los que rompe (3 en cableado, 2 en
lotes). `fuentes` es la foto para RESTAURAR, así que listar ficheros que nunca se tocan sería peso
muerto. Correcto, y lo digo para que no parezca olvido.

## Corrida del duplicado (hallazgo 4)

Sabotaje: `//    const errores = verificaDescarga(parcial, presentes);` insertado en
`mutacion-lotes.ts:288`, justo DESPUÉS de la línea real (el patrón aparece 2 veces; ninguna
conducta cambia). Predicción: el guion de cableado diría «patrón obsoleto»; el de lotes sale VERDE
y calla.

**Resultado (lo rellena el INGENIERO al terminar la corrida, 12 min 17 s, `exit=1`): la predicción
falló y el guion salió ROJO.** No por lo que dice la etiqueta, sino por la cadena entera:

```
  (línea base con el árbol limpio: bateria:0 · candados:0 · cableado:1)
✖ SIN CANDADO Y SIN ISSUE  fusión · `fusionar` deja de verificar el SELLO de cada lote (#420 reabierto)
Invariantes vigentes rotos: 0 de 11 · Hallazgos NUEVOS sin candado: 1 · exit=1
```

El patrón aparece dos veces (la línea real y la comentada, que lo contiene detrás del `//`);
`cableado` **sí** exige `veces === 1` y se pone ≠ 0 con el árbol «limpio», así que la línea base
del guion de lotes nace con `cableado:1`; su probe muta bien —el `replace` cae en la primera
aparición, que es la real— pero el checker no cambia de valor, y de ahí el hallazgo nuevo
inventado. Ver el matiz del hallazgo 4 arriba: la lectura del código era correcta, el observable
predicho no. Restaurado (`git checkout -- nefan-core/scripts/mutacion-lotes.ts`), `cableado`
vuelve a 20/20 exit 0 y `reports/` quedó entero (37 · 60 · tiempos, sin `reports.qa-lotes`).

## Workarounds usados durante la prueba

- **`vieja-mutacion.ts` regenerada** desde `a25d8c2f` para el byte a byte y **borrada** después.
  No es un obstáculo del usuario: es la técnica para comparar sobre el mismo árbol.
- **El `poner` del ancla se probó por el ensayo del propio guion** (copia temporal
  `qa/_qa-tmp-poner254.mjs` con el `observado` a 6.000 caracteres en vez de 240, filtrada al
  invariante, borrada), porque `repartir` contra los informes reales está prohibido. Lo que
  revela de paso: el diagnóstico «VERDE-FALSO» del guion recorta el observable a 240 caracteres y
  con una traza de V8 delante el mensaje real no cabe. Menor; no afecta al jugador.
- **`reports/` restaurado a mano** tras la parada (hallazgo 5). Verificado antes de relanzar.
- Ningún `display:none`, estado sintético ni pantalla saltada: aquí no hay jugador; el «usuario» es
  quien corre `npm run mutacion`, y el camino probado es exactamente ese.

## No probado, y por qué

- `traer` (red + vacía `reports/`), `local <id>` con un id real (lanza una corrida), `repartir`
  (escribe la huella): prohibidos o con efecto irreversible. `traer` no tiene evidencia ejecutada
  ni antes ni después del corte, como declara el ingeniero.
- La regla «3× cada guion, aislado y en par»: corrí cableado ×1 (instrucción del coordinador) y
  lotes completo ×1 con el duplicado; el resto es la declaración del ingeniero.
- El efecto de la PR sobre la ATRIBUCIÓN de la próxima corrida (co-candidata de todo superviviente
  nuevo): solo se ve al repartir la corrida siguiente.

## Lo que dejo

- `qa/guiones/158-mutacion-ts-solo-enruta-y-nadie-lo-importa.mjs` — `sinNavegador` + `sinMotor`,
  entra solo en `node qa/run.mjs --sin-navegador` (0,4 s). Verde en positivo; **rojo en negativo** por
  su razón con los dos sabotajes (función extra en `mutacion.ts`; import de `mutacion.js` en
  `deuda.ts`). Los 424 tests que censan `qa/guiones/` pasan con él presente. **El número se cerró en 158**
  al rebasar sobre `main` = `243fcf9f` (que ya trae hasta el 154), por decisión del coordinador
  con las tandas en vuelo delante: #680 dice que el número se elige al fusionar, no al escribir.

  > **Corrección del INGENIERO: el guion se ponía ROJO al commitearlo, y por su propia prosa.**
  > Su bloque C casaba los imports con una expresión regular sobre el TEXTO de cada fichero de
  > `git ls-files`. En el worktree de QA estaba sin trackear, así que la lista no lo incluía y
  > salía verde; en cuanto entró al índice, el censo leyó **su propia cabecera** —que citaba la
  > sentencia del sabotaje entre comillas— y se acusó a sí mismo:
  > `✘ C · … — qa/guiones/158-…mjs:37 import "./mutacion.js"`. Es exactamente el modo de fallo
  > que esta casa ya tiene escrito («un censo textual es ciego a la escritura», y aquí además
  > MENTIROSO en la otra dirección: no distingue una prosa de una sentencia).
  > **Arreglado contando NODOS del árbol**, con el mismo TypeScript que ya cargaba el bloque A:
  > `import … from`, `import "…"`, `export … from`, `import()` y `require()`. La grafía se queda
  > como criba barata para no parsear 700 ficheros (hoy parsea 37 de 716), nunca como veredicto, y
  > un fuente que no parsee se dice en voz alta con un aserto propio en vez de contarse como «no
  > importa nada». **Probado en las DOS direcciones**, un sabotaje por vez sobre `scripts/deuda.ts`
  > y restaurado: el literal dentro de un COMENTARIO → **verde** (con el censo textual era rojo);
  > una sentencia de import DE VERDAD → **rojo** nombrando `nefan-core/scripts/deuda.ts:517 → ./mutacion.js`.
  > Los seis headless en verde en 6,9 s.
- Fila del 158 en `qa/README.md`. El párrafo de los headless lo había actualizado QA a mano
  («cinco, no tres»), y al rebasar sobre `main` = `243fcf9f` **esa frase se cae**: #683 (tanda U)
  retiró la cuenta entera del README con el motivo escrito —«la cifra que hubo mentía a las
  24 h»— y remite a `node qa/run.mjs --sin-navegador`, que los enumera. Gana `main`: un número a
  mano en prosa es justo lo que esta casa no quiere. Resuelto así en el rebase.
- Sin tocar: código de producción, contratos, workflows.

## Veredicto

**Apto con reservas.** El corte es un movimiento byte a byte (68/69 declaraciones, la 69 es el
guardia), los diez verbos se comportan igual donde se pudo medir, los candados repuntados se ponen
rojos por su razón y `verify` está verde. Las reservas son menores y no bloquean: el rastro en
`arch-rules.json:992` (retirada no entera, hallazgo 1), el comentario de `ci.yml:291` (declarado), el
export huérfano y el issue del `veces === 1` del guion de lotes. Y la condición de orden que ya
está escrita en el commit: fusionar DESPUÉS de repartir la corrida de la tanda T, o aceptar que
#605 salga co-candidata de todo superviviente nuevo.

## Estado al entregar (la corrida del duplicado seguía en marcha) — CERRADO por el ingeniero

> Lo de abajo era el estado en el momento de entregar QA. **Ya está todo hecho**: la corrida
> terminó en `exit=1` por la cadena que explica el matiz del hallazgo 4, `mutacion-lotes.ts` está
> restaurado, `reports.qa-lotes/` no existe y `reports/` tiene `mutation` (37), `mutation-base`
> (60) y `mutacion-tiempos.json`. Se deja el texto original porque dice qué había que comprobar y
> con qué criterio, que es justo lo que hizo falta para leer el rojo.

El coordinador me pidió el informe antes de que terminara la corrida completa de
`qa/mutacion-reparto-en-lotes.mjs` con el duplicado sintético. Estado en el momento de entregar:

- Corre DESVINCULADA (`setsid nohup`, lanzador pid 410337), log en
  `/tmp/claude-1000/-home-al-code-ne-fan/c1c2b31e-b063-4d4b-a2a2-c73bbf74231b/scratchpad/lotes-duplicado.log`
  (termina con una línea `exit=N`). Tiene tomado el turno `rompe-fuentes`: **no lanzar el cableado
  ni otro candado que rompa fuentes hasta que salga `exit=`**.
- `nefan-core/scripts/mutacion-lotes.ts` lleva UNA línea de más (el comentario `//    const errores =
  verificaDescarga(parcial, presentes);` en la 288). El guion la conserva porque está en su foto de
  `fuentes`. **Cuando el log tenga `exit=`**: `git checkout -- nefan-core/scripts/mutacion-lotes.ts`
  y comprobar que `nefan-core/reports.qa-lotes/` NO existe y `reports/` tiene `mutation` (37),
  `mutation-base` (60) y `mutacion-tiempos.json`.
- Cómo leer el resultado: si la línea `✔ fusión · \`fusionar\` deja de verificar el SELLO …` sale con
  «lo caza: cableado» y el guion acaba verde (`exit=0`) con el patrón DUPLICADO en el fichero, queda
  demostrado que el guion no exige `veces === 1` (el de cableado habría dicho «patrón obsoleto: aparece
  2 veces»). Si en cambio saliera «PROBE OBSOLETO» o rojo, mi lectura del código (`:657-667`, `includes`
  + `replace`) estaría equivocada y hay que rehacer el hallazgo 4. No lo doy por medido: la lectura del
  código es firme; la corrida es la confirmación que se pidió y queda en el log.
