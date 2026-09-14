# Tanda B · «Lo que el motor manda»

## De dónde sale

Del triaje del backlog del 2026-09-10, cuyas doce decisiones contestó el usuario el 2026-09-14.
Su mensaje literal al entregarlas: **«Mutacion corriendo, decisiones respondidas»**.

Las respuestas están en `docs/agents/2026-09-10-triaje-del-backlog/decisiones.md` y se citan
literales abajo. **No se reabren**: el crítico verifica premisas y hechos del código, no vuelve a
plantear la elección.

## Qué entra

### 1 · #532 — el contrato de `spawn_entity` no distingue una llave de un carro

Respuesta literal: **«- R: c»**, sobre estas opciones:

- (a) `spawn_entity` gana `footprint` opcional
- (b) gana `kind: "item"`
- **(c) ELEGIDA — las dos.** (Era la recomendada.) «Toca zod, espejo Python y tool JSON.»

Hoy **todo `object` que spawnea el motor es un muro sólido de 1,5 m**: una «bolsa de monedas» es un
muro que no puedes atravesar.

### 2 · #524 — los spawns se reparten a 1,8 m fijos sin mirar su huella

Estaba **bloqueado por #532** y por eso entra detrás en la misma tanda: el propio triaje lo dejó
escrito — «hacer #524 antes es escribir un test que #532 reescribe». Con las cajas sólidas de #489,
un reparto ciego a la huella puede dejar al jugador encajonado.

### 3 · #529 — un enemigo inválido tumba el FRAME entero

Respuesta literal: **«- R: a»**, sobre estas opciones:

- **(a) ELEGIDA** (era la recomendada) — «Se cae solo él, los demás entran, y el motivo vuelve al
  motor y al registro — es lo que el cliente ya hace.»
- (b) descartada — seguir tirando el frame entero pero con un modal que diga qué enemigo y por qué.

Hoy el bridge tira el frame completo con «Fallo interno del juego» mientras **el cliente, para el
mismo caso, solo descarta al enemigo malo**: dos criterios para el mismo hecho, y el que manda es el
más destructivo.

## Criterio de aceptación (del jugador, no del código)

1. El motor spawnea una bolsa de monedas y **se puede pasar por encima**; spawnea un carro y **no**.
   Lo decide lo que el motor declara, no el `kind` por defecto.
2. Con varias entidades spawneadas en un turno, el jugador **no queda encajonado**: el reparto mira
   la huella de cada una (#524).
3. Si el motor manda un enemigo inválido junto a dos válidos, **entran los dos válidos**, el malo no,
   y el motivo llega al motor y al registro de errores. Ningún modal de «Fallo interno del juego».
4. El criterio del bridge y el del cliente para «enemigo inválido» son **el mismo**, y hay algo que
   se pone rojo si divergen.

## Fuera de alcance

- Soltar `engaged` o la correa del enemigo (#377, etiquetado `futuro`).
- La economía del combate (#325, `futuro`).

## Avisos para el crítico

- Verifica los cuerpos contra el código de HOY: aquí los issues caducan en horas.
- El contrato viaja por TRES sitios y los tres tienen candado: el zod de
  `src/contract/model-io/`, su **espejo Python** y el **tool JSON** de `data/contract/tools/`. La
  lección de #466 (2026-09-10) es literal: `npm run verify` **no corre la suite de Python**, así que
  una divergencia del espejo sale verde en local y roja en CI. Correr
  `NEFAN_SPEND_DIR=$(mktemp -d) python -m unittest discover -s ai_server/tests`.
- Pre-producción, cero compatibilidad: un campo que se sustituye se borra el mismo día, entero y en
  todos los procesos (`grep` a cero), tests incluidos.
- `ObstaculoAabb.dueno` es obligatorio desde la PR 5 de #241: lo del tile responde como la base y
  **solo los spawns de runtime son sólidos**. Cualquier plan que toque la colisión tiene que decir
  qué pasa con esa distinción.
- **Cero créditos**: motor falso (`e2e-sin-creditos`) y fixtures.
