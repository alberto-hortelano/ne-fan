# Requisitos — Tanda N «El banco se mide a sí mismo»

## La petición

Cita literal del usuario (2026-09-17):

> «Hay 48 issues abiertos, ve cerrando sin parar, si tienes bloqueo en alguno lo apuntas pero sigue
> hasta reducir el numero al minimo»

## Los tres issues

Los tres son **deuda del banco de QA sobre sí mismo**: una espera sin dueño, un guion que mide una sola
rama de lo que promete, y una intermitencia que se quedó huérfana.

| Issue | Qué |
|---|---|
| **#606** | `esperarFrames` está **copiado en seis guiones**: la única espera por fotogramas de la batería no tiene dueño en `qa/lib` |
| **#637** | El guion 82 mide **solo la rama «el skin anterior falló»**: empezar partida con la armadura del personaje anterior **sale verde** |
| **#634** | La intermitencia del guion **75** se quedó sin dueño: sus tres issues están cerrados (#467 como `not_planned` y #496 esa misma tarde) |

## #606 · el hecho está confirmado y su justificación es HOY más fuerte

Confirmado al abrirlo: **6 copias de `esperarFrames`, 22 llamadas**. Y `reloj()` ya está en el hook
(`nefan-hook.ts:262`) y lo usan 6 guiones y 2 módulos de `qa/lib/`, así que la casa a la que mudarlo ya
existe y ya tiene candado (`banco-medido.json`: todo `qa/lib/*.mjs` lo importa un test o está eximido con
motivo, dirección test → banco).

**El peaje que lo tumbó la última vez y sigue ahí**: toca `qa/lib/` **y seis guiones de navegador**, o
sea **re-correr la batería** para probarlo. Cuéntalo antes de empezar.

## #637 · un aserto que solo puede ir en una dirección

El guion 82 vigila que volver al título no te haga pagar una imagen por un mundo que ya no existe. Con
`aspecto.desvestir()` quitado —el defecto que existe para cazar— salía **VERDE**, porque `requestSkin`
es idempotente por prompt: solo mide algo si el skin anterior quedó `failed`. La tanda F le puso esa
condición **inyectada** por el propio guion, como el 51. Lo que #637 dice es que **la otra rama sigue sin
medirse**: que el jugador de la partida nueva aparezca con la armadura de la anterior **es alcanzable y
no lo mide nadie**.

## #634 · el que puede estar bloqueado, y hay que decirlo

La crítica de la tanda H ya lo miró y dejó escrito: **su opción (a) edita `src/protocol/escena-servida.ts`**
(vía `tile-store.ts:20,99` → `huellaDeEscena`), un módulo con **suelo 100**; su opción (b) **no se abarata
con #639** y hoy es inexpresable —el 75 declararía ⊘ *después* de fallar, y `run.mjs:1266`/`:1320` lo
mantienen ROJO a propósito («un ⊘ es una declaración, no una amnistía»); y su opción (c) **es el statu
quo**: el issue abierto ya ES el sitio donde anotar.

**Si al medirlo sigue así, dilo y NO lo fuerces.** Un bloqueo apuntado con su motivo vale más que un
arreglo que rompe un suelo de 100. El usuario ha pedido explícitamente: «si tienes bloqueo en alguno lo
apuntas pero sigue».

## Lo que el crítico tiene que decidir

1. **¿#606 cabe?** Su coste real es la batería, no el código. Mide cuánto tarda y dilo.
2. **¿#637 se arregla en el 82 o en un guion nuevo?** Ojo a la lección de la tanda F: **tres guiones (27,
   82 y 92) compartían el punto ciego** y los tres salían verdes con media PR revertida. Si el arreglo es
   «un aserto más en el 82», comprueba que no comparte ceguera con sus vecinos.
3. **¿#634 entra o se declara bloqueado?** Con su motivo y su medida.

## Avisos de la casa, todos cobrados en las últimas cuatro tandas

- Un candado puede **cubrir menos de lo que promete** — y también **más**.
- Un candado puede fallar por **circularidad** (su límite se deriva de lo que está bajo prueba).
- Un candado puede quedarse **sin sujeto vivo** tras arreglar lo que venía a vigilar.
- Un aserto con **N = 1** no distingue una regla de su contraria.
- **Un guion puede quedarse verde sin poder ponerse rojo por un arreglo AJENO Y CORRECTO** (el 82 es
  literalmente ese caso).

## Restricciones

- **Cero créditos**: motor falso, `e2e-sin-creditos`, `html-fixtures`.
- **Bloque de puertos 1200**: `NEFAN_PORT_OFFSET=1200 ./start.sh --preset <slug>` desde el árbol
  `/home/al/code/ne-fan-n-banco2`, y `--parar` con el mismo offset desde el mismo árbol. **Nunca
  `--parar-todo`, nunca `pkill`, nunca matar por puerto.** Hay otros agentes trabajando.
- **Otra tanda está tocando `qa/` a la vez** (guiones 118, 119, 120, 128 y posiblemente `run.mjs`). **No
  toques esos cuatro guiones ni `run.mjs`**: si tu arreglo los necesita, dilo en vez de editarlos.
- Log de corrida larga: `bateria-n.log`.
- Solo se commitean `requisitos.md`, `critica.md` y `qa*.md`.
