# Requisitos — quedarse solo con la vista 3D (retirar oblicua y proscenio)

## 1. La petición, literal

> «La vista proscenio y la top down dan demasiados problemas, vamos a quedarnos solo
> con la vista 3d. En principio la de three, eliminando tambien la godot pero la godot
> tiene algunas cosas interesantes en cuanto a la generacion procedural que se podrian
> integrear en la de three. De momento simplemente elimina completamente las dos vistas.»

Contexto de la frase: el usuario venía de una tanda en la que se retiró la variante
"escena suelta" de Format D (rama `refactor/retirar-escena-suelta`, issue #172). Al
explicarle que el bloque `stage` seguía vivo porque lo usaba el proscenio, decidió
retirar las dos vistas enteras.

## 2. Qué significa "las dos vistas"

- **Oblicua / overworld** (`view: "overworld"`, `ClientView === ""`): suelo cenital sin
  proyectar + cizalla en la altura, renderer `nefan-html/src/renderer/canvas-renderer.ts`,
  pipeline de imagen IA de repintado del tile completo.
- **Proscenio** (`view: "proscenium"`): plató de cine con cámara de raíl, renderer
  `nefan-html/src/renderer/proscenium-renderer.ts`, bloque `stage` de Format D, módulo
  `nefan-core/src/scene/stage/**`, pipeline de clay + segmentación + pelado por capas.

**Sobrevive**: la vista `fps` (primera persona, three.js, atlas de superficies por celda).

**NO entra en esta tarea**: retirar el cliente Godot. El usuario lo aplaza explícitamente
("de momento") y quiere rescatar antes su generación procedural hacia three. Godot no
conoce el bloque `stage` ni el concepto de vista (cero referencias en `godot/**`), así que
no se ve afectado. Va a issue propio.

## 3. Decisiones tomadas por el usuario (preguntadas y respondidas)

1. **Assets de estilo**: se borran las carpetas de referencias `overworld/` (41 imágenes)
   **y** `proscenium/` (37 imágenes) de los 5 packs, más `_staging/` y las semillas de
   `_plantilla/`. Acepta gastar créditos en regenerar lo que haga falta.
2. **Labs**: se borran los tres que quedan sin sujeto — `labs/stage` (354 MB),
   `labs/escenografia` (45 MB, salidas commiteadas a propósito) y `labs/render` (48 MB).
   Esto es material histórico de sesión y CLAUDE.md exige confirmación: está dada.
3. **Huecos de la fps**: se cierran **en este mismo ciclo** los tres que rompen
   jugabilidad — telegraph del ataque en mundo, etiquetas de nombre de NPC/objeto y
   feedback visual de frontera (velo direccional + flash).
4. **Rama en vuelo**: primero se completa el viaje por anclaje a tile sobre
   `refactor/retirar-escena-suelta` y se mergea; el borrado arranca desde un main sano.

## 4. Criterios de aceptación

1. El juego arranca y se juega **solo en primera persona**. No hay selector de vista en
   el título, ni renderer oblicuo, ni plató.
2. Format D tiene **una sola variante**: el tile. El bloque `stage` no existe en el zod,
   ni en su espejo Python, ni en el contrato de la tool, ni en los prompts.
3. **`grep -rn` a cero** de `WORLD_VIEWS`, `WorldView`, `world.view`, `viewForRefFile`,
   `styleViews`, `branchForView`, `data-view`, `proscenium`, `overworld`, `stage_request`,
   `ortho_shear` — fuera de los ficheros históricos que se declaren. El token `view` a
   secas NO vale como criterio: `derived_views` de plugins y
   `GET /plugins/{id}/inspect?view=` son otra cosa.
4. Un solo contexto WebGL en la pestaña. `grep three` en `nefan-html/src` solo da
   `fps-gl.ts`.
5. **El arte fps ya pagado sigue siendo alcanzable**: el `layout_key` del atlas de
   superficies no cambia. Es el riesgo caro de la operación (ver §5).
6. En primera persona se ve: el telegraph del ataque antes del impacto, el nombre del NPC
   con el que vas a hablar, y el aviso de que el tile vecino se está generando.
7. El panel "Salidas" lleva a un tile real, con el jugador colocado donde toca.
8. Los guiones de QA supervivientes en verde sobre el preset 5 (0 créditos), conduciendo
   el canvas WebGL en headless — no es un rename de fixture.
9. Los candados (`arch-rules.json`, umbrales de `quality-thresholds.json`) reaprietados
   sobre lo **medido**, y probados en negativo.

## 5. Restricciones duras

- **No tocar el cuerpo** de `src/scene/blueprint/ground-prims.ts`, `greybox/volume-prims.ts`
  ni del futuro `blueprint/footprint.ts` durante toda la operación: solo su ubicación. El
  `layout_key` del atlas fps es `sha256(canonicalSurfaceLayoutJson(buildLayout(primsM)))`
  y `buildLayout` asigna `primIndex` recorriendo `primsM` **en orden**. Mover una prim de
  sitio, o que un helper que emigra redondee distinto, rota la clave: el juego funciona,
  se ve igual, y cada tile vuelve a pagar sus superficies con el arte viejo inalcanzable
  en `localStorage`.
- **Pre-producción, cero compatibilidad hacia atrás** (CLAUDE.md): lo que se sustituye se
  borra el mismo día, entero y en todos los procesos. Los saves no importan.
- **Coste de verificación**: `npm run mutate` completo son ~16 min saturando la CPU del
  usuario. Va **acotado al módulo tocado** (`npx stryker run --force --mutate <fichero>`).
  Antes de lanzar algo largo, avisar de cuánto tarda. Reportar tiempos reales al entregar.
- El orden de desmontaje no es libre: la oblicua cuelga del proscenio (el singleton
  three.js lo posee `stage-greybox-render.ts`), y la fps cuelga de las dos.

## 6. Fuera de alcance

- Retirar Godot y rescatar su generación procedural a three (issue propio).
- Sustituir el pipeline de imagen que muere por uno nuevo: la fps ya tiene el suyo
  (atlas de superficies por celda).
- `generate_scene.json` y `scene_instructions.md` fuera de `CONTRACTS`, sin guardia de
  deriva (issue propio, ya detectado en la tanda anterior).

## 7. Plan de referencia

El coordinador dejó un plan de ejecución con 13 PRs, el orden de desmontaje y los cinco
riesgos en `/home/al/.claude/plans/es-lo-primero-no-eager-storm.md`. El arquitecto puede
apartarse de él si encuentra algo mejor, pero debe decir en qué y por qué.

## 8. Apunte de datos locales (detectado al cerrar la tarea anterior)

Dos snapshots de mundo en disco —`cuentos_oscuros` y `toledo_1200`— declaran
`place_id: "taberna_bench_place"` con un `world_map` que solo contiene `world`: al
replayarlos, el panel de salidas sale vacío. Son artefactos locales no versionados
(`data/games/*/world/` está gitignoreado). La PR que edita esos cuatro `tile.json` para
quitarles `branch` y `style_ref` debe **limpiar también ese `place_id` huérfano** en la
misma pasada, y decirlo en la descripción de la PR — porque al estar gitignoreados, la
edición no sale en ningún diff y el CI no la ve.
