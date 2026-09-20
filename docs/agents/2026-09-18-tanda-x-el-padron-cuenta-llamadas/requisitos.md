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

# Tanda X — «El padrón de sondas cuenta CONSULTAS alcanzables, no nombres escritos» (#686)

## El issue

#686: `data/contract/sondas-de-movimiento.json` + `test/la-consulta-de-movimiento-tiene-dueno.test.ts`
cuentan nodos del AST cuyo texto es `probeCollide`; un alias (`const pc = window.__nefan.probeCollide`)
es 1 nodo y alimenta N llamadas. Medido por QA: +7 consultas de punto por el `pc` del guion 119 y el
candado sale `pass 10 · fail 0`. Es la forma exacta del defecto que #662 vino a cerrar. Los tres
ficheros legítimos (93, 119, 133) son justo los que tienen alias. Límites declarados que conviene
cerrar de paso: solo mira `qa/**/*.mjs` (un `.ts` escapa, también a `qa-lib-tiene-quien-lo-mire`), y
cuenta por fichero, no por línea.

## Criterios de aceptación

1. El presupuesto cuenta consultas alcanzables: si un fichero declara un alias, el padrón sabe
   cuántas llamadas cuelgan de él (o lo declara como «N llamadas») y se pone ROJO cuando N cambia.
   Probado en negativo con el experimento de QA (+7 por `pc` en el 119 → rojo).
2. Una indirección por `qa/lib/` tampoco escapa (o se declara por escrito como lo que NO sujeta,
   con un test que MIDA el agujero, como ya exige `_lo_que_esto_NO_sujeta`).
3. Los alias siguen siendo legítimos: los tres ficheros de hoy pasan sin cambios de código.
4. `.ts` bajo `qa/` entra en el censo de este candado Y de `qa-lib-tiene-quien-lo-mire` (o se
   declara por qué no).
5. `_lo_que_esto_NO_sujeta` actualizado: lo que se cierra sale; lo que queda se mide.

## Fuera de alcance

- Prohibir alias. Cambiar `probeCollide`.

## Correcciones del crítico (VIGENTE, 2026-09-18), aceptadas por el coordinador


**Corrección de premisa.** Hoy el `pc` del 119 tiene UN sitio de llamada (`119:385`, en bucle); los «7» de `_lo_que_esto_NO_sujeta` (3) son los que QA añadió en su experimento. La frase del contrato se corrige con el barrido.

**Criterio 1, precisado.** «Alcanzable» significa **sitios de uso** resueltos sintácticamente dentro del fichero (referencias al identificador ligado por `const x = ….probeCollide` / `{probeCollide}` / `{probeCollide: x}`), con el mismo `ts.createSourceFile` del test y sin type-checker. Los nueve declarados deben dar la MISMA cifra que hoy sin tocar ningún guion (medido: 10:1 14:1 15:1 73:1 93:3 119:1 133:1 144:1 145:2) y el experimento de QA sobre el 119 debe dar 8.

**Criterio 2, acotado.** La indirección por `qa/lib/` NO tiene sujeto hoy (`grep probeCollide qa/lib/` = 0; el alias del navegador no cruza a Node). Se **declara y se mide** en `_lo_que_esto_NO_sujeta` con su `it`, como el nombre partido; no se cierra. Sí se cierran, por costar una rama más del mismo mecanismo, el re-alias (`const q = pc`) y el string en `const` (`const S = "probeCollide"`); y se declara el sombreado como sobrecuenta a propósito.

**Criterio 4, con su familia.** El `.ts` bajo `qa/` corre de verdad (Node 24 lo ejecuta sin tsx) pero `qa/run.mjs:1339` solo descubre guiones `.mjs`, así que la puerta es `qa/lib/*.ts` importado desde un guion. Las siete reglas de `arch-rules.json` con glob `qa/**/*.mjs` comparten el agujero: o se cierra la extensión para TODA la familia en esta tanda, o se cierra en los dos tests y se abre issue con las siete líneas citadas. No vale «cerrado» con dos de nueve.

**Fuera de alcance (añadir):** contar por línea.

Decisión del coordinador sobre el criterio 4: se cierra la extensión para TODA la familia (las siete reglas de arch-rules.json + los dos tests) si cabe en la tanda con su negativo; si no cabe, se cierra en los dos tests y se abre issue con las siete líneas. El ingeniero lo dice en el informe.

## Decisión del coordinador tras el plan (2026-09-18)

Se adopta la **§3-B del plan**: en vez de enseñar la extensión a diecinueve sitios, un candado «el banco es `.mjs` y solo `.mjs`» (lista blanca de extensiones bajo `qa/`, con negativo sintético). Es la garantía en el tipo que la casa prefiere y cierra la familia entera por construcción. Sustituye a la decisión anterior sobre el criterio 4. El `scan.roots` de `arch-rules.json` NO se toca (con la lista blanca no hace falta).
