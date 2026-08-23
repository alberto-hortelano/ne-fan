# Requisitos — ejecución parcial: solo lo que ha cambiado (#176 + #168)

## La petición del usuario, literal

Primero encargó vaciar la cola de issues:

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo
> que puedas con el flujo de agentes»

Y a mitad de esta tanda, al ver la dirección que llevaba, **la corrigió**:

> «Veo mucha optimizacion de concurrencia pero lo que hay que minimazar es la ejecucion total.
> Modularizacion del codigo que permita ejecuciones parciales, solo lo que se ha cambiado y
> eliminar la ejecucion global.»

Esa segunda frase **manda sobre el enunciado de los issues**. Los issues #176 y #168 hablan de
repartir la corrida de mutación por módulos y de ampliar objetivos; el usuario dice que
repartir no es la respuesta, porque **repartir no reduce el trabajo: lo reordena**. Lo que hay
que reducir es cuánto se ejecuta, y la vía es estructural: que el código esté modularizado de
forma que un cambio solo obligue a ejecutar lo que ese cambio puede haber roto.

## Qué se descarta explícitamente

- **Afinar la concurrencia.** Ya se intentó en esta misma tanda y el usuario lo señaló como el
  dial equivocado. Además colapsó su máquina: `concurrency: 10` de Stryker × `node --test` sin
  `--test-concurrency` = ~130 procesos sobre 16 núcleos, **load average 129**. El acotado sigue
  siendo necesario para no ahogar el equipo (y para que las medidas no salgan infladas: la
  línea base honesta es **114,1 min de CPU**, no los 146,1 medidos bajo sobresuscripción), pero
  **no es el objetivo de la tanda** y no cuenta como reducción.
- **Repartir la corrida global en N corridas globales por módulo.** Sigue siendo ejecución
  global; solo que troceada. Reduce el coste por mutante (batería más pequeña) pero no reduce
  el número de veces que se ejecuta lo que nadie ha tocado.

## Lo medido hoy, que enmarca la decisión

| | reloj | CPU |
|---|---|---|
| `npm test` (85 suites, 1143 tests) | 6,5 s | 54,6 s |
| `npm run coverage` | ~11 s | — |
| **mutación completa** (1684 mutantes) | ~10 min | **114,1 min** |
| `node qa/run.mjs` (13 guiones, Chrome real) | ~4 min | — |

`nefan-core` es **un solo paquete**: 140 ficheros fuente medidos (`src/`, `bridge/`,
`services/`) y 85 ficheros de test, sin fronteras de módulo que digan qué test cubre qué
código. Esa es la razón de fondo por la que todo se ejecuta siempre.

**La suite de tests NO es el problema** (6,5 s). El problema es la mutación, por dos órdenes de
magnitud, y en segundo lugar la batería de QA. Cualquier diseño que gaste su esfuerzo en
acelerar `npm test` está optimizando lo que ya es barato.

## Lo que ya se hizo en esta tanda y sigue valiendo como MATERIA PRIMA

Está en la rama `tooling/mutacion-por-modulo`, sin commitear:

- `nefan-core/data/contract/mutation-targets.json` — fuente única de qué se muta y **con qué
  tests**, con los módulos agrupados por BATERÍA (no por tema) y un `break` por módulo medido
  en vez de puesto a ojo. Lo relevante para esta tanda no es el reparto: es que ahí hay un
  **mapa fichero-mutado → tests que pueden matarlo**, contrastado contra la traza de imports
  real atravesando los barriles por símbolo.
- `nefan-core/scripts/mutation-plan.ts` y `scripts/mutate.ts` — generan los configs de Stryker
  desde ese mapa, sin commitearlos.
- La extensión de `test/mutation-config.test.ts` que canda el reparto.

Ese mapa es exactamente lo que hace falta para responder «qué hay que ejecutar dado este
cambio». Reutilízalo o sustitúyelo por algo mejor, pero no lo tires sin decir por qué.

## Criterios de aceptación

1. **Un cambio acotado ejecuta trabajo acotado.** Dado un diff que toca N ficheros, existe un
   comando que ejecuta **solo** lo que ese diff puede haber roto —tests y mutación— y el
   informe demuestra la reducción con números reales sobre un diff real (por ejemplo, los de
   las tandas ya cerradas de esta sesión).
2. **La correspondencia cambio → trabajo se DERIVA, no se mantiene a mano.** Una lista escrita
   por una persona se desincroniza en semanas y el fallo es silencioso: se deja de ejecutar lo
   que había que ejecutar y todo sale verde. Si hay una parte declarada, tiene que haber un
   candado que la contraste contra la realidad (el mapa actual ya lo hace contra la traza de
   imports: ese es el listón).
3. **Fallar en seguro.** Si el sistema no sabe qué ejecutar para un cambio —fichero nuevo, uno
   que nadie importa, un cambio en un `.json` de datos, un cambio en el propio tooling—, la
   respuesta por defecto es **ejecutar de más**, nunca de menos. Y decirlo.
4. **«Eliminar la ejecución global»**: la ejecución global deja de ser la vía normal de trabajo.
   Ver la pregunta abierta 1 sobre qué pasa con el CI y con la corrida nocturna.
5. **La modularización que se proponga tiene que ser real, no cosmética.** Si la respuesta pasa
   por fronteras nuevas dentro de `nefan-core`, esas fronteras tienen que ser verificables
   (`arch-rules.json` es el mecanismo de la casa) y no romper los invariantes: lógica en core,
   un solo formato de escena, el bridge único escritor del save.
6. **`npm run deuda` sigue viendo la foto completa** aunque las corridas sean parciales, y
   sigue avisando de lo que lleva sin medirse. Esa función nació del fallo de **medir el vacío
   en verde** durante meses; probarla en negativo es obligatorio.
7. **La máquina sigue usable mientras se ejecuta cualquier cosa.** El invariante es *procesos
   simultáneos ≈ núcleos, nunca un múltiplo*, y va candado, no escrito en prosa.
8. `npm run verify` verde, `npm run crap -- --check` sin crecer, CI de la PR entero en verde.

## Fuera de alcance

- Matar los mutantes que destape ampliar objetivos (#168). Ampliar significa **medir**; matar
  es trabajo de otras tandas.
- Cambiar de test runner o de herramienta de mutación, salvo que el diseño lo exija — y
  entonces con su coste declarado.
- Los otros issues abiertos.

## Preguntas abiertas

1. **¿Qué significa «eliminar la ejecución global» para el CI?** Mi lectura por defecto, que
   puedes discutir: se elimina como **vía normal de trabajo** (lo que corre una persona o una
   PR), y se conserva una corrida completa **programada** como red de seguridad, porque un
   cambio puede romper algo que el grafo de imports no predice. Si tu diseño hace innecesaria
   esa red, dilo y demuéstralo; si la conserva, di cada cuánto y qué pasa cuando se pone roja.
2. **¿Dónde está la frontera de módulo?** ¿Se derivan del grafo de imports (cero mantenimiento,
   pero los barriles y los tests transversales lo emborronan), se declaran como paquetes de
   workspace con sus propios tests (frontera real, pero es un refactor grande), o hay una
   tercera vía? **Recomendación explícita con coste, sin empates.**
3. **¿Aplica también a `node qa/run.mjs`?** Son ~4 minutos con Chrome real y crece con cada
   guion. Si un cambio en el bridge no puede afectar al guion de colisión, ¿por qué se ejecuta?
