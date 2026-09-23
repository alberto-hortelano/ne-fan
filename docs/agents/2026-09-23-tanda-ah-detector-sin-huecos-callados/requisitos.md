# Requisitos — tanda AH: el detector de saltos declara o cierra N1-N3 (#716)

## Petición literal del usuario

> «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

El coordinador eligió este issue para la tanda. Sesión AUTÓNOMA: el usuario no está para dar visto bueno a mitad del ciclo; lo que haya que preguntarle se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## El issue, verbatim (cuerpo + comentarios, descargado hoy de GitHub)

### #716

> El detector de saltos no declara tres formas que escapan: helper que afirma true, !!true, IIFE con ctx renombrado
> 
> Tres formas que el detector de saltos de #356 (PR #715) deja pasar en verde y que `_lo_que_esto_NO_sujeta` de `saltos-sin-observar.json` **no declara todavía**. Las encontró QA en la vuelta 2 con el arnés `adv4.ts`; **ninguna tiene ocupantes hoy en el banco**, por eso no se bloqueó la PR.
> 
> - **N1** — un helper «asertador» que solo afirma `true`, o que afirma bajo condición, excusa la rama que lo llama.
> - **N2** — `!!true` y `expectEspera(() => true)` cuentan como observadores (el filtro de `expect` tautológico mira la forma literal, no estas dos).
> - **N3** — un IIFE que recibe `ctx` con otro nombre no lo ve ni la medida del punto (1).
> 
> Qué cierra este issue: cada una, o cerrada en el detector con su negativo, o declarada en `_lo_que_esto_NO_sujeta` (QA sugiere los puntos 9, 11 y 1) **con un `it` que mida su cifra de hoy** — no una línea en prosa.
> 
> Fuera: N4 (llamada con `ctx` no resuelta cuenta como aserto) es un falso rojo en la dirección segura; no se toca. Detalle en `docs/agents/2026-09-23-tanda-ag-ctx-bloque/qa.md` §«Vuelta 2».
> 

## Criterios de aceptación

1. Cada una de N1, N2 y N3 queda en UNO de dos estados, elegido con criterio y escrito: (a) cerrada en el detector, con un negativo que hoy saldría verde y tras el cambio sale rojo; o (b) declarada en `_lo_que_esto_NO_sujeta` de `saltos-sin-observar.json` con un `it` que MIDA su cifra de hoy (no una línea en prosa).
2. N4 no se toca (falso rojo en la dirección segura).
3. `npm test` y `npm run verify` verdes; el padrón no crece salvo con motivo.
4. Ninguna rama del banco que hoy sale observada pasa a no observada sin enumerarse.

## Contexto del coordinador

- Worktree: `/home/al/code/ne-fan-tanda-ah`, rama `feature/tanda-ah`, nacida de `main` = `83ea6046`. Todo el trabajo va en ese árbol, nunca en `/home/al/code/ne-fan`.
- Hay OTRAS cinco tandas en paralelo en worktrees hermanos (`ne-fan-tanda-{ah,ai,ak,al,am,an}`): #716 detector de saltos, #714 resume con tiles en clay, #709 ruff local, #704 un solo barrido del banco, #700 buscar con veces===1, #697 describe que lanza. Si esta tanda toca un fichero que otra también tocará con probabilidad (p. ej. `nefan-core/test/banco-ficheros.ts`, `package.json`, `ci.yml`), dilo en tu documento.
- Si hay que levantar un stack (qa/run.mjs), NUNCA matar procesos ajenos; `qa/run.mjs` elige bloque libre solo.
- Nada de gasto de créditos de imagen: preset `e2e-sin-creditos` / motor falso.
- Mutación: `npm run mutacion -- local <id>` si cabe en el tope; si no, se pide y no se espera.
- Commits intermedios en la rama (hubo límites de sesión que mataron agentes con trabajo sin commitear).

## Fuera de alcance

- Lo que el propio issue declara fuera.
- Issues vecinos que aparezcan: se ANOTAN (propuesta de issue nuevo en el documento), no se arreglan.

## Reencuadre del crítico, aceptado por el coordinador (2026-09-23, sesión autónoma: no cambia QUÉ se construye)

Lo que sigue (copiado de critica.md) PREVALECE sobre los criterios de arriba donde choquen.


```
5. N2 se entiende con la firma real, `expectEspera(desc, debeOcurrir, probeFn, …)` (qa/run.mjs:1106). La forma del issue, `expectEspera("x", () => true)`, NO es un falso verde en el banco: la sonda sale rota y el guion ✘ «NO SE MIDIÓ». Lo que escapa es el predicado tautológico en el TERCER argumento con la polaridad que lo hace inocuo: `(d, true, () => true)` y `(d, false, () => false)`. El negativo (o la medida) usa esas formas, no la del issue.
6. N1 tiene dos mitades que se deciden por separado: el asertador TAUTOLÓGICO (solo `expect(…, true)` o equivalentes de `esTautologia`) y el asertador CONDICIONAL (afirma bajo un `if`). La segunda no se cierra en el detector sin enumerar antes qué saltos del banco real cambian de estado. Si cambia alguno, se declara en vez de cerrarse.
7. El `it` «LÍMITE MEDIDO (12)» ya dice «o con otro nombre de parámetro» sin un caso que lo mida: o se añade el caso (el IIFE `(async (c) => {…})(ctx)` de N3), o se quita la frase del título. N3 va a (1) o a (12), no a un punto nuevo.
8. No se tocan `test/helpers-del-banco.ts` ni `test/banco-ficheros.ts` (los reescribe #704 en la tanda hermana).
```
