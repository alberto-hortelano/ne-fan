# Crítica — Tanda F «El banco vuelve a medir»

**REENCUADRADA.** Los seis rojos son reales y las tres causas están bien separadas. Pero la causa C
ya no es hipótesis (verificada abajo) y **no se arregla sola**: choca con el candado de #497, que
vive en el guion 82, así que necesita **decisión del usuario antes del plan**. La B pide menos de lo
que cree: la cobertura que se teme perder **ya la tiene el guion 51**. Y los dos rojos que la tanda
deja fuera no tienen issue abierto ninguno. **El problema real, en una frase:** doce PR entraron sin
correr la batería, y lo que dejaron son **dos arreglos cerrados (#537 y #497) que se anulan entre
sí** en el registro de errores, más cinco asertos viejos.

## 1 · Causa C verificada: UN mecanismo, dos momentos — y NO es el orden de `APLICADORES`

Reproducidos hoy (`node qa/run.mjs`, cero créditos, `main` = `ee788590`): **27** → `registro: 0
entradas, remedio en el DOM: false` con `corte {"peticiones":10,"conMundo":10,"sinMundo":0}`
(precondición verde); **92** → `timeout esperando: el registro recoge el aviso`.

- **92 — lo borra el `enter`.** `errors.push("session", res.avisoDeEstilo)` está **dentro** de
  `startSession` (`nefan-html/src/net/narrative-client.ts:288`), que se `await`ea en `main.ts:1255`;
  `session.enter(...)` viene después (`main.ts:1257`) y `porValor` dispara (`""` → id) → `clear()`.
- **27 — lo borra el `leave`.** El remedio lo escribe `renderer/aspecto-del-jugador.ts:85-88`; el
  `catch` de `unIntentoDeArrancar` añade la suya y llama a `session.leave()` (`main.ts:1356`) →
  `porValor` (id → `""`) → `clear()`. Se lleva las dos.
- **La pista de `requisitos.md` es un callejón**: los dos `push` van **fuera** de la transición, así
  que reordenar `errores` no arregla ninguno. Y el **candado de #497 hoy ni se ejecuta** (`82:204-209`).

## 2 · La pregunta de diseño: es **decisión del usuario**, y #497 ya escribió la alternativa

No hay respuesta canónica del dominio: el mismo `errors.push` recibe `session`/`narrative`/`scene`
(de la partida) y `sprite`/`config`/`bridge` (de la máquina), y `ErrorLog` no guarda de quién es
nada. #497 ya ofrecía las dos vías —«**vaciarlo o marcar la partida** al cambiar de sesión»— y se
tomó la primera sin decidir la otra. Y dos guiones VIVOS se contradicen: tras volver al título, el
82 exige que el error de la partida abandonada **desaparezca** (#497) y el 27 que el remedio **siga
escrito**. Hasta que se decida, el punto 1 («el guion se queda como está») **no es ejecutable**:

- **(a) Vaciar como hoy** y mover los `push` al lado bueno: barato, pero deja la regla en «cada
  emisor sabe en qué lado está», que es lo que falló dos veces el mismo día.
- **(b) Vaciar solo al `enter`:** cura el 27, **no cura el 92**, rompe el aserto vivo de #497.
- **(c) Marcar cada entrada (partida, o «de la máquina») y filtrar al pintar:** cura los dos y
  conserva #497; coste real: decidir de quién es un `push` sin sesión.

## 3 · Causas A y B: reescribir los asertos es correcto, con un matiz cada una

- **A · correcta.** `avisoDeCriba` devuelve `{message, detalleTecnico}`
  (`nefan-core/src/combat/criba-de-hostiles.ts:135-143`) y el `message` ya no lleva ids. Matiz: el
  aserto del 130 «los TRES con sus TRES motivos» lo escribió QA contra un mutante (colapsar los
  motivos): **re-apuntarlo a `detalleTecnico`**, único sitio donde los tres sobreviven.
- **B · correcta, y la cobertura NO se pierde.** `qa/guiones/51-…:143-146` **ya afirma
  `canceladas === fallidos.length`** con su propio 500 inyectado —justo lo del bloque D del 53— y
  los bloques A/B/C del 53 inyectan sus fallos, así que el rango entero del fusible #236 sigue
  medido. Lo exclusivo del bloque D era un **retrato del banco** («no juzga el arreglo»), y #627 lo
  cambió a propósito dejando candado de la conducta nueva (guion 139). **El punto 2 se encoge a una
  frase escrita, no a un guion nuevo.**
- **B, hallazgo que falta:** la *máscara* de los bloques A/B/C del 53 se justifica en su cabecera con
  «el motor falso solo tiene `idle` y contesta **500** a `walk`». **Ya es falso**: `animDelBanco`
  mapea a `idle` todo `HOJAS_BASE_ANIMS`, y `walk` y `run` están dentro
  (`nefan-core/src/contracts/sprite-census.ts:31-34`). La misma frase falsa está en la espera del 82.

## 4 · Alcance, y lo que falta

- **1 · sí, pero partido**: A y B son edición de guiones; C es decisión + producción, y juntos dejan
  al ingeniero parado. **A y B ya; C detrás del visto bueno.**  **2 · se encoge** (§3).
- **3 · las ocho filas de `qa/README.md`: SÍ, de esta tanda.** Los ficheros 135–142 existen y
  **ninguno** tiene fila (`grep` de su nombre = 0 en los ocho); «siete de los ocho sin prueba en
  negativo» es **exacto**: solo el 140 la declara (`140-…:4`). Pero no arrastres «revisar el README
  entero»: eso es un barrido aparte.
- **4 · la tecla `P`: SÍ, y es trivial.** `nefan-html/src/ui/panel-de-plugins.ts:48`
  (`e.key.toLowerCase() === "p"`) con `alPulsarTecla` —la puerta de JUEGO, no `dev-tools-input.ts`—, nacida hoy con #630 (`a12856ae`).
- **#39 no tiene issue. Ninguno** (cola abierta + búsqueda de `sinMotor`). El rojo de hoy basta: *«el exento que pulsa «Comenzar» se trae SU propio motor — **116-lo-elegido-vuelve-del-editor**»*.
- **#75: «es #467» es FALSO por dos lados.** #467 está **cerrado desde el 09-10**, a mano y sin
  commit; el que nombra al guion 75 por su número es **#496**, **cerrado hoy a las 14:47**; el guion
  cita #410, cerrado el 09-05. La intermitencia que se deja fuera «porque ya tiene dueño» **no lo
  tiene**: reabrir #496 o abrir uno.
- **Sin conflicto con trabajo vivo:** ningún issue abierto toca `session-facets`, `error-log` ni los
  guiones 27/53/82/92; #616 y #618 son disjuntos. **`main` se movió otra vez** mientras se escribía
  esto (`ee788590` → `88d3fe4e`): rebasar antes de dar nada por medido.

## El día después · coste contra valor

Se cierran 6 rojos, se abren 2 issues, la batería vuelve a 139/141 y #497/#537 recuperan candado
vivo. **La severidad no es la misma**: en el 27 el jugador YA recibe el remedio en el aviso del
título (sus tres asertos están verdes) y se pierde solo el REGISTRO; en el 92 el registro era el
único canal por decisión escrita (`narrative-client.ts:275-288`), y ahí se queda a ciegas. **No
hacer nada no es opción**: dos issues cerrados sin candado, y un registro que borra el diagnóstico
del fallo que acaba de ocurrir.

## Qué le cambiarías a `requisitos.md` (para pegar tal cual)

1. **Causa C**, en vez de «Hipótesis, NO verificada»: «**Verificado (crítico, 2026-09-16)**: un solo
   mecanismo en dos momentos. Al 92 lo borra el `enter` (el `push` va dentro de `startSession`,
   `net/narrative-client.ts:288`, antes de `main.ts:1257`); al 27, el `leave` del arranque fallido
   (`main.ts:1356`). **El orden de `APLICADORES` no interviene.** Y el candado de #497
   (`82:204-209`) exige lo CONTRARIO que el 27 — y hoy ni se ejecuta.»
2. **Lo que se pide 1**: «C necesita **decisión del usuario** antes del plan (§2 de `critica.md`);
   A y B pueden ir ya.»
3. **Lo que se pide 2**: «La cobertura NO se pierde: `51:143-146` ya afirma `canceladas ===
   fallidos`. Se pierde el bloque D del 53; y la frase «el banco contesta 500 a `walk`» de las
   cabeceras del 53 y del 82 es hoy FALSA y hay que corregirla.»
4. **Lo que NO entra**: «**#75** — intermitencia **sin issue abierto** (#467 cerrado el 09-10, #496
   hoy a las 14:47): abrir o reabrir. **#39** — tampoco tiene issue; el rojo señala al guion 116,
   que declara `sinMotor` y pulsa `#ts-start`.»
