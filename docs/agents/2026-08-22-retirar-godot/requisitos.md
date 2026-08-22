# Retirar el cliente Godot, definitivamente

## La petición, literal

> «Lo de la generacion procedural es que en godot, por lo menos en un momento de
> las pruebas se podia llegar al final del tile y se generaba otro de forma
> procedural, encajando con la geometria de relieve del primero, algo muy comun en
> juegos 3d. Queria rescatar eso antes de eliminar godot pero si no hay nada
> interesante lo eliminamos ya. De todas formas hay mucha literatura sobre
> geometria y tiles procedurales y no se ajustaria a la generacion actual del mundo
> en three. **Elimina godot de una vez por todas, ya no aporta nada**»

Viene de la retirada de vistas de ayer (`docs/agents/2026-08-21-solo-vista-3d/`),
donde Godot quedó aplazado precisamente a la espera de esta respuesta.

## La premisa, contestada antes de empezar

**Esa generación procedural no existe en Godot, y lo que el usuario recuerda ya
está vivo en el cliente de three.** Verificado:

- En `godot/**` no hay `FastNoiseLite`, `GridMap`, `ArrayMesh`, `SurfaceTool` ni
  `HeightMap`. `godot/scripts/room/scene_builder.gd` son 95 líneas que montan **un
  `PlaneMesh` plano** y hacen `push_error("Godot no proyecta celdas")` si les llega
  Format D crudo. Godot nunca pidió un tile vecino: `request_tile` no está entre
  los 8 mensajes de `logic_bridge.gd`.
- Lo que sí existe, en **nefan-core**: `src/scene/tile-edges.ts` computa los cruces
  de cada borde (camino/carretera/río/puente) con coordenada espejo, el bridge los
  inyecta como `required_crossings` al pedir el vecino (`bridge/handlers/tile.ts`)
  y `validateScene` **rechaza** el tile que no los continúe (`scene-validate.ts`,
  tolerancia ±2 celdas, compatibilidad por tipo). El relieve continuo lo pone
  `src/scene/blueprint/fps-relief.ts` con ruido de valor sobre retícula GLOBAL
  —«así los tiles vecinos empalman sin costura»—, y es FPS-ONLY.

O sea: no hay nada que rescatar. Cierra el issue **#202**.

## Qué se pide

1. **Retirar el cliente Godot entero del repositorio**, con todo lo que solo
   existe para servirlo.
2. **Nada generado se borra del disco.** Enmienda permanente del usuario, ya
   aplicada en la tanda anterior: lo que sale del repo va a `archivo/` (gitignorada),
   nunca a la papelera.
3. **El repo no puede quedarse sin personajes.** Decisión explícita del usuario
   entre tres opciones: *«Portar el renderizador ahora»*. Los 28 MB de
   `nefan-html/public/sprites/` no están en git y su único generador es
   `tools/render_sprite_sheets.py` → `godot/scenes/dev/sprite_sheet_renderer.tscn`
   → 1,4 GB de FBX de Mixamo. Hay que **portar ese renderizador a three.js** antes
   de borrar nada, no archivarlo y confiar en que nadie necesite animaciones nuevas.
4. **Los benches Godot de `labs/` también salen.** Decisión del usuario:
   *«Archivar también»* — `labs/fps/godot`, `labs/authoring/godot` y
   `tools/render_sprite_sheets.py` van a `archivo/`, para que en el repo no quede
   una sola línea que dependa de Godot.

## Criterios de aceptación

- Un clon limpio del repo puede **producir las hojas de sprites de los personajes**
  sin Godot instalado. Se demuestra regenerando `y_bot/idle/frontal_8` con la
  herramienta nueva y comparándola con la actual (mismo `frame_count`, mismo
  encuadre y silueta), no con un «compila».
- El juego real arranca y se juega con personajes animados: `./start.sh` con un
  preset superviviente, partida, y los NPC/el jugador moviéndose.
- `grep` de `godot|gdscript|xvfb` a cero fuera de `archivo/` y de la documentación
  histórica que registra decisiones pasadas.
- `./start.sh` presenta su menú completo y **cada preset superviviente arranca**:
  al quitar dos servicios del catálogo cambian las máscaras posicionales, el preset
  1 «Play» queda idéntico al 2 «Story web» y el 3 «Automated tests» se queda sin
  sujeto. Verificar con la tecla `s` (status) que cada preset levanta los puertos
  que dice.
- Las instrucciones a subagentes (`.claude/agents/*.md`,
  `.claude/skills/final-check/`) dejan de mandar probar con `movement_test.py` bajo
  xvfb. Se leen con contexto limpio: si se quedan, hacen daño.
- `npm run verify` verde al cerrar cada PR.

## Restricciones permanentes del usuario

- **«Los comandos que se ejecutan de prueba tardan demasiado, hay que reducir esos
  tiempos o su uso.»** El comando más barato que demuestre lo que toca.
  `npm run verify` (~9 s) al cerrar un paso, no tras cada edición. Mutación
  **acotada al módulo tocado**, nunca la corrida entera (~10 min saturando la CPU).
  **Antes de lanzar algo largo, decir cuánto va a tardar**; al entregar, reportar
  los tiempos reales.
- **«No ejecutes nada, ya esta el procesador al 100% y lleva mas de 20 minutos
  asi.»** Vigilar la carga; no dejar corridas largas sin avisar.
- **No se gastan créditos sin autorización explícita del usuario.** Esta tanda no
  necesita ninguno.
