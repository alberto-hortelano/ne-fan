# Requisitos — programa #241 «El cliente solo pinta» (2026-09-07)

## Petición literal del usuario

Al cerrar el programa #358 (2026-09-07) se le ofreció elegir entre los dos programas siguientes del orden
aprobado, #346 (troceo de `title-screen.ts`) y #241 (harness del cliente). Respuesta literal: **«El 241»**.

Mandato de la serie (2026-09-02, vigente): «Vamos a centrarnos en ir cerrando issues. La parte central hay que
dejarla bien pero los plugins los podemos dejar para mas adelante, el combate, el movimiento, el comercio... todo eso
deben ser plugins y tienen baja prioridad en cuanto a calidad del codigo».

Decisión del usuario que ya reencuadró el issue (comentario del 2026-08-27 en #241, literal): «el cliente debe
mantenerse ligero. Asumimos que podría haber diferentes clientes y queremos toda la lógica posible compartida entre
ellos, si algo es lógica del juego no debe estar en cliente». Consecuencia escrita en ese comentario: **no se monta un
harness de test en `nefan-html`** (pagaría por que la lógica se quede ahí); el primer paso es **censar qué lógica de
juego sigue viviendo en `nefan-html` y moverla a core**; lo que quede será código de pintar y la pregunta de cuánta
medida merece se contesta sola.

Restricciones permanentes: no cerrar servidores ajenos (`./start.sh --parar` desde el propio árbol, offset propio,
nunca `pkill`); cero créditos en toda verificación; lo retirado sin rastros (`grep` a cero salvo `docs/agents/`);
tests obsoletos se borran con el cambio; pre-producción, cero compatibilidad hacia atrás.

## El issue, tal como está hoy

Título: «Ni una línea de nefan-html está medida: sin harness, sin objetivos de mutación y sin umbrales». Etiqueta
`deuda`. Lo que da título sigue intacto (medido hoy sobre `main` = `12aedd53`): `nefan-html/package.json` sin script
`test`, ningún `*.test.ts` bajo `nefan-html/`, el cliente ausente de `quality-thresholds.json` y presente en
`mutation-targets.json` solo como prosa («el cliente lo usa desde nefan-html, que no entra en la mutación de core»).
El CI del cliente comprueba `tsc`, `lint` y `build`: que compila.

Medido hoy: `nefan-html/src` son **14.466 líneas en 58 ficheros** (`ui/` 5.628, `renderer/` 3.134, `world/` 1.643,
`net/` 1.077, `input/` 672, `scene/` 504, `dev/` 379, `main.ts` 1.417). El 28-08 eran 11.834 en 41: **+2.632 líneas y
+17 ficheros en diez días**, ocho de ellos los módulos que #358 sacó de `main.ts` por fábrica (`ui/muro-de-carga`,
`ui/etiquetas-del-mundo`, `world/fixtures-del-selector`, `world/materializar-spawn`, `renderer/aspecto-del-jugador`,
`ui/conversacion`, `ui/hud-de-combate`, `ui/modos-de-graficos`): mejor repartido, igual de sin medir.

Los comentarios del issue ya apuntan sujetos concretos de lógica en el cliente:
- `errors.push`/`errors.resuelto` (`ui/error-log.ts`): lógica pura (orden por gravedad, tope 3, entrega en
  microtarea) sin DOM — «el sujeto más barato con el que empezar» (nota de T9, 04-09).
- La política del atlas (`scene/fps-atlas.ts`: `pendingTiles`, `queuedTiles`, `token`, `inFlight`) → propuesta
  `nefan-core/src/scene/politica-de-atlas.ts` con `pedir(key)`/`terminar(key, token)`; ya mordió en #390 (nota del
  02-09). Y la semántica implícita «el primer tile añadido queda activo» de `carga-de-tile.ts`.
- Los anotados por los cortes de #358, cada uno con issue: **#508** (los tres gates de gasto de imagen y la
  normalización del modo en `ui/modos-de-graficos.ts`, que el bridge conoce en `render-mode.ts`), **#504** (el
  cliente elige el arma del aro: `short_sword` dos veces; core tiene `weapon_changed` sin productor), **#489** (huella
  colisionable inventada con literales en `materializar-spawn.ts`; `collidesAt` salta los AABB con `svgApplied`),
  **#490** (gate de `loadSession` con ids duplicados), **#483** (capas del HUD).

Precedentes vivos que el crítico debe tener delante:
- T11 (#357): «test → banco» — la totalidad de `qa/lib` por test-o-exención, y el CI corre los candados headless.
  El mismo molde («todo fichero del núcleo puro está medido o eximido con motivo») es el que el issue reclama para el
  cliente, y la decisión del 27-08 dice que la forma de cumplirlo es que el cliente deje de tener lógica.
- `session-facets.ts`, `entrada-en-partida.ts` y `porValor`: tres piezas que YA se movieron al core «con batería de un
  fichero porque es el único test que lo importa (el cliente lo usa desde nefan-html)». El camino existe y tiene
  molde en `mutation-targets.json`.
- El candado `cierre` de `arch-rules.json` (T12, #359): todo lo que el cliente alcanza por el grafo de imports está
  libre de `node:*`; lo que se mueva a core para el cliente tiene que ser puro.
- `qa/guiones/` (85 guiones de navegador, corrida local) es hoy el ÚNICO nivel de verificación de comportamiento del
  cliente; el CI corre los diez candados headless.

## Qué se pide al equipo

1. **Crítico**: decidir si #241 debe hacerse tal como está reencuadrado (censo + mover), verificar la premisa contra
   el código de hoy (¿cuánta lógica de juego hay en `nefan-html` de verdad, fichero a fichero, y cuánta es pintar?),
   proponer el corte en PR (un programa, no una PR) y el criterio de cierre MEDIBLE. Pregunta explícita que debe
   contestar: ¿qué queda del título del issue («sin harness, sin umbrales») cuando el censo termine — se cierra por
   «ya no hay nada que medir», o necesita un candado que impida que la lógica vuelva (p. ej. tamaño por fichero de
   cliente ya existe en `client-file-size.json`; ¿un `arch-rule` sobre qué puede importar el cliente de core, o sobre
   qué NO puede contener?)? Y: ¿colisiona con #346 (`title-screen.ts`, 5.628 líneas de `ui/` en gran parte suyas) —
   se hace antes, después o dentro?
2. **Arquitecto** (tras el visto bueno del usuario a la crítica): plan por PR con destino en core de cada pieza,
   contrato/test/objetivo de mutación de cada una, qué se borra en el cliente y qué rastros.
3. **Ingeniero / QA**: una PR por pieza, guion de QA por frontera cuando toque, cero créditos.

## Aceptación (a reencuadrar por el crítico)

- Todo lo que el crítico y el arquitecto identifiquen como lógica de juego en `nefan-html/src` vive en `nefan-core`
  con test y entrada en `mutation-targets.json` (o exención con motivo), y el cliente lo llama.
- Lo que quede en `nefan-html` está enumerado con su motivo («pinta», «DOM», «WebGL», «entrada») y hay un candado
  ejecutable —no prosa— que impide que vuelva a crecer lógica ahí.
- #241 se cierra con la medida final (líneas y ficheros del cliente, módulos movidos, cobertura/mutación de cada uno).
- Los 85 guiones siguen verdes sin retocarlos; `verify`, `crap`, `deuda` sin empeorar.

## Tras la crítica — decisiones del usuario (2026-09-07)

Veredicto del crítico: **REENCUADRADA** (`critica.md`): ≈ 860 líneas de decisión sin DOM sobre 14.466, de las que
≈ 555 son regla de juego estricta y ≈ 290 presentación derivada del sim. Tres correcciones de premisa: la fórmula del daño
ya no está duplicada en `fps-gl.ts`; `world/frontier.ts` (la única regla de GASTO del jugador) no tenía issue y la nota de
`frontera-del-jugador.ts:14` que la sitúa en core es falsa; #508 es mayor (la regla «`""` sigue a escenarios» vive en core y
en tres sitios del cliente, con una divergencia viva en la preselección de estilo).

Preguntas del crítico y respuestas literales del usuario (todas la opción recomendada):
- **A. Alcance** → «Solo la regla estricta (Recomendado)»: ≈ 555 líneas en 8 PR; las ≈ 290 blandas se quedan con motivo escrito.
- **B. `style-apply.ts`** → «Issue propio, fuera del programa (Recomendado)»: **#513**, para el arquitecto, después de este programa.
- **C. Preselección de estilo** → «Manda el bridge (Recomendado)»: el criterio del título se borra; el cliente pide la del bridge.
- **D. Orden con #346** → «Extraer antes de trocear (Recomendado)»: la PR 7 (título) va antes de #346; nunca en paralelo.

Issues abiertos por el coordinador a raíz de la crítica: **#512** (frontera del jugador → core, PR 2) y **#513** (style-apply).

## Aceptación reencuadrada (la que toma el arquitecto)

- Las ocho PR del corte del crítico (§ «Corte propuesto»), cada una: la pieza en core como función pura sin `node:*`, con test
  y entrada `break: "sin medir"` en `mutation-targets.json`; el cliente la llama y su copia se borra (`grep` a 0); token en la
  regla `text` de `arch-rules.json` que impide que vuelva (molde `cliente-no-convierte-celdas-a-metros`); `client-file-size.json`
  si toca un eximido; guiones verdes sin retocar.
- Dos corridas de mutación autorizadas: una tras las tres PR de gasto (1-3), otra antes de cerrar.
- Cierre de #241: el censo hecho lista (estricta movida / blanda con motivo / pintar), la medida final y ningún issue paraguas.
