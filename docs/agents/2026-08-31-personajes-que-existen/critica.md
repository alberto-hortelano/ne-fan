# Crítica — Personajes que existen (#216 + #255)

**Veredicto: VIGENTE** — con dos correcciones menores al documento (un `"pete"` que el grep del
criterio 3 no caza, y una premisa del criterio 5 ligeramente exagerada). Ninguna cambia el alcance.

## El problema real, en una frase

El título promete 7 personajes de los que 6 son mentira en esta máquina (7 en un clon limpio) y
el estado por defecto nombra a un octavo sin hojas — la tarea ataca exactamente eso, y el cierre
de #255 que arrastra es verificación de trabajo ya entregado, no código.

## La premisa, verificada (todo medido por mí sobre `5101bc0`)

| Afirmación | Verificación |
|---|---|
| `MIXAMO_MODELS` 7 modelos, único uso | ✔ `title-screen.ts:80-88`, pintada `:1309`, enviada `:1353`. Grep repo-wide: 2 hits, ambos ahí. No hay más listas: `warrok/arissa/skeletonzombie/drake` solo aparecen en title-screen y en docs de agentes |
| Disco: `y_bot` completo, `paladin` solo `idle` | ✔ `ls public/sprites/`: y_bot 10 anims, paladin 1. 6 de 7 opciones mienten hoy |
| Fallback suave con una línea de log | ✔ `main.ts:117-142` (`setPlayerAppearance`, secuencial, aborta al primer fallo) |
| Defecto `"pete"` + un test que lo fija | ✔ `narrative-state.ts:105`, `narrative-state.test.ts:179`. Las citas viejas (`:104`/`:113`/`:393`) caducaron, como dice el documento. **PERO el censo del documento no es completo**: `labs/narrative/README.md:81` manda `"model_id":"pete"` en el ejemplo curl de `start_session` — fuera del grep del criterio 3 |
| Desplegable gated solo por `character_sprites` | ✔ `title-screen.ts:1305` (`spritesOn`), idéntico en ambos `character_mode` |
| Skins siempre sobre `y_bot` | ✔ `character-sprites.ts:19` (`BASE_MODEL`), `:177,:194,:275` (`skinKey(BASE_MODEL,…)`) |
| Matiz catálogo-vs-estáticos | ✔ **Correcto y es el acierto del documento.** Las hojas base salen SIEMPRE de estáticos (`sprite-renderer.ts:208,225`, `baseUrl "/sprites"`); remote-gen solo sirve skins (`:123`). El catálogo real publica capacidad del SERVICIO (`remote_generation.py:466`); el fake lo sirve del disco con `SKIN_SPRITE_MODEL ?? "paladin"` (`fake-ai-server.ts:118,516-537`) — un modelo que aquí solo tiene `idle`: derivar solo del catálogo ofrecería paladin y repetiría la mentira, literalmente |
| Resume confía el `model_id` del save | ✔ `main.ts:2939-2943` |

### #255 — confirmado HECHO ENTERO

- Punto 1: `docs/assets-de-personaje.md` existe, citado desde `README.md:62-70`. Commit **`006f4f8`**.
- Punto 2: `FALLO_HOJAS_BASE` con motivo concreto (`character-sprites.ts:117-138`), traducción con
  remedio (`status-labels.ts:250-256`), línea accionable la última (`main.ts:199-207`). Commit
  **`376dbaa`** (PR #277), guion 27 refinado en **`fb17840`** (PR #281).
- Candado: `qa/guiones/27-el-clon-limpio-quiere-jugar.mjs` existe, entra en la batería (run.mjs
  lee el directorio entero), aserta el remedio en el aviso al jugador (`:151`) y su cabecera
  documenta el nacimiento en rojo y la prueba en negativo. Cerrar con esos tres commits citados
  es exactamente lo que queda. Cero flecos encontrados.

## Los criterios nacen rojos de verdad

1–4 nacen rojos, medido (ofrece 7; 2 hits de `MIXAMO_MODELS`; 2 hits de `"pete"` en el scope del
grep; no existe guion de honestidad del desplegable). El 5 y el 6 no son rojos ejecutables —
son «decisión declarada» y «verificación+cierre» — y el documento los presenta honestamente como
tales. El grep del criterio 2 no caza nada legítimo; el del 3, ver corrección 1.

## El día después

- **Nada de QA depende de la lista de 7**: el helper solo pulsa `#ts-start` (`qa/lib/sesion.mjs:336-339`);
  los guiones 13/21/27 asertan estáticos de `y_bot`, no el desplegable. Ningún test fija los 7
  (nefan-html no tiene harness — #241). Los tests de core usan `model_id: "x"` arbitrario.
- **Desplegable de un elemento en modo vector**: ya adjudicado por el reencuadre del 23-08 («es
  lo que el jugador ya tiene, en silencio»); ninguna decisión viva lo contradice.
- **Saves con model_id muerto** (incluido `"pete"`): el resume cae a base con una línea — y la
  regla de pre-producción dice que los saves viejos no importan.
- **Riesgo real que el documento no nombra**: si la derivación falla (sondeo de estáticos que
  error-ea), ese error salta SOLO durante el título, que es exactamente el canal que #306 declara
  inexistente. No es conflicto — pero el plan no debe tragárselo en silencio (convención fail-loud).

## Conflictos

Ninguno bloqueante en los 27 abiertos. Adyacencias: **#306** (canal de errores del título — ver
arriba), **#326** (toca `main.ts` en resume, otras líneas), **#236** (character-sprites, la vía de
skins — esta tanda no la toca), **#340** (`src/narrative` fuera de la totalidad de mutación: el
cambio del defecto en `narrative-state.ts` no será medido por mutación — dato, no bloqueo).

## Coste contra valor

Barato: una derivación en el título, matar un literal y su test, cerrar un issue ya entregado.
Retira 6 mentiras visibles en la primera pantalla del juego y reabre la puerta ortogonal de la
«opción 1» (generar hojas de un modelo lo hace aparecer solo). No hacerlo deja dos issues vivos
que la prioridad del usuario pide bajar, uno de ellos ya hecho. Vale claramente lo que cuesta.

## Correcciones que pido a `requisitos.md`

1. **Criterio 3**: añadir `labs/narrative/README.md:81` al censo de `"pete"` — el ejemplo curl de
   `start_session` lo usa. Pegar al criterio: «y el ejemplo de `labs/narrative/README.md:81` se
   actualiza al defecto que decida el arquitecto (el grep con `--include='*.ts'` no lo caza)».
2. **Criterio 5 y § Medido**: rebajar «el `model_id` es irrelevante» en modo image. Es irrelevante
   para el skin (siempre sobre `y_bot`), pero `modelFor` usa el modelo ELEGIDO como base de
   respaldo mientras la hoja skinneada no está lista o ha fallado (`character-sprites.ts:265-282`:
   «y_bot salvo para un player con modelo alternativo completo en disco»). Ocultar el desplegable
   en modo image NO es coste cero en cuanto otro modelo tenga hojas: la decisión del criterio 5
   debe tomarse con ese dato encima de la mesa.
3. **Criterio 6**: citar los commits medidos aquí para el cierre de #255 — `006f4f8` (punto 1),
   `376dbaa` (punto 2 + guion 27 nacido rojo), `fb17840` (refinado del guion).
4. (Opcional, una línea en Preguntas abiertas): el fallo de la derivación durante el título cae en
   el hueco de #306 — el plan declara qué hace ese error, no lo silencia.
