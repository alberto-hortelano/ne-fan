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

  **Un `fetch` INYECTADO no es red**, y es la única excepción escrita a lo de
  arriba (tanda AS, `en-desarrollo-lo-automatico-no-paga.test.ts`): cuando lo
  que se afirma es el CUERPO que un dueño del cliente manda —el `resolve_only`
  que sale del permiso de core—, sustituir `globalThis.fetch` por un doble que
  apunta y contesta es una costura entre el módulo y el contrato, no una
  conversación con un servidor. Si lo que se afirma depende de lo que el
  servidor HACE con ese cuerpo, ya no es de aquí.

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

   Con la SÉPTIMA pareja (#663, `#ts-sessions` y `.ts-save` entre el chasis y
   el home) tampoco murió ninguno, pero **el motivo NO es el mismo, y el que se
   escribió primero era falso**. Decía que los seis guiones que tocan esos dos
   tokens —33, 34, 52, 98, 101 y 122— no se enteran de la costura. Lo midió QA
   y es al revés: renombrando UN solo lado —el caso exacto que el unitario
   existe para cazar— **cinco de los seis se ponen rojos**, porque hardcodean
   `.ts-save` y `#ts-sessions` ellos mismos. Los dos motivos que SÍ se sostienen
   y por los que el unitario paga su sitio:

   - **Precisión.** Los guiones son detectores de RENOMBRADO, no verificadores
     de costura: se ponen rojos igual ante un renombrado CORRECTO de las dos
     puntas, que es un cambio legítimo y donde el unitario acierta al quedarse
     verde. Un rojo que no distingue el arreglo de la avería cuesta el tiempo de
     quien lo investiga, y dos veces de cada tres no había nada que arreglar.
   - **Quién lo corre.** El CI **no corre la batería de navegador**; `npm test`
     de `nefan-html` sí. Un candado que solo existe en la máquina de quien se
     acuerde de correrlo lleva un día rojo en `main` sin que nadie lo sepa, que
     es literalmente lo que pasó el 05-09 y por lo que nació
     `candados-headless`.

   O sea: el test entra por CI y por precisión, **no por cobertura**, y eso es
   suficiente para no matar a nadie. Una regla que nunca mata nada estaría de
   adorno: se re-comprueba cada vez, se MIDE en vez de suponerse, y se dice qué
   se miró.

## Cómo se mide el banco (#664)

`npm run coverage && npm run crap -- --check`, y es lo que corre el job
`nefan-html` de CI (el `npm test` a secas queda para el bucle de quien
programa). El CRAP sale de las MISMAS funciones que el del core
(`nefan-core/scripts/crap-score.ts --cliente`), con dos diferencias:

- **El universo es `src/` entero.** Lo que ningún test carga cuenta a
  cobertura 0 —hoy son tres cuartos del cliente— en vez de desaparecer. Por
  eso añadir un test NUNCA pone el gate rojo: solo puede subir la cobertura
  de alguna función.
- **El gate es por función**, contra
  `nefan-core/data/contract/client-crap.json`: cada una en CRAP ≤ 73 (el tope
  del core), o ≤ su foto si ya lo superaba el día que el cliente entró. Una
  función nueva de complejidad 9 sin test ya pasa del tope, **también si es
  anónima**: su clave es `padre>(anónima)@forma[#n]` (la llamada de la que es
  argumento, y un ordinal entre gemelas), así que no se esconde tras la foto
  de una hermana. Lo único que se funde son las funciones CON NOMBRE homónimas
  del mismo fichero, y hoy ninguna de esas claves está congelada (el detalle,
  en `_lo_que_esto_NO_sujeta` del contrato). Si una congelada baja, `crap` y
  `npm run deuda` avisan de que su cifra sobra; se aprieta a mano. Si se
  RENOMBRA o se mueve, el gate la marca «¿renombrado de …?» y ahí sí se
  regenera su entrada: `npm run crap -- --foto` imprime la foto que tocaría
  escribir hoy.

Lo que el lcov trae de `../nefan-core/…` se descarta: el core ya se mide con
su banco. Y la cola del cliente sale en `npm run deuda` (en `nefan-core`) en un
bloque propio, con un item por FICHERO para lo que está entero a 0 %.
