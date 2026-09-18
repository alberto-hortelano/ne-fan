## La petición, literal

El usuario, el 2026-09-18 (sesión nueva, `main` = `a25d8c2f`):

> «Mira los issues que hay en github y ve cerrandolos, si tienes alguna duda dejala apuntada para
> mas tarde y trabaja de forma autonoma con la estructura de agentes definida.»

Sigue en pie el mandato del 2026-09-17: «ve cerrando sin parar, si tienes bloqueo en alguno lo
apuntas pero sigue hasta reducir el numero al minimo».

Decisión del coordinador para esta jornada: **ciclo completo con fase de QA** (crítico → arquitecto →
ingeniero → QA), porque QA es quien lleva nueve tandas cazando los candados que cubren menos de lo
que prometen. El usuario no está mirando en tiempo real: las dudas se APUNTAN (en `requisitos.md`,
sección «Preguntas abiertas», con la suposición que se toma) y se sigue.

## Estado medido al abrir

- `main` = `a25d8c2f`, árbol limpio, un solo worktree, máquina en reposo (load 0,2).
- Backlog: **37 abiertos = 25 núcleo + 12 `futuro`**. Esta jornada abre 14 tandas EN PARALELO
  (S…AF) sobre los 19 issues de núcleo no bloqueados; las otras tandas tocan OTROS ficheros, pero
  dos pueden rozarse en `qa/README.md`, en `qa/run.mjs` y en la numeración de guiones (#680: el
  número de guion se elige al fusionar, no al escribir; hasta que la tanda U cande el prefijo
  único, un guion nuevo lleva el número que le toque en `main` EN EL MOMENTO DE FUSIONAR).
- Batería de navegador: NO medida hoy al abrir. Última conocida: 145 verde · 0 rojo · 1 ⊘ de 146
  sobre `900b5b71` (ayer por la mañana); desde entonces entraron los guiones 148 y 149. Quien
  toque `qa/` mide lo que toca, aislado y en par (tres corridas de cada) antes de la completa.
- Las dos últimas corridas de mutación (`35317748262` y `35354800866`) salen COMPLETAS con 0
  nuevos y **dos suelos rotos conocidos** (#675 `npc-director` 75,33 % < 81; #676
  `state-http-dispatch` 99,28 % < 100): el gate de mutación está en rojo por eso y no distingue
  un rojo nuevo. La tanda T los cierra.

## Restricciones de la casa que aplican a TODAS las tandas

- Cero créditos: motor falso, presets `e2e-sin-creditos` y `html-fixtures`. Nada que llame a
  Imagen IA ni al motor real.
- Nunca `--parar-todo`, nunca `pkill`, nunca matar por puerto: hay otros agentes en la máquina.
  Solo `NEFAN_PORT_OFFSET=<n> ./start.sh --parar` desde el propio worktree. **Gotcha vivo (#684)**:
  con offset ≥ 1000 `--parar` MIENTE («nada que parar aquí» con el stack en pie); por eso hoy los
  offsets se reparten entre 100 y 900. Si te toca uno ≥ 1000, para por PID demostrando propiedad
  con `/proc/<pid>/cwd`.
- Ningún umbral se baja, y ninguno se sube para acomodar lo que acaba de crecer.
- Pre-producción: cero compatibilidad hacia atrás. Lo que se retira, se retira entero el mismo
  día (`grep` a cero en prosa, comentarios y docs).
- Un candado nuevo se prueba EN NEGATIVO (se reintroduce el defecto y se ve el rojo) y se declara
  por escrito lo que NO cubre. Un candado headless nuevo entra en `candados-headless` el día que nace.
- El worktree se monta con la receta de `docs/agents/README.md` (los cuatro `npm ci`, el build de
  `nefan-core`, las hojas de sprites). El fichero de salida de una corrida larga lleva el nombre
  del worktree.
- Cada afirmación factual del issue se VERIFICA contra el árbol antes de usarse como requisito:
  los cuerpos citan `fichero:línea` que caducan en horas.
- No se commitea en `main` ni se fusiona nada sin que el coordinador lo pida; el ingeniero trabaja
  en su rama y commitea en ella.

# Tanda U — «Un número, un guion; y dónde vive el sondeo de una QA» (#680 + #683)

## Los issues

- **#680**: dos guiones comparten el 126 (`126-dos-records-con-el-mismo-id-…` de #490 y
  `126-dos-rotulos-alineados-…` de #484); la fila del 136 en `qa/README.md` remite «al 126» sin
  decir a cuál. Tercera instancia del choque de numeración en paralelo en dos semanas (dos 83 el
  09-07, dos 148 ayer MIENTRAS el issue estaba abierto). El arreglo no es renumerar: es el candado.
- **#683**: QA no tiene dónde dejar material ejecutable headless que no es candado permanente
  (`qa/guiones/` lo corre el runner; `qa/*.mjs` lo canda `candados-headless.json` por totalidad).
  Acabó en `docs/agents/<tanda>/qa-609-sondeo.mjs`, que nadie volverá a correr.

## Criterios de aceptación

1. Uno de los dos 126 se renumera (criterio: el más joven cede), su fila del README y la remisión
   del 136 quedan inequívocas.
2. **Candado**: un test headless afirma que el prefijo numérico de `qa/guiones/*.mjs` es único.
   Probado en negativo (con los dos 126 sale rojo). Entra en `candados-headless` el mismo día.
   Y que diga lo que NO cubre (p. ej. un guion sin prefijo numérico).
3. #683 se DECIDE y se ESCRIBE. La decisión la propone el crítico y la ejecuta el ingeniero:
   o existe una tercera categoría con sitio, dueño y política de caducidad, o no existe y todo
   sondeo se convierte en candado o se borra. Lo decidido va en `docs/agents/README.md` y en
   `qa/README.md`, y el sondeo de #609 que hoy vive en `docs/agents/` se trata según la decisión.
4. La convención «el número lo asigna quien fusiona, mirando `main`» queda escrita donde la lea
   quien numera (README de `qa/`), porque dos ramas paralelas no ven el número de la otra y el
   candado solo salta AL FUSIONAR.

## Fuera de alcance

- Cambiar el filtro del runner (`filters.some(...)`): el issue midió que no pierde guiones.
- #476 (el runner saliendo `⊘` sin sprites).

## Preguntas abiertas

- Suposición: el sondeo de #609 vale como candado si demuestra algo que aún no canda nadie; si
  no, se borra con su motivo en el informe. El crítico lo mira.

## Reencuadre del crítico (REENCUADRADA, 2026-09-18), aceptado por el coordinador

Aceptado sin consultar porque corrige premisas y acota, no cambia el problema. Sustituye lo que nombra:

Decisión del coordinador (#683): NO hay tercera categoría; se adopta tal cual la propuesta del crítico. Y el 126 que cede es el de rótulos (el joven).


Sustituir el criterio 2 y el 3, y añadir un punto a «Fuera de alcance»:

2. **Candado**: un test afirma que el prefijo numérico de `qa/guiones/*.mjs` es único, **corre en
   cada PR** (en `npm test` de `nefan-core`, como `candados-headless-totalidad.test.ts`, que ya lee
   `qa/` desde core; o como guion `sinNavegador`, molde del 39/40) — el arquitecto elige y dice por
   qué. Probado en negativo con los dos 126. Declara lo que NO cubre: guion sin prefijo, `07` vs
   `7`, y que dos ramas paralelas lo pasan en verde hasta fusionar.

3. **#683 se DECIDE: no hay tercera categoría.** El material ejecutable de una QA es un guion de
   `qa/guiones/` — con `export const sinNavegador` si no conduce navegador (corre en CI desde #655
   sin tocar yml ni contrato) — con el molde del 148: SABOTAJES que deben salir rojos y AGUJEROS
   CONOCIDOS que hoy salen verdes, cada uno con su issue, y la tabla se pone roja cuando un agujero
   se cierra. En `docs/agents/` no vive nada ejecutable. Se escribe en `docs/agents/README.md`
   (junto a la línea 27) y en `qa/README.md` (§«Lo que corre el CI», donde ya se explica
   `sinNavegador`). El sondeo de #609 **no se trata: no existe** (nunca se commiteó; murió con el
   worktree). Sus diez sabotajes rojos los reescribe la tanda W (#682) como negativo de lo que
   extrae, no esta tanda.

Fuera de alcance: reescribir el sondeo de #609 (es de W); un candado «nada ejecutable en
`docs/agents/`» solo si el arquitecto lo ve barato — es opcional, la regla en prosa es el mínimo.

Y en «Preguntas abiertas», cerrar la suposición: el sondeo no puede valer como candado porque no hay
fichero; lo que quedó de él es prosa en `qa-609.md:219-247` y los issues #682/#687.

Decisión del coordinador (#683): NO hay tercera categoría; se adopta tal cual la propuesta del crítico. El 126 que cede es el de rótulos (el joven).
