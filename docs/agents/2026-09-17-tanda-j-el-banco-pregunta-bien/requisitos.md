# Requisitos — Tanda J «El banco pregunta bien»

## La petición

Cita literal del usuario (2026-09-17):

> «Hay 48 issues abiertos, ve cerrando sin parar, si tienes bloqueo en alguno lo apuntas pero sigue
> hasta reducir el numero al minimo»

## Los tres issues

Los tres son **del banco de QA**, los tres los medí yo hoy sitio a sitio al cerrar la tanda H, y
**ninguno toca código de producción**. Por eso van directos a ingeniero: la crítica de cada uno está
hecha con medida fresca y está escrita en el cuerpo del issue.

| Issue | Qué |
|---|---|
| **#651** | Los guiones 118, 119 y 128 preguntan con `probeCollide` (MOVIMIENTO) donde quieren un PUNTO |
| **#653** | El guion 120 saca su evidencia del log COMPARTIDO de la corrida y se queda con la primera línea |
| **#655** | Tres guiones de `qa/guiones/` no tocan el navegador y solo los corre la batería local |

## #651 · seis sitios quieren punto, uno no

Medido sobre `main` = `e5cdebb5`, sitio a sitio:

| Guion | Sitios | Cuáles | Aparca |
|---|---|---|---|
| **118** | 3 | `fotoDelSuelo` (`:171`), `sondear` (`:211`), `paredMedida` (`:217`) | no |
| **119** | 3 | `paredMedida` (`:114`), solidez por caja (`:276`) — y `caminoALaBolsa` (`:342`), que **SÍ es movimiento** | `setPlayerPos` en `:187`, para una captura |
| **128** | 2 | `fotoDelSuelo` (`:139`), `sondear` (`:172`) | no |

**`caminoALaBolsa` NO se toca.** Recorre el segmento del jugador al objeto preguntando si hay paso: ahí
el origen vivo **es** el sujeto, igual que `state().blocked` del hook (`nefan-hook.ts:213`), que también
es correcto por diseño. Déjalo escrito en el guion para que nadie lo «arregle» mañana.

**El peor es `paredMedida`** (118 y 119): mide el ancho de una caja andando desde su centro hacia los
cuatro ejes hasta que deje de bloquear, preguntando «¿puedo llegar ahí desde donde estoy?». Con el
jugador dentro de esa caja da **0 en los cuatro ejes**.

**Cuidado al cambiar**: los tres guiones comparan **DELTAS** y sus cabeceras explican que lo hacen
*precisamente porque* sabían que `probeCollide` no es un mapa del suelo. Esa explicación **caduca** con
el arreglo: hay que reescribirla, no dejarla. Y hay que volver a correr los tres.

## #653 · una línea, y un principio

`qa/guiones/120-el-anillo-bueno-no-se-pierde.mjs:226`:

```js
const criba = readFileSync(logBridge, "utf8").split("\n").find((l) => l.includes("se CRIBA"));
```

`logBridge` sale de `QA_RUN_TMP`, que es el disco efímero de **la corrida entera**. El `.find` coge la
**primera** línea «se CRIBA» del fichero, y el aserto exige que contenga los ids del 120 — así que
cualquier guion anterior que cribe le roba la evidencia. Latente porque 120 < 127 en orden alfabético;
reproducido con `node qa/run.mjs --orden inverso 127 120`.

Arreglo: filtrar por lo suyo (`MALO`/`npcRoto`) o `findLast` tras provocar la criba. **La regla general
que hay que dejar escrita**: el disco es compartido por diseño, así que no puede ser «no lo leas» sino
**«no des por tuya una línea que no has marcado»**. Mira si hay más lecturas de `QA_RUN_TMP/logs/` con
el mismo patrón.

## #655 · decisión de diseño, y tiene trampa

Tres guiones no tocan navegador ni motor (medido por lo que usan de `ctx`): **39** y **40** (solo
`expect`/`log`) y **146** (además `sinMedir`, `afirmaciones`, `fallos`). El 01, el 03 y el 56 sí, con
`ctx.nefan` y `ctx.shot`.

El censo de #645 **no los alcanza**, y por una razón que hay que entender antes de tocar nada: los
guiones **no importan `playwright`, lo reciben inyectado por `run.mjs`**. Un detector por imports los da
a los 145 como «sin navegador», que es lo contrario de la verdad.

Las dos vías, con su peaje:

1. **Moverlos a `qa/` (la raíz)**: heredan el candado de totalidad de #645 tal cual, pero **pierden el
   `ctx` del runner** — y `ctx.expect` es donde #639 acaba de poner el contador de afirmaciones, así que
   **saldrían también del candado del veredicto**. Sería la enfermedad de la casa otra vez: mover algo a
   un sitio mejor vigilado y dejarlo sin el candado que tenía.
2. **Que el job aprenda a correr un guion suelto**: `node qa/run.mjs 39` ya funciona (los filtros son
   posicionales), pero levanta el preset entero, que es justo lo que los hace caros sin necesidad.

**Decide tú con medida y declara la desviación si eliges otra.** Antes de meterlos en CI, **cronométralos**
(el criterio que ya se usó con los nueve exentos de #645).

## Criterio de cierre

- Los seis sitios de #651 preguntando por punto, `caminoALaBolsa` intacto y con su motivo escrito, y los
  tres guiones **re-corridos** en verde.
- El 120 sacando su evidencia de lo suyo, y **probado en negativo**: con `--orden inverso 127 120` sale
  verde ahora y salía rojo antes.
- Los tres guiones de #655 corriendo en CI o con la desviación declarada y medida.
- `npm run verify` verde, ningún umbral bajado, batería sin rojos nuevos.

## Restricciones

- **Cero créditos**: motor falso, `e2e-sin-creditos`, `html-fixtures`.
- **No pares ni arranques nada ajeno.** `NEFAN_PORT_OFFSET=800 ./start.sh --preset <slug>` desde TU árbol
  (`/home/al/code/ne-fan-j-banco`), y `NEFAN_PORT_OFFSET=800 ./start.sh --parar` desde el mismo árbol.
  **Nunca `--parar-todo`, nunca `pkill`, nunca matar por puerto.** Hay otros agentes en la máquina.
- El fichero de salida de una corrida larga lleva el nombre del worktree: `bateria-j.log`.
- Una retirada incluye prosa y comentarios: `grep` a cero.
- **Commiteas, no empujas ni abres PR.** Eso lo hace el coordinador.
- Si algo de esto es falso al medirlo, **dilo con el número que lo tumba**.
