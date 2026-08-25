# Los candados que no pueden ponerse rojos (#231 · #248 · #247)

## Petición del usuario (literal)

> Mergea y sigue con el backlog, elige y prioriza proximas tareas y continua de forma
> autonoma, yo voy a estar fuera unas horas, haz cosas que no necesiten de mi feedback y lo
> que surja lo dejas apuntado para que lo vea al final. Ten en cuenta que unas horas mias
> equivalen a varios dias de trabajo de agentes

Instrucción de gobierno vigente de la cola:

> si se modifica uno lo modificas y si se descarta simplemente pasa al siguiente y al final
> revisamos los descartados pero no pares la ejecución de los demás a no ser que tengan
> dependencias y yo tenga que hacer una elección de dirección del producto

## De dónde sale esta tanda (lectura del coordinador, marcada como lectura)

Los tres son **el mismo modo de fallo**, que este repositorio ya se ha cobrado tres veces:
*un verde que no puede ponerse rojo*.

- **#231** — `tsconfig.json` no incluye `scripts/` ni `test/`, así que el CI **no comprueba
  tipos en los tests**. Ya tiene crítica hecha y **medida** (`docs/agents/2026-08-23-selector-y-tipos/critica.md`):
  `scripts/` da **0 errores** (una línea de config), `test/` da **59 en 21 ficheros** (~51
  reales) — el criterio del propio issue lo **parte en dos tareas**. Y destapó un tercer caso
  del patrón: `test/service-registry.test.ts:22` compara `extractionPhase !== undefined` sobre
  tres servicios que **no lo declaran**, así que tres aserciones no se ejecutan nunca — y si se
  ejecutaran, fallarían.
- **#248** — la regla `html-sin-promesa-muda` caza `void algo();` sin `.catch`. Tiene **tres
  puntos ciegos no declarados**, y el que importa es que **quitar el `void` desactiva el
  candado entero**. El backstop que lo cubriría, `no-floating-promises`, no está activo en
  `nefan-html`.
- **#247** — el guion 15 de QA es **una moneda al aire, demostrado sobre `main`**: verde por
  6 cm, rojo por 3 cm en corridas seguidas. Su aserto no mide un hecho del sim, mide dónde
  estaba el NPC cuando venció un cortafuegos de pared.

Es lectura mía: si el crítico ve que son tres tareas sin nada en común salvo la moraleja, que
las parta. La moraleja no es una dependencia.

## Los cuerpos de los issues

`gh api repos/alberto-hortelano/ne-fan/issues/231` (trae YA el reencuadre del crítico, con
medidas), `/248` y `/247`. **#231 ya pasó por el crítico**: no lo re-critiques desde cero,
verifica que sus medidas siguen valiendo sobre `main` de hoy (han entrado tres tandas desde
entonces, una de ellas retiró el gpu-worker — que es **justo uno de los tres servicios** del
hallazgo de `service-registry.test.ts`).

## Preguntas para el crítico

1. **¿Cuánto de #231 se ha movido solo?** El gpu-worker ya no existe. Vuelve a contar los 59
   errores de `test/` sobre `main` de hoy. Si la cuenta ha cambiado, la partición en dos
   tareas puede haber cambiado con ella.
2. **#248: ¿cuántas violaciones aparecen al activar `no-floating-promises`?** El issue avisa de
   que hay que **medirlas antes** de decidir si van con `max` congelado o de golpe. Mídelas.
   Y comprueba lo segundo, que es lo que decide el coste: activar type-checking en el lint de
   `nefan-html` ¿cuánto tarda? Si multiplica el lint por diez, es un dato del plan.
3. **#248 vs. #231: ¿son la misma tarea?** Los dos son «activar comprobación de tipos donde no
   la hay». Uno en `nefan-core`, otro en `nefan-html`. Si conviene fusionarlos o si conviene
   ordenarlos, dilo.
4. **#247: ¿el arreglo propuesto es el correcto?** El issue dice que el sim debe RECORDAR el
   desplazamiento máximo, como ya se hizo con `telegraphEpisode` en el guion 10. Verifica que
   ese precedente existe y que es aplicable, o propón otro.
5. **¿Hay más guiones con el mismo defecto?** #247 nombra el 15. Si hay otros asertos de QA
   que dependen de un reloj de pared, esta tanda es el momento de enumerarlos — pero enumerar
   no es arreglar: di cuáles, y si entran o no.
6. **Riesgo de alcance**: ampliar el `include` del `tsconfig` puede tocar `outDir`,
   `declaration` y el build de producción. Si eso convierte una línea de config en una tanda,
   dilo antes de que lo descubra el ingeniero.

## Freno explícito

**No se aceptan `as any` ni un baseline de errores tolerados** para cerrar #231: eso
reproduciría exactamente el problema con otro nombre. Si los ~51 errores de `test/` no caben
en esta tanda, entra `scripts/` (que es una línea), se declara por escrito qué queda fuera, y
`test/` se queda en la cola como tarea propia. Lo que no vale es apagar el gate para que pase.

## Criterio de terminado

Cada candado de esta tanda **probado en negativo**: se rompe algo a propósito, el candado se
pone rojo, se revierte. Un candado que nadie ha visto rojo no cuenta como candado.
