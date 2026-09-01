# Tanda 6 — Un timeout agotado no puede decidir un veredicto en verde (#261)

## Petición del usuario (literal)

> «Sigue con la tanda 6. La ejecucion de la mutacion lleva 15 horas en github, puede que este colgada»

Y la intención permanente que ordena toda esta serie, también literal:

> «Vamos a seguir priorizando reducir el numero de issues»

La «tanda 6» es la sexta y última entrada de la hoja de ruta aprobada por el usuario el
2026-08-30 tras el triaje crítico de los 32 issues abiertos. Su texto, literal, en el plan
aprobado:

> **#261** — tras la 2, con el canal `⊘` disponible y el censo honesto (44 `.catch(() => null)`).

Las cinco tandas anteriores están mergeadas (#338, #342, #345, #348, #349, #353). Las dos
condiciones que el plan ponía a esta tanda **se cumplen hoy**: la tanda 2 cerró #331 y #332, y
el canal `⊘` existe (`ctx.sinMedir(motivo)` en `qa/run.mjs:699`).

## El issue, tal como está escrito

**#261 — «El candado que prohíbe esperar por reloj está verde sobre la espera por reloj de #247»**
(abierto el 2026-08-25, cuarto caso del patrón, encontrado por el crítico mientras medía #247).

Su tesis, en sus palabras:

> `qa-guiones-sin-espera-por-reloj` … existe para que ningún guion de QA decida su veredicto por
> un reloj de pared. Está **verde sobre `qa/guiones/15-…mjs`**, que es exactamente el guion que
> #247 documenta como una moneda al aire.
>
> **Por qué no lo ve**: su patrón caza `waitForTimeout(` y `new Promise(setTimeout)` — el sleep
> literal. Pero un `waitFor` **cuya condición no se cumple nunca** es un sleep con mejores
> modales: espera su timeout entero y sigue.
>
> **Lo que NO es este issue**: arreglar el guion 15 (eso es #247), ni prohibir `waitFor` (es la
> herramienta correcta).
>
> **Lo que sí**: que un `waitFor` cuyo timeout se agota **no pueda decidir un veredicto en
> verde**.

Y su censo, que es lo que hay que verificar antes de diseñar nada:

> El crítico revisó los 26 `.catch()` sobre esperas de los 20 guiones y en los otros ocho casos
> (08:79, 08:135, 09:191, 07:256, 11:73, 12:245, 19:254, 20:248) el timeout degrada a `null` y el
> `expect` siguiente se pone rojo. **El 15 es el único**, así que no hay una lista que arreglar:
> hay un invariante que expresar.

Candidatos que el propio issue enumera, sin elegir: que el helper de espera lance en vez de
degradar; que el degradado tenga que ser explícito en el sitio; o una regla que exija que todo
`.catch()` sobre una espera produzca un valor que el `expect` de después no pueda tragar.
**«Elegir es parte del trabajo.»**

## Estado medido hoy (2026-09-01, HEAD `92d232c`)

Todo lo que sigue está medido en este commit, no heredado del cuerpo del issue.

| Afirmación del issue | Medida de hoy |
|---|---|
| «26 `.catch()` sobre esperas en 20 guiones» | **89 reales** en 32 guiones (91 hits − 2 de prosa del guion 36). Clasificados uno a uno por el crítico: **55 MATAN · 27 NO MATAN · 7 no son esperas** |
| «44 son literalmente `.catch(() => null)`» (dato del triaje del 30-ago) | **63** literales `.catch(() => null)` en el árbol `qa/` |
| «el 15 es el único» | **falso, y por 27** (medido por el crítico). Y la frase «#247 ya arregló el guion 15» que yo escribí aquí **también era falsa**: la PR #290 sacó al `barkeep` del `mostrador` —arregló la intermitencia— y `atacarYVer` sigue **verbatim** desde su nacimiento. El ejemplo del issue sobrevivió al cierre de su vecino |
| el patrón de la regla | `waitForTimeout\s*\(|new Promise\s*\(.{0,40}?setTimeout\s*\(` (`arch-rules.json:463`), severidad `error` |

Los guiones que más `.catch(` acumulan hoy: 41 (9), 49 (8), 42 (8), 29 (7), 48 (6), 15 (5).
Los tres últimos guiones de la tanda 5 (48, 49, 50) son **22 catches nuevos** escritos después de
que se abriera este issue: si el invariante existe, ellos también lo tienen que cumplir.

Dependencias del issue, comprobadas: **#247 cerrado**, **#331 cerrado**, **#332 cerrado**. El
canal `⊘` está disponible y su semántica ya está decidida y candada (`qa/run.mjs:691`): *«el ⊘
degrada la corrida a exit 2, MÁS que el rojo (exit 1) — reconvertir un rojo en ⊘ empeora el
resultado»*, y un guion que declara `sinMedir` con fallos ya empujados es **rojo**, no `⊘`.

## Lo que esta tanda tiene que dejar cierto

**Reescrito el 2026-09-01 tras la crítica** (veredicto REENCUADRADA, `critica.md`). Lo que había
aquí antes perseguía el sujeto equivocado y pedía un mecanismo que este repositorio no puede
construir; los seis puntos que siguen son los del crítico, con su medida detrás.

1. **El invariante no es el timeout, es la no-medida**: un guion que no ha podido medir un bloque
   no termina verde — o rojo, o `⊘` con motivo. Tragarse la espera es gratis; `ctx.sinMedir` hay
   que escribirlo, y esa asimetría es el defecto.
2. **El candado es de RUNTIME, no una arch-rule.** El motor de `arch-rules.json` solo sabe regex
   sobre texto e imports (`nefan-core/src/contract/arch/check.ts:55,151,168`), así que una regla
   ahí solo puede perseguir una **forma sintáctica** — exactamente lo que el issue critica del
   candado actual. Vive donde la expiración es un HECHO (runner/sonda) y se prueba en negativo en
   `qa/bateria-candados-en-negativo.mjs`, o en `npm test` con el precedente de import cruzado de
   `nefan-core/test/veredictos.test.ts`.
3. **Cinco familias, se arreglan tres.** A (hueco entre el umbral de la espera y el del aserto),
   B (expiración que no observa nadie) y C (`if` que salta el bloque y lo cuenta en el log) son
   defecto; **D** (el timeout ES el éxito: `02:60`, `30:149`, `06:71`, `45:75`) y **E**
   (cortafuegos por tramo de un bucle que remide: `41:475`, `42:145`, `48:140`, `49:103`,
   `50:66`) son legales y el candado **no puede ponerlas rojas**. El porqué va escrito EN el
   candado, no en el plan: sin eso parecerá arbitrario.
4. **Criterio que nace rojo sobre estos 16 sitios** — A: `15:200`, `15:114`, `25:157`, `25:217`,
   `17:266`, `41:129`. B: `11:73`, `50:79`, `48:239`, `49:233`, `49:294`. C: `42:457`, `49:138`,
   `49:283`, y sin `catch`: `42:412`, `49:307`/`:310`/`:321`/`:326`.
5. **`11:73` se arregla pase lo que pase**: `holdUntil(key, desc, …)` recibe `"el jugador se
   mueve"` en las dos posiciones (`11:64-65`), así que `press()` escribe
   `state["el jugador se mueve"]` y nunca `state.up`. La condición es **imposible**: quema 15 s
   por corrida desde el 21-ago y sale verde. Y **rojo-vs-⊘ no se decide en esta tanda**:
   `run.mjs:886-893` ya lo decidió — con fallos empujados, el ⊘ se queda rojo. `49:321` lo evita
   por malentenderlo, y eso es lo que hay que corregir.
6. `waitFor` sigue legal, **`qa-guiones-sin-espera-por-reloj` no se toca** (caza el sleep
   literal, y lo hace bien), y el `why` del candado nuevo cuenta el censo de HOY (89: 55 matan,
   27 no, 7 no son esperas), no el de agosto.

## Restricciones

- **Cero créditos**: todo con `fake-ai-server` / preset `e2e-sin-creditos`.
- **No matar servidores ajenos**: hay otras instancias de Claude trabajando en esta máquina.
  `pkill vite`/`node` PROHIBIDO; matar por puerto lo que no arrancaste, prohibido. Bloque de
  puertos libre vía `NEFAN_PORT_OFFSET`; `./start.sh --parar` para solo lo de este worktree.
- **El CI no corre la batería de `qa/`**: cualquier cifra de guiones es una corrida local y así
  hay que decirlo en el cuerpo de la PR.
- Doctrina de pre-producción: lo que se sustituye se borra el mismo día, entero.

## Preguntas abiertas — contestadas por la crítica

- **¿Sigue vivo el defecto?** Sí, y su propio ejemplo también: `15:200` está verbatim a HEAD.
- **¿El sujeto es el `.catch()` o la espera?** Ninguno de los dos. Ningún helper de `qa/lib` se
  traga un timeout (`sesion.mjs:417-419` relanza, `saves.mjs:109` lanza, `sonda.mjs:64` lanza), y
  el candidato del issue —«que el helper lance en vez de degradar»— **ya era cierto el día que se
  abrió** (`waitFor` lanza desde el 2026-08-20). El sujeto es el **sitio de llamada**. Y cinco de
  los peores casos **no llevan `.catch(`**: son `if (…) { ctx.log("⚠ … no se midió"); return; }`.
- **¿Choca con el canal `⊘`?** No: está decidido y candado. Lo que hay es un malentendido a
  corregir en `49:319-321`.
- **¿`esperarPuertoArriba` es el patrón?** Sí, es el que hay que generalizar: falla por timeout
  **y** por muerte del proceso (`puertos.mjs:67-71`).

## Lo que NO entra

- Prohibir `waitFor` (explícitamente fuera, según el propio issue).
- Reescribir los guiones por gusto: solo los catches que puedan decidir en verde.
- Tocar el guion 15 por #247 (cerrado).

## Decisión del usuario (2026-09-01, tras la crítica)

Presentado el veredicto REENCUADRADA con sus tres premisas rotas, el conflicto del mecanismo y
el alcance recortado (16 sitios de 89), el usuario eligió, entre tres opciones:

> **El reencuadre completo**

Es decir: candado de **runtime** que impida terminar verde sin haber medido, probado en negativo;
los **16 sitios** de las familias A/B/C arreglados —incluido `11:73`, que lleva desde el 21 de
agosto quemando 15 s por corrida sin cubrir nada—; y D y E declaradas **legales** con el porqué
escrito EN el candado, no en el plan.

Las dos alternativas descartadas y por qué se ofrecieron: «solo los defectos, sin candado» es más
barato pero no impide que el próximo guion vuelva a tragarse una espera —y las tandas 4 y 5
acaban de demostrar que pasa, con 14 casos nuevos—; «solo el candado, sin tocar guiones» nacería
con 16 exenciones, que es el sitio exacto donde un candado se muere callado.
