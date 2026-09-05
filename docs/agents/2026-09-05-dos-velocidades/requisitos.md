# «Dos velocidades» — que la mutación deje de frenar

## La petición, literal

2026-09-04:

> Las ejecuciones de mutation estan frenando el desarrollo, como podemos seguir sin que nos frenen? Son
> tan necesarias y tan a menudo? tardan demasiado

Le presenté cuatro opciones con la medida delante y eligió **«Dos velocidades»**: una corrida rápida del
núcleo vivo y una profunda bajo demanda. Issue **#439**.

Tras el reencuadre del arquitecto y la revisión del crítico, volvió a elegir: **«Las dos en paralelo»** —
el selector y el reloj a la vez, con dos ingenieros.

## Lo que se midió antes de decidir

- **Tres corridas seguidas con 0 supervivientes nuevos** (`33672454166`, `33790710680`, `33895064567`):
  unas 9 h de runner para decir «nada ha empeorado». Lo que sí encontraron fue real (dos módulos bajo su
  suelo en #419, dos path traversal en #418), pero es poca cosecha para el precio.
- **El reparto del RELOJ** (la moneda desde #438), sobre la huella de `4747917`: escena/blueprint
  **80,1 %**, núcleo vivo 14,2 %, plugins 5,2 %, **combate 0,5 % (58 s)**. La tabla original de #439 estaba
  en mutantes y exageraba el ahorro de aparcar plugins y combate: son **5,7 %**, no el 16 %.
- **`scene-validate` cuesta 2.510 s él solo — el 20 % del reloj total**, y no cabe en el `tope_lote` de
  1.800 s. Es #441.
- **El selector ya existe y está ANULADO**, por tres forzadores de `todos` en `scripts/afectado.ts`
  (`:306-315` la rama `dato`; `:81-89` y `:82`, los dos de TOOLING). Reproducido en tres PR reales; la
  tercera (`8aa3f9f^..8aa3f9f`, #422) imprime **«NO EJECUTA NADA»**, que es el selector funcionando cuando
  nadie lo fuerza.

## Lo que se pide, en dos carriles que no comparten fichero

**Carril S · el selector** — #404, ampliado a los **tres** forzadores (el issue nombra uno). Por la **vía
derivada** que el propio `afectado.ts` tiene escrita para el caso gemelo (`efectoDeSalida` + `ctx.leen`), no
por una lista a mano: el crítico verificó que `ctx.leen` contesta sin lista. **Con el candado que él dejó
medido**: `leeElDato` busca el nombre en literales de cadena y **no ve a quien enumera un directorio**
(`puerto_tile.json` → ningún módulo, aunque `test/scene-fixtures.test.ts` lee `data/scenes/` con
`readdirSync` y está en la batería de `contrato-escena` y `scene-validate`). Ningún fichero de datos puede
resolverse a «no lo lee nadie» sin comprobar que ninguna batería enumera su directorio — **visto rojo**.

**Carril R · el reloj** — medir si `coverageAnalysis: "perTest"` compensa. Hoy está en `"off"` y **cada
mutante paga la batería entera**: es la causa de que 826 mutantes cuesten 42 minutos, y afecta a los 41
módulos, no a uno. Es un **experimento con número**, no un cambio a ciegas: hay que comprobar que la suite lo
tolera (los tests que comparten estado no lo toleran) y que el score medido **no cambia**, porque un
`perTest` que mide menos no es más rápido, es otra cosa.

## Restricciones que no se negocian

- **No se matan servidores ajenos.** Varios agentes en paralelo en esta máquina: prohibido `pkill`, prohibido
  matar por puerto. Arrancar con `./start.sh --preset <slug>` y `NEFAN_PORT_OFFSET` propio; parar con
  `./start.sh --parar`.
- **Cero créditos.**
- **La corrida completa la autoriza una persona.** `local <id>` está permitido para un módulo que quepa en
  `tope_local`; `pendiente`, `lotes`, `afectado` y `deuda` son gratis. Nadie lanza `npm run mutate` a pelo.
- **Ningún umbral se sube**: ni `tope_local`, ni `tope_lote`, ni un `break` a la baja. Esto es alcance y
  coste, no rigor.
- **Candado, no prosa**, y **visto rojo** antes de darlo por bueno.
- **Pre-producción**: lo que se sustituya se borra el mismo día, con `grep` a cero.

## Criterio de aceptación

1. Una PR que **no** toca el instrumento selecciona solo sus módulos: reproducible con `afectado --rango`
   sobre PRs reales ya mergeadas, y con el «NO EJECUTA NADA» de #422 intacto.
2. Un fichero de datos que **nadie** lee se resuelve a ninguno; uno que alguien lee **enumerando su
   directorio** se resuelve a esa batería. Las dos con candado visto rojo.
3. `perTest` vuelve con un número: cuánto reloj ahorra y si el score cambia. **Si el score cambia, no se
   adopta**, y el informe dice por qué.
4. Ninguna tanda vuelve a esperar una corrida para cerrarse — eso ya se levantó, y no se reintroduce.

## Tras los dos carriles (2026-09-05, `main` = `9dabc8a`)

**Los dos carriles están fusionados**: S en #445 (cierra #404; corridas completas 10/13 → 5/13 sobre las trece
PR reales; derivados #442 y #444) y R en #446 (`perTest` es un no-op con `testRunner: "command"`; candado en
`test/mutation-config.test.ts`; derivados #441 y #443). #439 sigue **abierto**.

Del plan queda **solo su PR-2** (§4): el campo `aparcado` en la entrada del módulo, su descuento en
`seleccionDesdeElTag`, el contador de commits desde `desde` en `pendiente`/`deuda`, y el rótulo
RÁPIDO/PROFUNDO en `pendiente` y `lotes`. Medido antes de decidir si se hace: aparcar `plugins-dsl` y `enemy-ai`
compra ~700 s de ~12.350 (5,7 % del reloj); el selector vivo ya hace que una PR de núcleo mida solo lo suyo.

Hoy `pendiente` dice 42 de 42, COMPLETA, y da **once** motivos: el tag `mutacion-ultima` sigue en `7b817b9`
(34 commits atrás) y el rango incluye las PR que tocaron el instrumento y tres ficheros borrados. Es la
corrida completa que #445 predijo para sí misma (R3 del plan): la «rápida» solo se ve después de que una
corrida mueva el tag.

Pregunta para el crítico: ¿la PR-2 sigue vigente tal como está escrita, se reencuadra (por ejemplo a solo el
rótulo, o a cerrar #439 con lo fusionado), o es obsoleta? Y qué le falta a #439 para cumplir su criterio de
cierre sin reintroducir la espera por una corrida.
