# El título troceado — #346

## La petición

Literal del usuario, 2026-09-09:

> «sigue con 346, la mutacion se esta ejecutando»

Viene del mandato del 2026-09-02, también literal:

> «Vamos a centrarnos en ir cerrando issues. La parte central hay que dejarla bien pero los plugins
> los podemos dejar para mas adelante, el combate, el movimiento, el comercio... todo eso deben ser
> plugins y tienen baja prioridad en cuanto a calidad del codigo. Haz una seleccion de los issues
> centrales y marca los demas para mirar a futuro».

#346 es el programa que sigue en el orden aprobado, después de cerrar #358 (troceo de `main.ts`) y
#241 («el cliente solo pinta»). El usuario ya decidió el 2026-09-07, al abrir #241, que **la PR 7 de
#241 —la que sacaba del título el borrador de mundo y la elección de estilo— iba ANTES que #346**,
y que las dos **nunca van en paralelo**. Esa PR está fusionada (#534), así que #346 se abre ahora
sobre un título que ya no decide nada de juego.

## Estado medido hoy (2026-09-09, `main` = `1c7bf189`)

El cuerpo del issue es del 2026-08-31 y **sus cifras han caducado**: decía 1.533 líneas y siete
`render*` en unas líneas concretas. Medido hoy:

| Dato | En el issue (31-08) | Hoy (09-09) |
|---|---|---|
| Líneas de `nefan-html/src/ui/title-screen.ts` | 1.533 | **1.738** |
| Métodos `render*` | 7 | 7, en otras líneas: `renderGameGenProgress` :143, `renderHome` :569, `renderWorldSelect` :765, `renderStylePlan` :1069, `renderUploadStyle` :1161, `renderCreateWorld` :1330, `renderCharacterEditor` :1420 |
| `let` en el fichero | no lo decía | 11 |
| Imports | no lo decía | 15 sentencias (8 de ellas a `@nefan-core`, casi todas nacidas en #241) |

**Churn**: 39 commits en **23 PR distintas** en los últimos 30 días. Para comparar, `main.ts` al
abrirse #358 llevaba 72 commits en 41 PR y ese fue el argumento que sostuvo el programa cuando el
crítico tumbó el que traía el issue.

`client-file-size.json` lo tiene **congelado como excepción en 1.738 líneas exactas**, con dos
motores leyendo el mismo fichero: la regla `max-lines` de eslint (error rápido mientras se programa)
y `nefan-core/test/client-file-size.test.ts` (vigila que la excepción no envejezca). Cualquier corte
tiene que mover esa cifra en el MISMO commit y con `wc -l` real.

## Lo que pide el issue

Trocear **por pantalla** —un módulo por `render*`, la clase como orquestador fino que resuelve la
promesa de sesión— **sin cambiar comportamiento**. El issue mismo dice que es refactor mecánico
grande y que quiere tanda propia con QA de batería completa, porque los guiones de sesión ejercitan
el título entero.

## Lo que ya no está dentro (contexto que el issue no puede saber)

#241 se llevó del título a core, entre el 07-09 y su cierre, todo lo que era decisión de juego:
`borrador-de-mundo.ts` (validación del borrador), `eleccion-de-estilo.ts` (la preselección, donde
**manda el bridge**), `contracts/style-upload.ts` (validación del pack, compartida con Python por
snapshot) y `session/gates-de-imagen.ts` (modo efectivo de personajes). El título de hoy es
presentación y transporte: por eso #346 se abre ahora y no antes.

Sigue dentro `StyleApplyController` (`ui/style-apply.ts`, 531 líneas de batch de PAGO en el
navegador), que **NO es de este programa**: tiene issue propio, **#513**, y el usuario decidió el
07-09 que va fuera, con el arquitecto decidiendo si su sitio es el bridge o el ai_server. #346 puede
moverlo de fichero como colaborador, pero no puede reescribirlo ni adelantar #513.

## Preguntas para el crítico

1. **¿Sigue vigente el problema?** El cuerpo está caducado en cifras; el argumento (cada tanda carga
   1.700 líneas en el diff mental, dos tandas que tocan pantallas distintas chocan) hay que
   verificarlo contra el churn real: ¿esas 23 PR tocaban pantallas distintas, o la misma?
2. **¿El corte por pantalla es el corte correcto?** En #358 el crítico rompió el corte que traía el
   issue (el mapa de los `let` estaba muerto) y propuso otro. Aquí hay que mirar qué comparten de
   verdad las siete pantallas: `this.content`, las constantes CSS del módulo, la promesa de sesión,
   los listeners, `paso()` y el canal de errores. Si el estado compartido es más de lo que el issue
   dice, el corte por pantalla deja siete módulos con un objeto de contexto de N campos, y eso es lo
   que T3 rechazó y #358 evitó (fábrica/función pura, nunca objeto de contexto).
3. **¿Cuántos cortes y en qué orden?** Con criterio de cierre EN CIFRAS (líneas y `let` del fichero
   raíz), y la aritmética hecha antes de empezar: si los cortes previstos no llegan al tope, hay que
   decirlo ahora y no en el corte 4, que es lo que pasó en #358.
4. **¿Qué candado impide la vuelta atrás?** El tamaño ya lo canda `client-file-size.json`. ¿Hace
   falta algo más (una regla de fronteras que diga qué puede importar el título), o el tope basta?
5. **Conflictos vivos**: #513 (style-apply, no en paralelo), la corrida de mutación en marcha
   (`34339870322`, sobre `1c7bf189`, sale COMPLETA), y los derivados abiertos que tocan el título
   (#509, #510, #536 son de UI; comprobar si alguno muere con el troceo o si alguno lo estorba).

## Restricciones de la casa que aplican a esta tanda

- Movimiento **sin cambio de comportamiento**: cualquier cambio se DECLARA y se MIDE con tabla. En
  #241 QA cazó dos «sin efecto observable» que eran falsos; no se acepta la afirmación sin la medida.
- La lógica de juego **no vuelve al cliente**: la regla `la-logica-de-juego-no-vuelve-al-cliente`
  (8 grupos) está viva y cubre `nefan-html/src/**/*.ts`. Un corte que copie una decisión al módulo
  nuevo la pone roja, y así debe ser.
- `client-file-size.json` con el `wc -l` exacto en el mismo commit.
- Los guiones de `qa/guiones/` no se retocan para que pasen; los rastros de prosa sí se barren, con
  motivo. Van por el 93: **la numeración en paralelo es un riesgo conocido** (en #358 nacieron dos 83).
- Cero créditos en toda la verificación (`html-fixtures`, `e2e-sin-creditos`).
- Nada de matar servidores ajenos: `NEFAN_PORT_OFFSET=<n> ./start.sh` para arrancar, `--parar` del
  mismo árbol para parar, `ss -ltn` antes.

## Decisiones tras la crítica (usuario, 2026-09-09)

El crítico devolvió **REENCUADRADA**: el corte por pantalla es el correcto y —medido— **no necesita
objeto de contexto** (cada `render*` toca 2-3 campos de instancia, ≤ 6 en los dos concentradores, y
los 11 `let` son locales de su pantalla, no campos de clase), pero el alcance del issue **no llega al
tope**: solo-pantallas deja el fichero en ≈ 800 líneas con la excepción del candado intacta.

Las cuatro decisiones, tomadas por el usuario (las cuatro recomendadas):

1. **Alcance ampliado**: además de las siete pantallas salen las tres cajas que el issue no nombra —
   los átomos/CSS del módulo (`:1542-1738`, 197 líneas), el chasis del overlay (`:208-346`, 139) y
   los avisos (145). Seis PR.
2. **Criterio de cierre = retirar la excepción**: `title-screen.ts` baja de 450 y **desaparece de
   `client-file-size.json`** (de cuatro excepciones a tres). Más: **0 `let`** en la raíz (hoy 11),
   0 métodos `render*` privados, ningún módulo nuevo por encima de 450, y las **30 baterías** que
   conducen el título por `#ts-*` verdes **sin retocar un guion**.
3. **Seis PR**, la 5 (selector de mundos, 383 líneas) NO se parte: son movimientos puros con los ids
   del DOM intactos y la red de seguridad son esas 30 baterías.
4. **Un candado nuevo, barato**: un `ui/titulo/*.ts` no puede importar a otro salvo `atomos.ts`. Es
   lo que impide que el god-file vuelva repartido en siete ficheros atados en anillo. Contra la
   CONCENTRACIÓN no hay checker posible (lo dice el propio `$comment` del JSON): eso es revisión.

Ya estaba decidido el 07-09 y se confirma: **#513 (style-apply) arranca cuando #346 cierre**, y
#536 / #425 / #537 van detrás, cada uno aterrizando sobre un módulo nuevo pequeño.

### Correcciones al material que el crítico verificó

- **#509 y #510 no tocan este fichero**: viven en `modos-de-graficos.ts`, `game-ui.css`, `#gfx-panel`
  y `#error-log`. Salen de la lista de conflictos.
- **La entrada de `style-apply.ts` en `client-file-size.json` miente**: dice `"issue": "#346"` y desde
  el 07-09 es **#513**. Se corrige en este programa.
- **#427** (los tres huecos de mensaje del título) dice en su propio cuerpo que si #346 se hace antes,
  esta tanda es su criterio de corte natural. Sin conflicto: #346 primero.
- **La mutación en marcha (`34339870322`) no tiene conflicto**: `nefan-html` no entra en la mutación
  de core, y lo prueba `afectado.test.ts:252-259` (`client-file-size.json` selecciona `ids: []`).
- **Trampa medida para la PR 6**: los guiones 19, 20 y 34 leen
  `getElementById("title-screen").firstElementChild`. El chasis debe seguir dejando `content` como
  primer hijo.
