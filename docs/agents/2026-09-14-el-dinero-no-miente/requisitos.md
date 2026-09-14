# Tanda A · «El dinero no miente»

## De dónde sale

Del triaje del backlog del 2026-09-10, cuyas doce decisiones contestó el usuario el 2026-09-14.
Su mensaje literal al entregarlas: **«Mutacion corriendo, decisiones respondidas»**.

Las respuestas que gobiernan esta tanda están en
`docs/agents/2026-09-10-triaje-del-backlog/decisiones.md`, y se citan literales abajo. **No se
reabren**: el crítico verifica premisas y hechos del código, no vuelve a plantear la elección.

## Qué entra

### 1 · #513 — el batch de imagen de pago

Respuesta literal del usuario: **«- R: Opcion a, el arreglo del importa van en 513»**.

O sea, de las dos opciones que se le dieron:

- **(a) ELEGIDA** — «Nada nuevo: el batch sigue necesitando la pestaña, y #513 se limita a que lo
  pagado quede con dueño y a que **el importe deje de mentir**. Cierra #548. Barato.»
- (b) descartada — el batch como job del bridge con progreso y reanudación.

Y la secundaria, «¿el arreglo del importe entra en #513 o va aparte?», contestada: **entra en #513**.

Contexto ya establecido y que NO hay que volver a averiguar (está en
`docs/agents/2026-09-10-style-apply-fuera-del-navegador/critica.md`): la premisa original del issue
era falsa. **Cerrar la pestaña a mitad de un batch pagado cuesta $0** — uvicorn no cancela la
petición en vuelo, el servidor pinea lo que produce y la re-corrida resuelve por contenido
(cache-hit). La idempotencia ya existe. Lo que sí es real es que **el importe que se le enseña al
jugador antes de pagar miente hasta 7,8×**: el atlas cotiza `ceil(missing/12) × $0,15` ignorando que
cada ref de cara abre página propia, y el bloque de skins cotiza el **roster entero** cada vez
(~$2,9 por personaje).

### 2 · #548 — el segundo pago que invita a hacer

Lo absorbe #513 por la respuesta de arriba. Tras un batch de estilo PAGADO, un fallo de navegación
borra el «Estilo aplicado» y reactiva «Aplicar estilo»: la pantalla invita a pagar dos veces por lo
mismo.

### 3 · Con qué modo arranca una partida nueva

Respuesta literal: **«- R: b»**, sobre estas opciones:

- (a) Se queda como está: una partida nueva nace gastando.
- **(b) ELEGIDA** — «Nace en Maqueta 3D, y encender Imagen IA es explícito, como en el home.»
- (c) Se recuerda lo último que elegiste entre pantallas del título.

El hecho medido que la motiva: las dos puertas de la misma decisión no se tratan igual, y hoy es
**por omisión y no por elección**. En el **selector**, Escenarios y Personajes vienen en **Imagen
IA** y se cambian con un click sin confirmar; en el **home**, encender Imagen IA en un save **exige
dos clicks** con «¿Confirmar? Gastará créditos».

### 4 · #552 — «Volver» desde el editor de personaje

Entra en esta tanda porque cae en la misma zona y porque **deshace la decisión 2 si no se arregla**:
«Volver» pierde el mundo, el estilo y los dos modos, y los deja **en el que gasta**. Una partida que
nace en Maqueta 3D y vuelve a Imagen IA por navegar no cumple lo que se decidió.

## Criterio de aceptación (del jugador, no del código)

1. Antes de pagar, el importe que se enseña **es el que se cobra** — o, si no se puede saber, dice
   que es una cota y de qué lado. Con el desglose que hoy miente (atlas y skins) medido en una tabla
   antes y después.
2. Lo pagado **tiene dueño**: tras un batch, lo que se pagó está indexado y atribuido, y ninguna
   pantalla invita a pagarlo otra vez (#548).
3. Pulsar «Nueva partida» y jugar **no gasta un céntimo** sin un click explícito de confirmación,
   igual que hoy exige el home.
4. Ir al editor de personaje y **«Volver»** deja el mundo, el estilo y los dos modos **como
   estaban** (#552).

## Fuera de alcance

- Mover el batch al bridge o a ai_server (opción (b) de #513, descartada por el usuario).
- Cualquier cambio en el precio real de la API o en el pipeline de imagen.

## Avisos para el crítico

- Los issues de esta casa **caducan en horas**: verifica los cuerpos contra el código de HOY antes
  de nada. #548 y #552 nacieron el 2026-09-10.
- La aritmética del importe hay que **medirla**, no copiarla de aquí: la cifra 7,8× es del 2026-09-10.
- `nefan-html/src/ui/titulo/` son nueve módulos desde el cierre de #346, con el candado
  `las-hojas-del-titulo-no-se-atan-entre-si` (solo `atomos.ts` se importa entre hojas) y el enrutador
  `ir(destino)`. Cualquier plan que ate dos hojas entre sí nace rojo.
- La decisión de gasto del cliente vive en core desde #241 (`session/gates-de-imagen.ts`,
  `scene/frontera.ts`) y hay candado `la-logica-de-juego-no-vuelve-al-cliente`.
- **Cero créditos** en toda la verificación: `html-fixtures` y `e2e-sin-creditos`, motor falso.

---

## Correcciones del coordinador tras la crítica (2026-09-14)

La crítica está en `critica.md`, al lado. Se acepta entera. Esto es lo que cambia del alcance de
arriba, más las decisiones que ella dejaba abiertas.

**§2 «#548» SE BORRA.** Está hecho desde el 2026-09-10 (`4338c5a5`, `plan-de-estilo.ts:118-168`,
candado en negativo `qa/guiones/123-lo-que-ya-se-pago-no-se-vuelve-a-ofrecer.mjs`). Lo único vivo es
el «~$0.00 + ?» del botón cuando un bloque no tiene precio, y eso es §1. El issue se cierra aparte,
con la evidencia.

**§1 se corrige con la medida de hoy.** El error del atlas tiene **tres** causas —(a)
`CELLS_PER_PAGE = 12` cuando la capacidad geométrica real es **9** celdas cuadradas por página; (b)
cada ref de cara abre grupo propio; (c) la página sin tiles se cobra a $0,17 y no a $0,15— y **la
raíz de las tres es que `layoutAtlas` (TS) y `pack_missing` (Python) han divergido** pese a
declararse el mismo port. Medido hoy sobre `data/scenes/*.json`: **1,6× agregado, 3,1× el peor
fichero**; techo estructural de una petición de 64 celdas: **12,1×** ($0,90 → $10,88). La cifra 7,8×
era una cota construida y no se cita más como medida.

**Criterio de aceptación 1, reescrito**: el importe del **atlas es el que se cobra**; el de los
**skins es una cota superior declarada como tal**, porque remote-gen no tiene dry-run de skins
(`SkinSpriteSheetRequest` es `extra="forbid"`) y ninguna cifra exacta es alcanzable sin cambiar su
contrato. Una cota que se presenta como cota no miente; una cifra falsa sí.

**Decisión del coordinador sobre la raíz, y es una restricción del plan**: *el precio lo dice quien
EMPAQUETA*. Hay ya dos implementaciones del reparto en páginas y han divergido en silencio; **un
tercer port en el cliente queda FUERA DE ALCANCE**, y «arreglar la aritmética del cliente» sin
resolver de dónde sale el número no es un arreglo, es la tercera copia. El arquitecto elige el
mecanismo (que el servidor cotice, que las constantes bajen a un snapshot como `physics.json`, o lo
que sostenga) pero la salida tiene que dejar **una sola fuente**, y algo que se ponga rojo si vuelven
a separarse.

**§3 se corrige: el defecto vive en DOS sitios.** `titulo/selector-de-mundo.ts:210` (el literal del
cliente) y `bridge/handlers/session.ts:376` → `msg.renderMode || "image"` (el fallback del wire, que
es el que decide de verdad y el que está bajo `la-logica-de-juego-no-vuelve-al-cliente`). Cambiar
solo el cliente deja la puerta abierta. El de personajes ya está bien y no se toca.

**§3 gana alcance: el banco.** `qa/lib/sesion.mjs` (`nuevaPartida`) **nunca fija `rendermode`**, así
que hoy **79 guiones corren en `image` por omisión** y con este cambio pasarían a `vector` en
silencio. Los que afirman conducta de escenario en imagen se quedarían **verdes sin medir nada**, que
es la enfermedad que esta casa tiene fichada. Así que entra en la tanda: `nuevaPartida` fija el modo
**explícitamente**, y los guiones que miden imagen lo piden. Un defecto que cambia no puede cambiar
lo que mide la batería sin que nadie lo escriba.

**§4 gana un orden: §3 primero, #552 después.** Las dos aterrizan en `selector-de-mundo.ts:210-217` y
en `DestinoDelTitulo` (`atomos.ts:105-119`). Hacer #552 antes obliga a inventar el valor que §3
decide.

**Aviso de verificación**: por **#543**, ninguna hoja del título se importa en Node (`atomos.ts` lee
`location.search` al cargar), así que §3 y §4 solo se afirman con batería de navegador. No es
bloqueo, es coste — y que nadie lo descubra a mitad.

**Prosa que muere con la tanda**: `ui/style-apply.ts:446` dice que los sprite sheets no pasan por el
manifest y no se pinean; desde #376 los pina el servidor bajo `character:{hero_key}`. Un rastro que
miente confunde a los agentes, así que se barre con el cambio.
