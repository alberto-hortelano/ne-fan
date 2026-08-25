# #230 REENCUADRADA · #231 REENCUADRADA (es dos tareas, no una)

Medido sobre `main` (`14ea7e2`) en un worktree limpio. No se tocó el árbol de trabajo.

# #230 — el selector ante `arch-rules.json`

**Problema real:** no es «el selector se rinde ante un fichero de datos»; es que un fichero que **sí** es instrumento de medida, pero solo por **una** de sus reglas, se evalúa **entero** — y por eso un commit que añade una regla de fronteras paga los 6.962 mutantes.

## La premisa

- «7 de 11 van a corrida completa» → **no reproduce: 5 de 11** (`14ea7e2`, `146cc7f`, `cf7b446`, `7f7e417`, `49bf7d0`).
- «en 5 la causa es `arch-rules.json`» → **no reproduce: es causa única en 2** (`146cc7f`, `cf7b446`).
- «ninguna batería lo importa; lo leen los tests con `readFileSync`» → **FALSO, y es lo que manda.**
  `scripts/mutation-plan.ts:183` lo lee para derivar el **perímetro de mutación** de la regla
  `core-puro-sin-node` (`REGLA_PERIMETRO`, `mutation-plan.ts:204`).
- «un dato no está en el grafo, así que se rinde» → **no es lo que pasa.** Nunca entra por la vía `dato`:
  está a mano en `TOOLING` (`scripts/afectado.ts:61`), y esa clasificación es **correcta y portante**.

Probé la hipótesis «está mal clasificado» y **la falsé**: como el perímetro sale de ahí, tratarlo como instrumento es acertado. Lo que falla es la **granularidad**. `146cc7f` añadió `cadena-de-migracion-unica`; `cf7b446` añadió `qa-guiones-sin-espera-por-reloj`, con `files: qa/guiones/**/*.mjs` — no puede alterar el perímetro de nefan-core ni en teoría. **Ninguno de los dos tocó `core-puro-sin-node`.** La dependencia es por regla; la evaluación es por fichero. Ese es el peaje.

## El número que decide

Contrafactual (mismo diff, sin el fichero que fuerza todo): `146cc7f` 17/17 → **6/17**; `cf7b446` 17/17 → **6/17**; `7f7e417` (causa única `tile_instructions.md`) 17/17 → **13/17**. `14ea7e2` y `49bf7d0` tocan `scripts/` y van a completa igual: fuera de alcance.

La mitad **cara** del issue (trazar `fs` vs declarar, «una tanda con su propia verificación») ataca el dato genuino: **1 commit de 11, ahorro 4 de 17 módulos**, porque el diff ya arrastra 13 por sus fuentes. La mitad **barata** (granularidad por regla, decidible **leyendo** el fichero, sin instrumentar nada): **2 de 11, ahorro 11 de 17 cada vez**. El peaje que encontraron los dos agentes cae entero en la barata.

## El día después, conflictos y coste

Para quien juega, nada: es deuda de herramienta, declarada. Si se traza, el mapa persistido es una segunda fuente de verdad sobre lo que los tests leen, con candado de frescura, fallo **mudo** —el que cerró la PR #229— y mantenimiento perpetuo a cambio de 4 módulos en un commit de cada once; y es además lo que nadie borrará el día que cambie el reparto. En un mes parecerá arbitrario que una regla sobre `.mjs` de QA dispare 6.962 mutantes de nefan-core.

- **Criterio no negociable de #229** (nunca selección corta y silenciosa): por-regla es compatible (si la regla
  del perímetro cambió, o el fichero no se parsea → todo, y se dice). **Trazar no lo es**, y el issue lo admite.
- **`mutation-targets.json`**: `architecture.test.ts` está en `sin_mutar` porque «escanea el árbol ENTERO y
  necesita una batería propia más barata (tanda B)». No bloquea, pero está en el camino.
- Sin contradicción con `CLAUDE.md` ni con la cola abierta.

Vale la pena **acotado**: si no se hace, añadir una regla de fronteras sigue costando la corrida completa, lo que empuja a no añadir reglas — lo contrario de lo que esta casa quiere. El trazado **no lo pagaría hoy**.

## Qué cambiarle a `requisitos.md`

> **Alcance #230:** llevar la evaluación de `data/contract/arch-rules.json` de por-fichero a **por-regla**. La dependencia real es `core-puro-sin-node` (`scripts/mutation-plan.ts:183,204`), de la que sale el perímetro; el resto de reglas no puede cambiar qué se muta. Medido sobre los 11 últimos commits de `main`: 5 van a completa y en 2 (`146cc7f`, `cf7b446`) la causa única es este fichero, ninguno tocando la regla del perímetro; el contrafactual baja de 17/17 a **6/17**.
> **Fuera de alcance:** trazar lecturas de `fs` y persistir el mapa. El único commit de los once con causa única de dato genuino (`7f7e417`) solo bajaría a **13/17**, y el mecanismo falla mudo: no compra lo que cuesta.
> **No se negocia (#229):** ante la duda, ejecutar de más y decirlo.

# #231 — tipos en `scripts/` y `test/`

**Problema real:** no es «faltan dos árboles en el `tsconfig`»; es que **hay aserciones en `test/` que no se ejecutan y nadie se entera**, y el `include` es el síntoma por el que no se ven.

## La medida, ejecutada

`tsc --noEmit` sobre `main`, mismas `compilerOptions` salvo `noEmit`: `src`+`bridge`+`services` (lo que el CI ya mira) **0 errores** — línea base sana; **`scripts/` 0**; **`test/` 59, en 21 ficheros**.

El criterio del issue («cero → una línea; cuarenta → una tanda») **parte en dos**: `scripts/` —donde vivía `r.rule.message`— es la línea de config. `test/` es la tanda. De los 59: **6** se van con `lib: ES2023` (`findLast` + cascada TS7006); **2** son el `rootDir`/módulo de `narrative-mcp/validators.ts`; quedan **~51 reales**. Focos: `volume-metrics.test.ts` (12) y `fps-ambience.test.ts` (7), literales de fixture que ya no casan con el tipo que alimentan.

## El hallazgo que cambia el valor

`test/service-registry.test.ts:22` — `if (SERVICES[name].extractionPhase !== undefined)` para `gpu-worker`, `asset-store`, `remote-gen`. Ninguna de las tres declara `extractionPhase` (`src/contracts/service-registry.ts`, `as const satisfies`): la condición es **siempre falsa** y sus tres aserciones **no se ejecutan nunca**. Y si se ejecutaran **fallarían**: comparan `currentPort` (8766/8767/8768) contra `CONFIG.ai_server.port` = **8765**.

Un test verde que no comprueba nada, protegiendo una creencia caducada (los servicios ya están extraídos). Segunda aparición del modo de fallo de `r.rule.message`, ahora en `test/`. Eso saca #231 de «higiene de tipos» y lo mete en «el gate encuentra tests muertos». De propina, carencia de producción: `player.inventory` se infiere `never[]` (`narrative-state.test.ts:115`).

## El día después, conflictos y coste

Para quien juega nada directo; indirecto sí: son aserciones que se creían tener. Meter 53 en verde de golpe invita a `as any`/`@ts-expect-error`, que cambia un fallo mudo por otro; y `composite`/`declaration`/`outDir` no admiten `test/` dentro sin más — la línea base de 0 en `src+bridge+services` hay que conservarla. **Conflicto vivo:** un ingeniero está modificando `test/` en `feat/contrato-entity-npc`, así que los 59 son blanco móvil; eso **ordena la tanda, no la cancela**. `scripts/` es gratis y cierra el agujero original — hacerlo YA; los 51 de `test/` valen su coste **solo** si el arreglo es arreglar los tests, y si no se hace nunca seguirán apareciendo aserciones muertas invisibles.

## Qué cambiarle a `requisitos.md`

> **#231 son dos tareas, y se ejecutan por separado.**
> **(a) Ahora, una línea de config:** añadir `scripts/**/*.ts` al `include` que comprueba el CI. Medido sobre `main`: **0 errores**. Cierra el agujero por el que pasó `r.rule.message`, sin deuda que pagar y sin tocar el árbol del ingeniero en vuelo.
> **(b) Después, una tanda:** `test/` da **59 errores en 21 ficheros** sobre `main`; 6 se van con `lib: ES2023`, 2 son el `rootDir` de `narrative-mcp/validators.ts`, quedan ~51 reales. **Bloqueada hasta que aterrice `feat/contrato-entity-npc`.**
> **El arreglo es arreglar el test, nunca silenciarlo.** Caso testigo confirmado: `test/service-registry.test.ts:22` es una rama que **no se ejecuta nunca** y cuyas tres aserciones **fallarían** si se ejecutara (8766/8767/8768 contra 8765). Ese es el valor de la tarea; los otros 50 se miran con la misma sospecha.
> **Criterio corregido:** «un error de tipos en `scripts/` pone el CI rojo» se cumple en (a). Para `test/` solo es exigible al cerrar (b) — no se acepta un baseline de errores tolerados, que reproduciría el problema con otro nombre.
> 