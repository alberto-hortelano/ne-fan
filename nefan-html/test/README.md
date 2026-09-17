# El banco del cliente

Tests unitarios de `nefan-html`, en Node y sin navegador:
`node --import tsx --test test/*.test.ts`, el mismo runner que `nefan-core`. Ni
vitest ni jsdom: el día que hiciera falta un DOM, el sujeto no es de aquí (abajo).

## Qué se prueba aquí, y qué no

Esta frase es la mitad cara de #636 —la infraestructura es un script y dos
devDeps— y por eso va escrita antes que el primer test:

**SÍ es de aquí:**

- **Derivación pura de datos a string o a estructura.** Una función que recibe
  datos y devuelve HTML, CSS, una etiqueta o un objeto, sin tocar el DOM ni la
  red ni el reloj.
- **Costuras entre dos módulos del cliente que hoy solo casan por convención.**
  Dos ficheros que tienen que estar de acuerdo en algo —un id, un nombre de
  atributo, un orden— y a los que nada obliga a estarlo. Es el sujeto del primer
  test (#555), y es el caso donde un unitario gana a un guion de navegador: el
  guion se pone rojo por el síntoma y quien lo arregla puede arreglar el GUION.

**NO es de aquí:**

- **Lógica de juego.** Vive en `nefan-core` y se prueba en `nefan-core/test`,
  y el candado `la-logica-de-juego-no-vuelve-al-cliente` lo sujeta. Que exista
  este banco no es permiso para traerse nada de vuelta: es exactamente el riesgo
  que abre, y está dicho aquí para que se vea.
- **Cualquier cosa que pida DOM, WebGL, red o un reloj de verdad.** Eso es
  `qa/`, que arranca el juego y lo mira. El criterio no es «es difícil de
  montar» sino «lo que se afirma solo es cierto en un navegador».

## Dos reglas de convivencia

1. **El banco vive FUERA de `src/`, y no es una preferencia.** El candado
   `el-cliente-no-alcanza-node-ni-a-traves-del-core` cubre `nefan-html/src/**/*.ts`
   con cierre por el grafo de imports: un `*.test.ts` bajo `src/` que importe
   `node:test` lo violaría. Por el mismo motivo `nefan-html/test` está en
   `scan.roots` de `arch-rules.json` — así, si un fichero de `src/` importa el
   banco, el cierre denuncia el `node:test` con el camino entero.
2. **Si un unitario deja redundante a un guion de navegador, el guion MUERE y se
   dice cuál.** Un banco que solo suma acaba pagando dos veces por la misma
   afirmación. Al nacer éste no murió ninguno: el guion 33 mide el HOME, no el
   selector, y ninguno de los que nombran estos seis ids afirma la costura.
