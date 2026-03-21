# Sistema de Magia

La potencia de un conjuro se calcula sumando los puntos de sus componentes más la habilidad del mago.

**Potencia = Momento + Ritual + Objeto + Lugar + Habilidad + Sacrificio**

**Potencia efectiva = Potencia − Duración**

La duración consume parte de la potencia. Un conjuro permanente requiere mucha más potencia bruta para lograr el mismo efecto que uno fugaz. Esto crea un compromiso entre la fuerza del efecto y su persistencia.

Cada componente tiene 5 niveles (0–5). El nivel 0 significa que no se usa ese componente. Los puntos siguen una **progresión de Fibonacci**: los niveles altos se disparan en potencia pero son mucho más difíciles de conseguir.

| Nivel | Puntos |
|-------|--------|
| 0 | 0 |
| 1 | 1 |
| 2 | 2 |
| 3 | 3 |
| 4 | 5 |
| 5 | 8 |

### Reglas generales

- **La habilidad del mago marca el techo**: el nivel de habilidad del mago es el máximo que puede usar en cualquier componente. Un mago con habilidad 3 no puede usar componentes de nivel 4 o 5.
- **Los componentes de nivel 5 requieren varios conjuros** previos para conseguirlos (misiones encadenadas).
- Los componentes concretos de cada conjuro los genera el motor de historia (IA).

---

## Momento

Cuándo se realiza el conjuro. Cuanto más tiempo falte para el momento adecuado y más difícil sea de averiguar, más puntos otorga.

| Nivel | Descripción |
|-------|-------------|
| 0 | Sin momento específico, se lanza cuando se quiera |
| 1 | Momento común y predecible (mediodía, medianoche) |
| 2 | Evento natural poco frecuente (luna llena, solsticio) |
| 3 | Coincidencia de varios eventos naturales |
| 4 | Evento raro que requiere cálculos o investigación |
| 5 | Alineación extraordinaria, extremadamente difícil de predecir |

## Ritual

La complejidad de la ejecución. Desde unas simples palabras hasta un aquelarre multitudinario.

| Nivel | Descripción |
|-------|-------------|
| 0 | Sin ritual, puro acto de voluntad |
| 1 | Unas palabras o un gesto sencillo |
| 2 | Encantamiento con gestos y palabras coordinados |
| 3 | Ritual elaborado que requiere preparación y tiempo |
| 4 | Ceremonia con varios participantes |
| 5 | Aquelarre multitudinario, gran coordinación entre muchos magos |

## Objeto

El componente material del conjuro. Cuanto más difícil de conseguir, más puntos.

| Nivel | Descripción |
|-------|-------------|
| 0 | Sin objeto, conjuro inmaterial |
| 1 | Objeto común y fácil de obtener |
| 2 | Objeto poco habitual, requiere cierta búsqueda |
| 3 | Objeto raro, difícil de encontrar o costoso |
| 4 | Objeto muy escaso, requiere una búsqueda o misión específica |
| 5 | Objeto único o legendario, extremadamente difícil de conseguir |

## Lugar

Dónde se realiza el conjuro. Lugares con significado, poder o dificultad de acceso otorgan más puntos.

| Nivel | Descripción |
|-------|-------------|
| 0 | Cualquier lugar, sin relevancia |
| 1 | Un lugar con cierto significado (un cruce de caminos, una iglesia) |
| 2 | Lugar notable que requiere desplazamiento (una cima, unas ruinas) |
| 3 | Lugar peligroso o de difícil acceso (el cráter de un volcán, una cueva submarina) |
| 4 | Lugar oculto o protegido que requiere investigación para encontrar |
| 5 | Lugar legendario, casi imposible de alcanzar |

## Duración

Cuánto tiempo persiste el efecto del conjuro. No se mide en minutos sino en tiempos narrativos.

| Nivel | Descripción |
|-------|-------------|
| 0 | Instantáneo: un gesto, un parpadeo |
| 1 | Fugaz: lo que dura una escena o un encuentro |
| 2 | Pasajero: unos días, lo que dura una misión |
| 3 | Duradero: meses, una estación |
| 4 | Prolongado: años, toda una era personal |
| 5 | Permanente: para siempre, o hasta que se desencante |

La duración sigue la misma progresión de Fibonacci que los demás componentes y se **resta de la potencia total** para obtener la potencia efectiva del conjuro.

### Mantenimiento

En lugar de pagar el coste completo de una duración alta, el mago puede elegir una duración menor y **mantener el conjuro** periódicamente. El mantenimiento funciona como un pequeño conjuro con sus propios componentes (momento, ritual, objeto, lugar, habilidad), mucho más sencillos que los del conjuro original.

- Si se deja de mantener, el efecto se desvanece al acabar la duración actual.
- El mantenimiento es ideal para conjuros que se quieren conservar indefinidamente pero cuya potencia no alcanza para pagar una duración permanente.
- No todos los conjuros admiten mantenimiento: un arma encantada para la eternidad no tiene sentido mantenerla, pero un brazo de madera viva sí, como quien riega una planta.

| Nivel | Coste |
|-------|-------|
| 0 | 0 |
| 1 | 1 |
| 2 | 2 |
| 3 | 3 |
| 4 | 5 |
| 5 | 8 |

## Sacrificio

El mago puede obtener puntos extra de potencia a cambio de **efectos negativos permanentes**. El jugador elige cuántos puntos quiere ganar y el motor de historia (IA) genera una penalización acorde y relacionada temáticamente con el conjuro.

- Los puntos de sacrificio se suman directamente a la potencia.
- La penalización es siempre proporcional a los puntos ganados y coherente con la naturaleza del conjuro.
- Ejemplos: un conjuro de Vida podría costar años de la vida del mago. Un Artificio podría dejar las manos del mago permanentemente temblorosas. Un Hechizo podría hacer que el mago olvide recuerdos propios.

**Potencia = Momento + Ritual + Objeto + Lugar + Habilidad + Sacrificio**

## Habilidad del mago

Se suma siempre a la potencia total. Representa la maestría innata y adquirida del lanzador. Las disciplinas mágicas se detallan en [escuelas-de-magia.md](escuelas-de-magia.md).

## Desencanto

Un conjuro puede deshacerse con un desencanto que **supere su potencia**. Al deshacer un conjuro, el mago original sufre consecuencias según cómo construyó el conjuro:

- **Solo con habilidad (sin componentes)**: sin consecuencias para el mago original.
- **Con componentes de bajo nivel**: penalización temporal a sus conjuros.
- **Con componentes de nivel medio**: marca estética permanente en el mago.
- **Con componentes de nivel alto**: maldición.
- **Con componentes de nivel máximo**: muerte terrible.

Las consecuencias dependen de la potencia total del conjuro deshecho.

### Protección contra desencanto

Se pueden gastar puntos adicionales en **complicar el desencanto**, haciendo que el requisito para deshacerlo sea mayor que los puntos invertidos. Esto encarece el conjuro original pero lo hace más resistente.

## Motor de historia (IA)

Los componentes de cada conjuro (momento, ritual, objeto, lugar) no están predefinidos. El motor de historia basado en IA:

- **Genera las misiones** necesarias para conseguir cada componente.
- **Define en qué consiste** exactamente cada componente dentro del contexto narrativo.
- La dificultad y naturaleza de las misiones se ajustan al nivel del componente elegido.

Esto hace que cada conjuro sea una experiencia narrativa única: el jugador decide cuánta potencia quiere invertir en cada eje y la IA construye la aventura acorde.

## Estilo de magia

La magia de Never Ending Fantasy se inspira en los **cuentos y relatos antiguos**, no en sistemas tipo D&D o Harry Potter. La magia es misteriosa, tiene un coste, a menudo requiere ingenio o sacrificio, y sus resultados pueden ser imprevisibles. Los conjuros se sienten más como pactos, prodigios o maldiciones que como habilidades de combate.
