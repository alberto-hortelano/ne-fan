# Crítica — tanda U (#680 + #683)

**REENCUADRADA.** #680 está VIGENTE tal cual (premisa verificada línea a línea). #683 cambia de forma
por dos hechos: el sondeo de #609 que el criterio 3 manda «tratar» **ya no existe en ninguna parte**,
y la casa **ya tiene** el sitio que el issue dice que falta (la clase `sinNavegador` de `qa/guiones/`,
que entra en CI sin tocar yml ni contrato). Decisión propuesta: **no hay tercera categoría**.

## El problema real, en una frase

Dos veces en dos semanas el material de QA se ha quedado sin dueño verificable: un número de guion
que dos ramas paralelas eligen a ciegas (#680) y una evidencia ejecutable que se dejó donde nadie
corre nada y por eso se perdió (#683).

## La premisa, afirmación por afirmación

| Afirmación | Verificado |
|---|---|
| Dos guiones comparten el 126 | Sí: `qa/guiones/126-dos-records-…` (#490, PR #582, en `main` 12:57 del 09-14) y `126-dos-rotulos-…` (#484, PR #588, 13:44). **El joven es el de rótulos.** 148 guiones, único prefijo duplicado, ninguno sin prefijo |
| La fila del 136 remite «al 126» sin decir cuál | Sí: `qa/README.md:542` «sigue en el 126». Por el tema (cámara/foco/rótulos) es el de rótulos, o sea **el que cede**: la remisión cambia sí o sí |
| El filtro del runner corre los dos | Sí, `qa/run.mjs:1340` (`filters.some((q) => f.includes(q))`); el issue decía `:1240`, caducó |
| Ninguna otra referencia viva al nombre | Verificado: fuera de `qa/README.md` solo aparece en `docs/agents/*/qa*.md` (registro histórico, no se reescribe) |
| Tres choques (83, 126, 148) | Sí: 83 en 914ab17d/86bc0559 (09-06/07); 148/149 en b95c0a64/b7b20650 (09-18), y la fila del 149 en `qa/README.md:554` lo dice con estas palabras |
| `qa/*.mjs` lo canda `candados-headless.json` por totalidad | Sí (`test/candados-headless-totalidad.test.ts`), pero su cabecera (c) declara que **`qa/guiones/*.mjs` queda fuera del censo** |
| `qa/guiones/` «lo corre el runner como batería de navegador» | **Incompleto.** Desde #655 un guion que exporta `sinNavegador` corre en CI con `node qa/run.mjs --sin-navegador` (`ci.yml:455`, `run.mjs:842`), sin preset, sin Chromium y sin línea nueva en el yml. Hoy lo hacen el 39, 40, 146 y **148 — escrito por QA de #663 el mismo día que #609**, y es un «rompe el fuente, corre `npm test`, exige rojo, más tabla de agujeros conocidos»: exactamente la forma del sondeo de #609 |
| El sondeo vive en `docs/agents/<tanda>/qa-609-sondeo.mjs` | **Falso hoy.** No está en `main`, ni en `ne-fan-b`, ni en ningún commit (`git log --all`): la PR e8bd1f02 solo entró `qa-609.md`; el fichero nació en el worktree `ne-fan-q1-656`, ya borrado. `.gitignore` no lo excluía: nadie lo añadió. El issue temía «nadie lo volverá a correr»; pasó lo peor: nadie puede |
| Sus 17 sabotajes | Descritos en prosa en `qa-609.md:219-247`; los 7 verdes son 5 arreglados en la PR + #682 (H-6..H-9) y raíz H-10 = #682, que hoy lleva la **tanda W** |

## El día después

- **#680**: cambia nada para el jugador, y es deuda declarada; lo que cambia es que «el 126» vuelve a
  nombrar un guion. Cierra la puerta a numerar en la rama: dos ramas seguirán pasando su `npm test`
  y el rojo solo sale al fusionar la segunda; eso lo absorbe la convención del criterio 4, no el test.
  Lo que el test NO cubrirá y hay que escribir: un guion sin prefijo (hoy cero), y `07` vs `7`
  (hay prefijos con cero a la izquierda; decidir si compara texto o número, no dejarlo implícito).
- **#683 sin tercera categoría**: al mes, el único sitio con ejecutables de QA es `qa/`, y `docs/agents/`
  sigue siendo solo prosa, que es lo que su README ya dice en la línea 27 («el rastro de verdad no
  es prosa: es el guion en `qa/guiones/`»). Se vuelve más difícil «dejar un sondeo para luego»: es
  la puerta que hay que cerrar. Nada que borrar: el sondeo ya no está.
- **Con tercera categoría** (por qué NO): sería un directorio que por definición nadie corre, o sea
  prosa con extensión `.mjs`; y su política de caducidad sería otra lista con motivo que la casa ya
  tiene tres veces (`candados-headless`, `banco-medido`, `sin_mutar`). El caso #609 es la prueba
  empírica: sin dueño ejecutor el fichero murió en cinco horas.
- Lo que parecerá arbitrario: una regla escrita en dos README sin candado. La forma de que no lo sea
  es barata y en negativo: que exista ejecutable en `docs/agents/**` (`.mjs/.ts/.sh/.py`) ponga rojo
  un test. Lo dejo como opción para el arquitecto, no como requisito.

## Conflictos

- **Tanda W (#682)** saca la parte pura de `expectMagnitud` a `qa/lib/` y necesita justo el negativo
  que era el sondeo (a..o rojos, H-8/H-9 verdes). **Reescribir el sondeo aquí duplicaría W y tocaría
  sus ficheros** (`qa/run.mjs`, `qa/lib/carga.mjs`). Orden: U escribe la regla; W la estrena.
- **Numeración con V, W y AF** (las tres pueden traer guion): el renumerado del 126 joven toma el
  número libre en `main` **al fusionar**, no 150 hoy. El candado de U saltará en la segunda PR que
  entre con número repetido: eso es el candado funcionando, no un rojo ajeno.
- Prosa ya caducada que U rozará: `qa/README.md:105` dice «hoy son tres (39, 40 y 146)» y son cuatro
  con el 148. Si se toca esa sección, se corrige; si no, se apunta.
- Sin contradicción con `arch-rules.json` ni con `CLAUDE.md`; #476 y #357 cerrados.

## Coste contra valor

#680: un `git mv`, tres filas de README y un test de ~40 líneas contra tres choques en dos semanas
con la lección escrita y sin candar desde el 09-07. No hacerlo = cuarto choque en la próxima jornada
paralela (hoy hay 14 tandas). #683: veinte líneas en dos README; no hacerlo = cada QA vuelve a
decidir sola y la evidencia se pierde como se perdió. Las dos valen más de lo que cuestan.

## Qué le cambiaría a `requisitos.md`

Sustituir el criterio 2 y el 3, y añadir un punto a «Fuera de alcance»:

> 2. **Candado**: un test afirma que el prefijo numérico de `qa/guiones/*.mjs` es único, **corre en
>    cada PR** (en `npm test` de `nefan-core`, como `candados-headless-totalidad.test.ts`, que ya lee
>    `qa/` desde core; o como guion `sinNavegador`, molde del 39/40) — el arquitecto elige y dice por
>    qué. Probado en negativo con los dos 126. Declara lo que NO cubre: guion sin prefijo, `07` vs
>    `7`, y que dos ramas paralelas lo pasan en verde hasta fusionar.
>
> 3. **#683 se DECIDE: no hay tercera categoría.** El material ejecutable de una QA es un guion de
>    `qa/guiones/` — con `export const sinNavegador` si no conduce navegador (corre en CI desde #655
>    sin tocar yml ni contrato) — con el molde del 148: SABOTAJES que deben salir rojos y AGUJEROS
>    CONOCIDOS que hoy salen verdes, cada uno con su issue, y la tabla se pone roja cuando un agujero
>    se cierra. En `docs/agents/` no vive nada ejecutable. Se escribe en `docs/agents/README.md`
>    (junto a la línea 27) y en `qa/README.md` (§«Lo que corre el CI», donde ya se explica
>    `sinNavegador`). El sondeo de #609 **no se trata: no existe** (nunca se commiteó; murió con el
>    worktree). Sus diez sabotajes rojos los reescribe la tanda W (#682) como negativo de lo que
>    extrae, no esta tanda.

> Fuera de alcance: reescribir el sondeo de #609 (es de W); un candado «nada ejecutable en
> `docs/agents/`» solo si el arquitecto lo ve barato — es opcional, la regla en prosa es el mínimo.

Y en «Preguntas abiertas», cerrar la suposición: el sondeo no puede valer como candado porque no hay
fichero; lo que quedó de él es prosa en `qa-609.md:219-247` y los issues #682/#687.
