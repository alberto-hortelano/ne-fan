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
