# El bosque es uno solo y colisiona igual para todos (#243 · #233 · #232)

## Petición del usuario (literal)

> Mergea y sigue con el backlog, elige y prioriza proximas tareas y continua de forma
> autonoma, yo voy a estar fuera unas horas, haz cosas que no necesiten de mi feedback y lo
> que surja lo dejas apuntado para que lo vea al final. Ten en cuenta que unas horas mias
> equivalen a varios dias de trabajo de agentes

Instrucción de gobierno vigente de la cola, dictada por el usuario en una sesión anterior:

> si se modifica uno lo modificas y si se descarta simplemente pasa al siguiente y al final
> revisamos los descartados pero no pares la ejecución de los demás a no ser que tengan
> dependencias y yo tenga que hacer una elección de dirección del producto

## De dónde sale esta tanda (lectura del coordinador, marcada como lectura)

Los tres issues son **el mismo sujeto visto desde tres sitios**: la vegetación de un tile.
Ninguno de los tres lo dice, porque cada uno lo descubrió una tanda distinta. Los junto
porque arreglar uno solo deja los otros dos peor de lo que están:

- **#243** — la misma `vegetation_zones` planta **dos veces** (blueprint + grid), y solo la
  primera colisiona. Medido: 4 de 40 postes bloquean, frente a 8 de 8 árboles del blueprint.
- **#233** — `density` significa **dos cosas** según la ruta (`área/22` con tope 48 vs.
  fracción de celdas). Es la causa del 15-17× estructural que mide #243.
- **#232** — el **bridge** no deriva volúmenes, así que el bosque es sólido para quien juega
  y transparente para el `NpcBehaviorSystem`.

Es lectura mía, no dato: si el crítico mide que son tres sujetos y no uno, que lo diga y los
parta — es exactamente su trabajo.

## Los cuerpos de los issues

Están íntegros en GitHub y hay que leerlos: `gh api repos/alberto-hortelano/ne-fan/issues/243`
(y 233, 232). Traen medidas propias —la tabla de densidades de #243, los dos call sites de
#233— que **no hay que volver a medir a ciegas, pero sí verificar**: son de hace dos días y
`main` ha movido cosas desde entonces (se retiró el gpu-worker, entró el arranque del cliente).

## Preguntas para el crítico

1. **¿Sigue viva la premisa de #243?** Como paliativo, `robledo_tile` bajó su densidad de 0,15
   a 0,05. Verifica el daño HOY, con la fixture como está commiteada.
2. **La salida 1 de #243 (retirar el estampado de entities de la ruta B) ¿es la obvia del
   dominio?** El propio issue dice que esas entities 1×1 eran la representación para los
   clientes 2D/Godot, **retirados en agosto**. `CLAUDE.md` dicta cero compatibilidad hacia
   atrás y que un formato sustituido se borra el mismo día. Si es eso, no es una decisión de
   producto: es coherencia interna, y se decide aquí.
3. **¿Hacia dónde va #232?** Sus dos salidas no son equivalentes: «el bridge deriva también»
   es más barata, «la derivación viaja resuelta en la world scene» es la que casa con la
   decisión ya tomada por el usuario («lógica en core, el cliente solo pinta»). Verifica si la
   segunda es alcanzable en esta tanda o si obliga a partirla.
4. **¿Qué promete el contrato y qué habría que borrar de él?** La frase de
   `data/contract/tools/generate_scene.json` («and grid entities — trunk collision, visible in
   every view») es hoy medio falsa. Si se retira una ruta, se retira su prosa el mismo día.
5. **¿Qué se persiste?** Las entities `scattered: true` viajan en el save y en `scenes_loaded`.
   Retirarlas cambia lo que hay escrito en saves existentes. Pre-producción: eso no es un
   freno, pero sí un dato para el plan.
6. **¿Toca claves de caché de imagen?** Es lo que decide si esta tanda cuesta dinero. Mídelo,
   no lo supongas.

## Freno explícito

Si al medirlo resulta que la salida correcta le quita al jugador una capacidad que hoy tiene
(por ejemplo: que el bosque denso desaparezca del mundo), **para y decláralo por escrito**;
eso sí es dirección de producto y lo revisa el usuario al volver. Todo lo demás se decide aquí.

## Criterio de terminado

Un bosque en el que **todo lo que se ve se comporta igual**: o todo frena o todo se atraviesa,
sin dos especies conviviendo. Verificable jugando, no leyendo. Y `density` con **un** solo
significado, candado.

---

## Addendum del coordinador, tras la crítica (2026-08-25)

El crítico **tumba mi lectura y la mejora**: el sujeto no es la vegetación, es que **una entity
estática del esquema y su volumen del plan son dos representaciones del mismo objeto que nadie
reconcilia**. La vegetación es su caso más ruidoso, no su causa. Los tres issues quedan
REENCUADRADOS y están actualizados en GitHub.

**Decisiones que tomo yo, con su medida delante:**

1. **La salida 1 de #243 se adopta** (retirar el estampado de entities de la ruta B). Es
   coherencia interna, no dirección de producto: los clientes 2D/Godot murieron en agosto, el
   canal sancionado para masa visual sin colisión ya existe (`scatter_zones`) y el crítico midió
   que **no toca ninguna clave de caché de imagen** — mismos 26 volúmenes, mismas 11 identidades
   de celda de atlas. **Cero euros.**
2. **La salida 2 de #232 se adopta** (la derivación viaja resuelta, unificada en core). El
   crítico la midió alcanzable en esta tanda: hoy hay **tres** copias de la misma composición
   (`main.ts:723`, `style-apply.ts:216` y la que le falta al bridge) sincronizadas por un
   comentario. Y casa con la decisión ya tomada por el usuario, «lógica en core, el cliente solo
   pinta».
3. **#234 se funde en esta tanda.** Es la mitad «duplicación» de #233 ya materializada; aparte
   se paga dos veces el mismo refactor.
4. **El freno no se dispara.** Queda una pregunta abierta para el usuario, anotada en la
   bitácora de la jornada y en `critica.md`: la ruta A **satura en 10-11 árboles por zona** pase
   lo que pase con `density`, así que los bosques serán arboledas ralas con detalle visual. Subir
   ese techo cambia cómo se anda por un bosque y es decisión suya. **No lo toques en esta tanda.**

**Orden en la cola**, decidido con las tres críticas de hoy delante: `#248` → `#231(a)` →
**[esta tanda]** → `#231(b)` → `#247`. #231(b) va detrás porque 19 de sus 59 errores de tipos
viven en `volume-metrics.test.ts` y `fps-ambience.test.ts`, cuyo sujeto reescribes tú.

**Criterio de terminado, corregido por el crítico** — sustituye al de arriba:

> Un bosque en el que todo lo que se ve se comporta igual —o frena o se atraviesa, sin dos
> especies conviviendo— **y un solo camino desde el esquema hasta la huella colisionable,
> compartido por cliente, bridge y pre-generación**. `density`, un significado por campo,
> candado. Verificable jugando.
