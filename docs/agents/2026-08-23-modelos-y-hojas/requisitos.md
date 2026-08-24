# Los modelos base y sus hojas (#216 + #217)

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo que
> puedas con el flujo de agentes»

Y al reanudar la cola:

> «He reiniciado la sesion, ponte con los siguientes issues, si se modifica uno lo modificas y
> si se descarta simplemente pasa al siguiente y al final revisamos los descartados pero no
> pares la ejecucion de los demas a no ser que tengan dependencias y yo tenga que hacer una
> eleccion de direccion del producto.»

Tu veredicto no necesita permiso: REENCUADRADA reescribe el issue y sigue, OBSOLETA lo cierra y
pasa al siguiente. Solo se para si obliga a elegir dirección de producto.

## Por qué los dos van al mismo crítico

Son la misma avería vista desde los dos extremos. El propio #217 lo dice: *«es la forma en que se
manifiesta»* #216 — el cliente no falla al pedir la hoja, falla al parsear el HTML como JSON. Dos
críticos separados no verían que uno es el síntoma del otro.

## Reencuadre del crítico (2026-08-23)

Veredicto: **REENCUADRADA los dos. #216 NO se escala al usuario.** Ver `critica.md`.

### #216 — el desplegable

El desplegable de modelo base está escrito a mano en `nefan-html/src/ui/title-screen.ts:73-81` y
**no lo alimenta nada**. Las dos salidas del issue **no son alternativas**: las hojas son
per-máquina (`.gitignore:53`) y sus FBX no se redistribuyen (`.gitignore:59`), así que **ninguna
lista commiteada puede ser cierta en dos máquinas**. Ofrecer un modelo debe ser **consecuencia** de
tener su hoja; generar hojas sigue siendo posible después y las hará aparecer solas.

**No se escala al usuario**, y la razón está medida: hoy 6 de las 7 opciones **ya caen a `y_bot` en
silencio** (`nefan-html/src/main.ts:125-136` intenta las 10 anims y al primer fallo cae al maniquí
con una línea de log). Derivar la lista **retira 6 mentiras y 0 capacidades**. Además **sube el
techo**: `assets/characters/mixamo/` tiene **20** modelos y la lista a mano corta en 7.

Matiz honesto que el crítico deja escrito y que no cambia el veredicto: con `character_mode:
"vector"` el modelo base sí es la única personalización, y un desplegable de un elemento se ve
pobre — pero **eso es lo que el jugador ya tiene**, solo que en silencio. Con `character_mode:
"image"` el `model_id` es **irrelevante**: los skins se generan siempre sobre `y_bot`.

**Hallazgo extra: hay TRES listas a mano y discrepan** — `title-screen.ts:73`,
`tools/render-sprite-sheets/render.mjs:73`, y el defecto del estado en
`nefan-core/src/narrative/narrative-state.ts:72`, que es **`"pete"`**: ni está en las otras dos ni
tiene hojas, y lo fija `narrative-state.test.ts:113`.

**Borrar `MIXAMO_MODELS`; conservar el fallback de `main.ts:125-136`**, que sigue teniendo sujeto
por los saves portables. Reconciliar el defecto `"pete"`. Citar #212 si se toca `render.mjs:73`.

### #217 — más obsoleto de lo que yo sospechaba

**El cliente ya no es el problema, y mi sospecha iba corta en las dos direcciones.** Los cuatro
caminos fallan fuerte:

- `meta.json` valida content-type en `sprite-renderer.ts:222-224` (de `0308c8b`) y en
  `portrait.ts:147-148` (de **`3a0f517`**, no `0308c8b` — mi atribución era a medias).
- **Los PNG también son fail-loud**, al contrario de lo que yo decía: no hay `onerror`, pero sí su
  equivalente, y **lanza** — `sprite-renderer.ts:319-323`, `if (img.naturalWidth === 0)`. Por ahí
  pasa también el busto del retrato.
- Y el issue se equivoca al decir que el cargador valida «por accidente, al reventar el
  `JSON.parse`»: es un check **explícito** que nombra a Vite en su comentario.

**Lo único vivo es la última frase del issue**: bajo `/sprites/**`, `r.ok` **no puede ponerse rojo**,
y `qa/guiones/13-personajes-animados.mjs:41-46` ya lo esquiva a mano con un comentario. El trabajo es
que un estático inexistente devuelva **404** y que el guion pueda dejar de esquivarlo.
`nefan-html/vite.config.ts` no tiene `appType`, plugin ni middleware.

**No tocar los checks de content-type**: protegen el build y el asset-store, donde Vite no está.

## Criterios de aceptación de la tanda (para después de tu veredicto)

- El desplegable ofrece **exactamente** los modelos con set completo de hojas en esa máquina, y el
  que se elige es el que se pinta.
- Un estático inexistente bajo `/sprites/**` **falla**, y falla de forma que `r.ok` lo vea.
- Guion ejecutable en `qa/guiones/`, probado en negativo.

## Fuera de alcance

Generar y versionar las ~70 hojas queda **descartado por el crítico, no aplazado**:
`assets/characters/` está gitignorado por licencia, así que ni el generador se puede correr en CI.

## Veredicto del crítico

**REENCUADRADA los dos.** El caso de «quitarle una capacidad» quedó resuelto: no se la quita, porque
hoy no la tiene. **Ninguna pregunta para el usuario.** Ver `critica.md`.
