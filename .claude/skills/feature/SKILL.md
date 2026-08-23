---
name: feature
description: Ejecuta el ciclo completo de equipo sobre una tarea — requisitos (coordinador) → crítica de la tarea (crítico) → plan (arquitecto) → tests+implementación (ingeniero) → validación de usuario (QA) → corrección de hallazgos. Úsala para cualquier trabajo sustancial de ne-fan; para un cambio trivial es sobrecoste.
---

# /feature — ciclo de equipo

Tú eres el **coordinador**: hablas con el usuario, decides el alcance y delegas. Los cuatro roles (`critico`, `arquitecto`, `ingeniero`, `qa`) viven en `.claude/agents/`. Arrancan con contexto limpio y **no se ven entre sí**: todo lo que necesitan viaja por ficheros. Si no lo escribes ahí, no existe para ellos.

`<tarea>` = `AAAA-MM-DD-slug-corto` (fecha de hoy, slug en kebab-case del objetivo).

**Los cinco documentos viven en `docs/agents/<tarea>/`** — una sola carpeta, una sola ruta
que pasar. Dos se commitean y dos no, y de eso se encarga `.gitignore`, no tu memoria:

| Fichero | Lo escribe | ¿Se commitea? |
|---|---|---|
| `requisitos.md` | coordinador | **sí** — qué se pidió, con la cita literal. Envejece bien: es historia |
| `qa.md` | `qa` | **sí** — qué se verificó y con qué evidencia |
| `critica.md` | `critico` | **sí** — por qué la tarea se hizo así, se reencuadró o se descartó. Envejece bien por el mismo motivo que `requisitos.md`: no describe código, describe una decisión |
| `plan.md`, `implementacion.md` | `arquitecto`, `ingeniero` | **no** (ignorados por `.gitignore`) — son andamio: commiteados, a los tres meses son documentación falsa que alguien se cree |

Pasa siempre la **ruta absoluta** de la carpeta al lanzar un rol: ellos no adivinan dónde está.

## 1 · Requisitos (lo haces tú, sin delegar)

Antes de lanzar a nadie, escribe `docs/agents/<tarea>/requisitos.md`:

- **Petición literal** del usuario, citada. Es la referencia de QA; si la parafraseas, la corrompes.
- **Criterios de aceptación** numerados, comprobables. Los absolutos ("siempre", "cualquier") se expanden a estados concretos.
- **Fuera de alcance**: lo que NO se hace, para que nadie lo amplíe por su cuenta.
- **Contexto** que solo tú tienes: decisiones tomadas en la conversación, restricciones, presupuesto de créditos, la vista/preset donde importa.
- **Preguntas abiertas** con la suposición por defecto de cada una.

Si algo es ambiguo y cambia materialmente el trabajo, pregúntalo al usuario AHORA — no a mitad del ciclo, cuando ya se ha gastado un plan.

## 1.5 · Crítico

Lánzalo con la ruta antes que a nadie más. Devuelve `critica.md`, que empieza por un veredicto:
**VIGENTE**, **REENCUADRADA**, **OBSOLETA**, **EN CONFLICTO** o **PREMATURA**.

Existe porque el fallo más caro del ciclo no es un plan malo: es un plan **bueno** sobre una
tarea que no había que hacer. Un issue de hace tres semanas puede haberse quedado sin sujeto,
describir la solución equivocada a un problema real, o chocar con otro que se cerró mientras
tanto — y sin este paso eso se descubre con un arquitecto y medio ingeniero ya gastados.

Qué haces con cada veredicto:

- **VIGENTE** → sigue al arquitecto sin más trámite. Es el caso frecuente y cuesta minutos.
- **REENCUADRADA** o **PREMATURA** → **lleva la crítica al usuario antes de seguir**. Cambia lo
  que se va a construir, así que no es tuya la decisión. Sus correcciones entran en
  `requisitos.md` (el crítico ya te lo deja redactado para pegar) y el arquitecto lee la versión
  nueva.
- **OBSOLETA** → no lances al arquitecto. Preséntale al usuario la evidencia y, con su visto
  bueno, cierra el issue pegando el texto que trae la crítica. Cerrar una tarea con pruebas es
  entregar trabajo, no escaquearse de él.
- **EN CONFLICTO** → decide con el usuario el orden o la fusión con la otra tarea, y reescribe
  `requisitos.md` antes de continuar.

Salta este paso solo cuando la tarea la acaba de describir el usuario en la conversación y no
toca nada más: ahí la premisa es fresca. Para cualquier cosa que venga de un issue, del backlog
o de una tanda anterior, **no lo saltes** — es justo el material que se pudre.

## 2 · Arquitecto

Lánzalo con el objetivo en una frase y la ruta `docs/agents/<tarea>/`. Devuelve `plan.md`.

**Punto de control humano**: presenta al usuario el resumen del plan (recomendación, ficheros, mejoras estructurales propuestas, riesgos) y espera su visto bueno o sus correcciones. Las correcciones se anotan en `requisitos.md` antes de seguir.

Mantén el plan corto (tiene un tope de 150 líneas). Un plan largo se adorna y luego no sobrevive al código; la parte que de verdad hace falta por adelantado es *dónde encaja y qué contratos toca*, no el diseño línea a línea.

## 3 · Ingeniero

Lánzalo con la ruta y la instrucción de seguir `plan.md`. Devuelve código, tests e `implementacion.md` con la verificación ejecutada.

Si el informe trae desviaciones del plan que afectan al diseño, vuelve al arquitecto (o decide tú si es menor) antes de pasar a QA.

## 3.5 · Limpieza y endurecido

Antes de llamar a QA, dos pasos baratos que evitan una vuelta entera:

- **Cleaner**: invoca la skill `/simplify` sobre el diff. El código recién escrito casi siempre tiene una abstracción de más o una duplicación que se ve mejor en frío.
- **Hardener**: si el cambio toca módulos puros, `cd nefan-core && npm run mutate -- --cambiado`. Un mutante que sobrevive en código nuevo es un test que no comprueba lo que dice comprobar. Los supervivientes vuelven al ingeniero, no a QA.

## 4 · QA

Lánzalo con la ruta. Devuelve `qa.md` con veredicto.

- **Apto** → paso 5.
- **Hallazgos** → reanuda al **mismo ingeniero** con `SendMessage` (conserva su contexto: mucho más barato y sin re-lectura) pasándole los hallazgos concretos. Después, QA re-verifica *solo* los criterios afectados más una pasada adversarial nueva.
- Dos vueltas sin cerrar: para y consulta al usuario. Un bucle QA↔ingeniero que no converge suele significar que el requisito está mal escrito, no que el código esté mal.

## 5 · Cierre

Resume al usuario en la conversación: qué se hizo, qué demuestra que funciona, qué quedó fuera y el backlog de mejoras estructurales que propuso el arquitecto. No commitees ni abras PR salvo que se pida.

Si el cambio ha movido la arquitectura de sitio, vale la pena una **segunda pasada del arquitecto** sobre el código ya escrito (su prompt la contempla): qué ha quedado torcido, qué frontera nueva merece entrar en `nefan-core/data/contract/arch-rules.json`. Se juzga mejor sobre el código que existe que sobre el que se imaginó.

## Cuándo NO usar esto

Cambio de una línea, typo, ajuste de color, pregunta. El ciclo cuesta cuatro contextos: si el trabajo es menor que su coordinación, hazlo tú y ya.

## Paralelismo

Crítico → arquitecto → ingeniero → QA es una cadena; no la paralelices (y el crítico va primero justamente para que los otros tres no se gasten en balde). Lo que sí puede ir en paralelo (un solo mensaje con varias llamadas a `Agent`) es la **exploración previa**: varios `Explore` sobre subsistemas distintos para alimentar `requisitos.md`.
