# REENCUADRADA

El defecto está **vivo** —incluido el guion que el issue nombra, verbatim a HEAD— pero el issue describe mal
su tamaño, mal su sujeto, y señala un mecanismo que en este repositorio **no se puede construir**.

## El problema real, en una frase

Cuando un guion descubre que **no ha podido medir** algo, tragarse la espera y seguir es gratis mientras que
la salida honesta (`ctx.sinMedir`, desde el 31-ago) hay que escribirla, así que la batería declara verdes que
no midieron nada — y el `waitFor` agotado es **una de cinco vías** de llegar ahí, no el invariante.

## La premisa, afirmación por afirmación

| Afirmación | Verificación a HEAD `92d232c` |
|---|---|
| «26 `.catch()` sobre esperas en 20 guiones» | **89 reales** (91 hits − 2 de prosa del guion 36), en 32 guiones. Clasificados uno a uno: **55 MATA · 27 NO MATA · 7 no son esperas** |
| «**el 15 es el único**» | **Falso, y por 27**. De los ocho que el issue declaró sanos, 7 lo son (líneas movidas: 19:245, 20:301); **`11:73` no**, y es el peor caso del repo |
| Candidato del issue: «que el helper **lance** en vez de degradar» | **Ya era cierto el día que se abrió.** `waitFor` lanza desde el 2026-08-20 (`git show 1f4e99d:qa/run.mjs:342`), hoy `qa/lib/sonda.mjs:64`. Y **ningún** helper de `qa/lib` traga un timeout: `sesion.mjs:417-419` relanza, `saves.mjs:109` lanza, `fixtures.mjs:106,125` acumula. Ese candidato está hecho y no arregla nada |
| «#247 ya arregló el guion 15» (lo dice `requisitos.md`, no el issue) | **Falso.** PR #290 sacó al `barkeep` del `mostrador`: arregló la *intermitencia*. `atacarYVer` sigue verbatim desde su nacimiento — `15:200` traga el timeout y `15:201` remide. El ejemplo del issue sobrevivió a su cierre |
| El sujeto es «el `.catch()` sobre esperas» | **Insuficiente.** Cinco de los peores casos no llevan `.catch(`: `42:412`, `49:307`, `49:310`, `49:321`, `49:326` son `if (…) { ctx.log("⚠ … no se midió"); return; }` |

**Y la premisa que el issue no escribió**: el defecto **se acelera**. Los guiones 41/42 (30-ago) y 48/49/50
(31-ago) nacieron después del issue y aportan **14 de los 27** casos vivos; en los tres últimos, 10 de sus 18
catches son NO MATA.

## El censo: 27 casos vivos en cinco familias — solo tres son defecto

D y E son legítimas y un candado que las ponga rojas nace mal; distinguirlas es lo que un patrón sintáctico
no sabe hacer.

**A · El hueco entre el umbral de la espera y el del aserto.** La espera pide más que el `expect`: queda una
banda garantizada de «timeout + verde». Seis sitios, misma firma — `15:200` (espera 1,5 m; `:305`/`:376`
piden 1 m y `:381` **ninguno**) · `15:114` (±1,5 sobre 8; `:366` admite 3-16) · `25:157` (2 vs 1,5) ·
`25:217` (0,5 vs 0,4) · `17:266` (2 vs 1,5) · `41:129` (1,6 vs 2,6). `15:200` es el caso del issue, intacto.

**B · La espera cuya expiración no observa nadie.** `50:79` (90 s, sin variable ni consumidor; un `waitFor`
idéntico y **sin** catch está en `:77`, sin razón escrita para la diferencia) · `11:73` · `48:239` · `49:233`
· `49:294` · `10:523`. **`11:73` es el hallazgo más caro**: `holdUntil(key, desc, …)` recibe `"el jugador se
mueve"` en **las dos** posiciones (`11:64-65`), así que `press()` escribe `state["el jugador se mueve"]`,
nunca `state.up` (`scripted-input-provider.ts:35-37`). La condición es **imposible**: quema 15 s por corrida
desde el 21-ago (`94b8522`), «y andar un poco» no ha cubierto nunca nada, y sale verde — el «sleep con
mejores modales» del issue, más puro que su ejemplo.

**C · El `if` que salta el bloque y lo cuenta en el log** — el ⊘ sin declarar. `42:457` (la rama `else` de
`:469` dice «la mitad del ledger **no se pudo medir** en esta corrida» y sigue verde) · `49:138` (se salta
los **tres** asertos del bloque 3, el que anuncia su cabecera) · `49:283`, más los cinco hermanos sin
`catch`. Con justificación escrita y refutable: `49:319-321` evita `sinMedir` porque «un ⊘ lo taparía», y
`run.mjs:886-893` ya lo impide — con fallos empujados el ⊘ se queda **rojo**. Un malentendido del canal.

**D · El timeout ES el éxito** (negativos deliberados, **no tocar**): `02:60`, `30:149`, `06:71`@`:144`,
`45:75`@`:232`. · **E · Cortafuegos por tramo de un bucle que remide** (de diseño): `41:475`, `42:145`,
`48:140`, `49:103`, `50:66`.

## El día después

- **Para quien juega**, nada directo: es deuda del instrumento con el que se aceptan las seis tandas de esta
  serie, que se mide en issues cerrados. No mantiene vivo nada tirable; al contrario, mantiene vivo `11:73`.
- **Escribir un guion se encarece**: `.catch(() => null)` es hoy el gesto reflejo (89 veces), y con 50
  guiones y una batería que **el CI no corre**, elegir cada vez lo paga una persona a mano.
- **Quedará sin borrar** la versión-prosa del canal (los `ctx.log("⚠ … no se midió")` de B y C), y **parecerá
  arbitrario** que D y E sean legales y A/B/C no: eso va escrito EN el candado, no en el plan.

## Conflictos

- **Con el mecanismo que pide el issue**: `arch-rules.json` solo sabe regex sobre texto y sobre imports
  (`nefan-core/src/contract/arch/check.ts:55,151,168`), así que una regla ahí **solo puede perseguir una
  forma sintáctica** — lo que el punto 3 de `requisitos.md` prohíbe y lo que el issue critica del candado
  actual. Los puntos 2 y 3 se contradicen mientras sea una arch-rule: tiene que ser de **runtime**, donde la
  expiración es un hecho y D y E se distinguen.
- **`qa-guiones-sin-espera-por-reloj` no se toca** (caza el sleep literal, y bien) y **el canal ⊘** no choca:
  «¿rojo o ⊘?» ya lo contestan `qa/lib/veredictos.mjs` y `run.mjs:886-893`. **`esperarPuertoArriba` es el
  patrón a generalizar** (`puertos.mjs:67-71` lanza por timeout **y** por muerte del proceso).
- **Cola de issues**: ninguno. #287 y #331 cerrados; nada abierto toca `qa/`.

## Coste contra valor

Vale la pena con el alcance recortado: **no son 89 catches, son 27, y solo 16 son defecto**. Compra que dos
bloques de los guiones más nuevos (42 y 49) dejen de mentir y que `11:73` deje de quemar 15 s cubriendo nada.
Lo que **no** vale es el issue tal cual: perseguir «el `.catch()` sobre una espera» con una regla de texto
gastaría la tanda y dejaría fuera los cinco peores casos, que no llevan `catch`.

## Qué le cambiaría a `requisitos.md`

Sustituir «Lo que esta tanda tiene que dejar cierto» por esto, listo para pegar:

> 1. **El invariante no es el timeout, es la no-medida**: un guion que no ha podido medir un bloque no
>    termina verde — o rojo, o `⊘` con motivo.
> 2. **El candado es de RUNTIME, no una arch-rule** (el motor solo hace regex,
>    `src/contract/arch/check.ts:55,151,168`): vive donde la expiración es un HECHO —runner/sonda— y se prueba
>    en negativo en `qa/bateria-candados-en-negativo.mjs`, o en `npm test` con el precedente de import cruzado
>    de `nefan-core/test/veredictos.test.ts`.
> 3. **Cinco familias, se arreglan tres.** A (hueco umbral-espera vs umbral-aserto), B (expiración que nadie
>    observa) y C (`if` que salta el bloque y lo loguea) son defecto; D (`02:60`, `30:149`, `06:71`, `45:75`)
>    y E (`41:475`, `42:145`, `48:140`, `49:103`, `50:66`) son legales y el candado no puede ponerlas rojas,
>    con el porqué escrito EN el candado.
> 4. **Criterio que nace rojo sobre estos 16** — A: `15:200`, `15:114`, `25:157`, `25:217`, `17:266`,
>    `41:129`. B: `11:73`, `50:79`, `48:239`, `49:233`, `49:294`. C: `42:457`, `49:138`, `49:283`, y sin
>    `catch`: `42:412`, `49:307`/`:310`/`:321`/`:326`.
> 5. **`11:73` se arregla pase lo que pase** (recibe la descripción como tecla, `11:64-65`), y **rojo-vs-⊘ no
>    se decide**: `run.mjs:886-893` ya lo hizo — `49:321` lo evita por malentenderlo.
> 6. `waitFor` sigue legal, `qa-guiones-sin-espera-por-reloj` no se toca, y el `why` del candado nuevo cuenta
>    el censo de hoy (89: 55 matan, 27 no, 7 no son esperas), no el de agosto.
