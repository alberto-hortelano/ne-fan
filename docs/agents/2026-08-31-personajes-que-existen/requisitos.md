# Requisitos — Personajes que existen (#216 + #255)

## Petición del usuario (literal)

La petición de fondo de la serie es:

> «Vamos a seguir priorizando reducir el numero de issues»

Sobre la hoja de ruta aprobada tras el triaje del 2026-08-30, el usuario arrancó esta tanda con:

> «Adelante con la tanda 4»

La tanda 4 es: **«Personajes que existen» — #216 + #255**. El emparejamiento está escrito en
los comentarios de ambos («vecino de tanda natural»): comparten ficheros y verificación.

## El problema real (una frase)

El título ofrece siete modelos base escritos a mano de los que en esta máquina solo uno tiene
hojas completas —elegir cualquiera de los otros seis cae a `y_bot` con una línea de log—, el
estado por defecto nombra a un octavo (`"pete"`) que ni está en la lista ni tiene hojas, y
mientras tanto #255 (el clon limpio) tiene sus dos puntos **ya entregados con candado** sin que
el issue lo sepa.

## Fuentes de verdad

Cuerpos + comentarios de #216 y #255 (reencuadre del 23-08, encogimiento del 24-08, citas
rehechas del 28-08, auditoría del 30-08):

```bash
gh api repos/alberto-hortelano/ne-fan/issues/216 --jq '.body'
gh api repos/alberto-hortelano/ne-fan/issues/216/comments --jq '.[].body'
# ídem 255
```

## Medido HOY sobre `5101bc0` (correcciones a los issues incluidas)

### #216 — la lista a mano sigue, y el matiz que los comentarios no dicen

- `MIXAMO_MODELS` (7 modelos, con nombre legible cada uno): `nefan-html/src/ui/title-screen.ts:80-88`,
  pintada en `:1309` dentro de `renderCharacterEditor`, enviada como `appearance.model_id` en
  `:1353`. **Único uso en el repo** — la cita `:76`/`:1310` de la auditoría se movió 4 líneas.
- En disco (`nefan-html/public/sprites/`): `y_bot` completo (10 anims) y `paladin` **solo
  `idle`** — set incompleto, así que paladin TAMBIÉN cae a `y_bot`. Hoy mienten **6 de 7**
  opciones en esta máquina; en un clon limpio, las 7 (y ahí ya salta el fail-loud de #255).
- El fallback es deliberado y silencioso-suave: `setPlayerAppearance` (`main.ts:117-142`)
  prueba las 10 anims secuencialmente, aborta al primer fallo y deja UNA línea
  (`modelo "X" sin sheets completos — base y_bot`). El comentario del código ya lo declara
  no-error («el skin IA es la vía canónica de personalización»).
- El defecto del estado: `model_id: "pete"` en `nefan-core/src/narrative/narrative-state.ts:105`,
  fijado por **un** test (`test/narrative-state.test.ts:179` — las citas `:104`/`:113`/`:393`
  de los comentarios caducaron). En resume se confía el `model_id` del save verbatim y cae a
  base si no hay hojas (`main.ts:2939-2943`).
- En modo `character_mode: "image"` los skins se generan siempre sobre `BASE_MODEL` = `y_bot`
  (`character-sprites.ts`, `modelFor`) — pero (crítica) el modelo elegido NO es del todo
  irrelevante: `modelFor` (`character-sprites.ts:265-282`) lo usa como base de respaldo
  mientras el skin no está listo o falla. Ocultar el desplegable en modo image no es coste
  cero en cuanto otro modelo tenga hojas. El desplegable se muestra igual en ambos modos
  (gated solo por `CONFIG.graphics.character_sprites`).
- **Mecanismo existente**: `GET /sprite_catalog` (`ai_server/routers/remote_generation.py:466`)
  reexpone `/catalog` de sprite-forge, que incluye `models[]`; 503 fail-loud si sprite-forge no
  responde. El fake lo sirve **leyendo del disco** (`labs/narrative/fake-ai-server.ts:516-537`),
  con `SKIN_SPRITE_MODEL ?? "paladin"` como único modelo. `style-apply.ts:197` ya lo consume
  (para COSTE de skins).
- **OJO — el matiz que ningún comentario de #216 dice**: el catálogo publica qué puede
  renderizar EL SERVICIO (aquí sprite-forge tiene ~20 modelos en sus assets); el desplegable
  promete hojas que el cliente carga de los ESTÁTICOS `/sprites/**` (`SpriteRenderer` con
  `baseUrl "/sprites"` — los modelos base NUNCA llegan por remote-gen). Son dos verdades
  distintas: derivar el desplegable SOLO del catálogo repetiría la mentira con otra fuente.
  La verdad de «ofrecer» es el set COMPLETO cargable por el cliente; de dónde salen los
  candidatos y cómo se comprueba (sondear estáticos, manifest que escriba el productor en
  `--out`, endpoint del dev-server…) lo decide el arquitecto.

### #255 — HECHO ENTERO sin que el issue lo sepa (verificar y cerrar)

La auditoría del 30-08 lo declaró desbloqueado y describió el trabajo restante **sin comprobar
que ya había aterrizado** (tanda «los estáticos que mienten», 25-08 — misma especie que el
censo del 30-08 llamó «medio hecho sin decirlo», aquí hecho entero):

- Punto 1 (documentar el comando): `docs/assets-de-personaje.md` existe, versionado, citado
  desde el README raíz. Hecho el 25-08 (`006f4f8`).
- Punto 2 (la ausencia se nota y dice qué hacer): el preload del set base falla ruidoso con
  código `FALLO_HOJAS_BASE` y el motivo concreto `HTTP 404 on /sprites/…`
  (`character-sprites.ts:117-138`); `motivoDeSesionParaElJugador` lo traduce al jugador
  nombrando el remedio (`status-labels.ts:250-256`: «genéralas con sprite-forge siguiendo
  docs/assets-de-personaje.md»); el error-log del cliente registra la línea accionable la
  última para que se lea primero (`main.ts:196-207`).
- **Con candado**: `qa/guiones/27-el-clon-limpio-quiere-jugar.mjs` — nació ROJO el 25-08 por
  exactamente estos asertos, probado en negativo, y está en la batería (verde en las corridas
  de las tandas 2 y 3).

Lo que queda de #255 es **verificación y cierre honesto**, no código: correr el guion 27 a
HEAD, escribir en el issue qué commit entregó cada punto, y cerrarlo. Si la verificación
encuentra un hueco real (p. ej. algo del mensaje que el candado no sujeta), se arregla aquí.

## Criterios de aceptación (deben poder nacer rojos)

1. **Ofrecer un modelo es consecuencia de tener su set COMPLETO de hojas cargable por el
   cliente**, no una lista que alguien recuerda actualizar. Con el disco de esta máquina el
   desplegable ofrece exactamente `y_bot` (paladin, con solo `idle`, NO se ofrece). Hoy nace
   rojo: ofrece 7.
2. **La lista a mano muere**: `grep -rn 'MIXAMO_MODELS' nefan-html/` → 0. De dónde salen los
   nombres legibles del desplegable lo decide el arquitecto (derivarlos del id vale).
3. **`"pete"` muere**: `grep -rn '"pete"' nefan-core/ nefan-html/ labs/` → 0 (sin filtro de
   extensión — la crítica cazó `labs/narrative/README.md:81`, que manda `"model_id":"pete"` en
   el ejemplo curl de `start_session`; el ejemplo se actualiza con el defecto nuevo). El
   defecto de `appearance.model_id` pasa a lo que decida el arquitecto (`""` o `BASE_MODEL`),
   con la decisión escrita; `narrative-state.test.ts:179` se actualiza con el cambio, no se
   borra la aserción.
4. **La honestidad del desplegable tiene candado ejecutable**: un guion de QA (o test) pone el
   desplegable frente al estado real de las hojas — con las hojas de un modelo ausentes o
   incompletas, ese modelo no se ofrece; probado en negativo (poner/quitar la condición y ver
   el rojo). Hoy nace rojo: no existe.
5. **El modo image queda decidido, no callado**: en `character_mode: "image"` los skins van
   siempre sobre `y_bot`, pero el modelo elegido sirve de base de respaldo mientras el skin no
   llega (`modelFor`). El plan declara qué hace el desplegable en ese modo (ocultarlo,
   anotarlo o dejarlo con su porqué escrito), pesando ese respaldo — silencio no vale.
6. **La derivación falla con canal, no sola**: si el mecanismo de derivación falla durante el
   título (estático que no responde, manifest corrupto…), el fallo va por el canal de errores
   del cliente (`errors.push`) o degrada DICIÉNDOLO — no cae en el hueco de #306 (errores que
   saltan sin canal durante el título). El plan lo declara.
7. **#255 se cierra con verificación**: guion 27 verde a HEAD (corrida de esta tanda), y el
   cierre en GitHub cita qué entregó cada punto y su candado (commits medidos por la crítica:
   `006f4f8` doc, `376dbaa` fail-loud + guion 27 nacido rojo vía PR #277, `fb17840` refinado
   vía PR #281). Cero código nuevo si la verificación no destapa hueco.
8. `npm run verify` verde; batería `node qa/run.mjs` con los mismos verdes que la base (el
   título cambia — los guiones de sesión la ejercitan); deuda sin crecer; PR con `Closes #216`
   y `Closes #255` (uno por línea, en inglés).

## Fuera de alcance

- **Generar o versionar las hojas que faltan** (licencia Mixamo: `.gitignore:53,59`; decidido
  y descartado en el reencuadre del 23-08, «no aplazado»).
- Rediseñar la creación de personaje más allá de que el desplegable diga la verdad.
- #217/#246 (cerrados; son el precedente del fail-loud de estáticos, no trabajo).
- Tocar sprite-forge (repo aparte) **salvo** que el mecanismo elegido por el arquitecto lo
  exija (p. ej. que `render` escriba un manifest en `--out`); en ese caso, con su propia
  verificación allí y declarándolo en el plan — y la verdad del desplegable sigue siendo lo
  que el CLIENTE puede cargar, nunca solo lo que el servicio dice tener.

## Decisión tomada (visto bueno del usuario, 2026-08-31)

**Adelante con la tanda entera tal como está corregida**: lista derivada de las hojas reales
(en esta máquina eso deja solo `y_bot` en el desplegable), `"pete"` muere, y **#255 se cierra
con verificación** (guion 27 a HEAD) dentro de esta misma tanda, sin código nuevo salvo que la
verificación destape hueco.

## Preguntas abiertas

Ninguna que bloquee. Decisiones del arquitecto, a declarar en el plan: fuente de candidatos y
mecanismo de derivación (estáticos sondeados / manifest del productor / endpoint dev); defecto
de `model_id` (`""` vs `y_bot`); trato del desplegable en modo image (criterio 5).

## Restricciones operativas

- Rama + PR; el hook `Stop` exige CI verde de la PR. El CI NO corre la batería de `qa/` — la
  batería se corre y reporta en local, sin presentarla como si el CI la avalara.
- Cero créditos: el fake sirve `/sprite_catalog` y `/skin_sprite_sheet`; la batería usa el
  preset `e2e-sin-creditos`.
- No matar procesos ajenos; `qa/run.mjs` elige bloque de puertos libre solo; para pruebas
  manuales, `NEFAN_PORT_OFFSET` libre.
- `gh` 2.4: espera de CI con `until ! gh pr checks <N> 2>&1 | grep -q "pending"; do sleep 30; done`.
- Tests/guiones obsoletos se borran con el cambio que los deja sin sentido, declarando la
  cobertura perdida.
