# Tanda BY — Saltar

## Petición literal del usuario (2026-09-30, jugando la demo en `play`)

> «Tambien que pueda saltar. Por lo demas es un buen avance, sigue con lo que falta»

El mensaje llegó justo después de pedir un botón para terminar las conversaciones (tanda BX), pero «saltar» aquí es el **salto del jugador**. El «saltar» del diálogo (acelerar el texto) ya existe: la primera tecla completa el typewriter. **El crítico confirma esta lectura contra el contexto.**

## Hoy

- El juego es en primera persona, con three.js y WASD, Shift para sprint y la tecla E. **No hay salto.**
- CLAUDE.md dice: «La colisión NUNCA usa la altura (solo huella XZ).»
- La posición del jugador la decide el cliente («el cliente es autoritativo de su movimiento», en `terrain-collision.ts`).
- Espacio hoy avanza el diálogo cuando no hay opciones (`dialogue-panel.ts`).

## Lo que hay que decidir (crítico y arquitecto)

1. **¿Un salto que no salta nada?** Si la colisión es solo XZ, un salto sería solo visual: la cámara sube y baja. ¿Es eso lo que pide un jugador? Lo normal en un juego en primera persona es que el salto permita pasar por encima de lo bajo: una cerca, un banco o un murete. Eso exige que la colisión sepa la ALTURA de lo que bloquea, y hoy no la mira nunca, a propósito.
2. Si el salto pasa por encima de cosas, hay que ver qué se rompe:
   - el validador de jugabilidad, que da por buena una escena si se puede recorrer andando;
   - los NPC y el A* de #779, que no saltan;
   - el agua (`w`), que no debe cruzarse saltando, salvo decisión explícita;
   - la barra de aprendizaje de la tanda BV: las cercas finas que acabamos de hacer infranqueables (#788) pasarían a saltarse, y eso puede estar bien o mal.
3. La tecla: Espacio es lo canónico. Hay que ver el conflicto con el diálogo y con el ataque (LMB).
4. «Lógica en core, el cliente solo pinta»: la física del salto (altura y duración) es una regla de juego y vive en core.

**Criterio del coordinador**, sujeto a la crítica: el salto tiene que SERVIR para algo jugable, como pasar un obstáculo bajo, no ser solo un bote de cámara. Si el coste de hacerlo bien es desproporcionado, que el crítico lo diga con números y proponga el tramo mínimo honesto.

## Restricciones de la sesión

- NUNCA `git stash`.
- No matar servidores ajenos. **El usuario tiene un stack `play` corriendo en los puertos por defecto y está jugando**: no se toca. `qa/run.mjs` elige su propio bloque.
- No tocar el tag `mutacion-ultima` ni `reports/mutation/` del árbol principal.
- `bateria-n.log` es de otra sesión.
- Hay otras tandas en paralelo: BX (terminar conversación, `dialogue-panel.ts` y `start.sh`), BY (saltar), BZ (lo que ve el motor) y CA (#790). Si tu cambio pisa sus ficheros, dilo en tu informe.

## Ajustes tras la crítica (decisión del coordinador)

Se acepta el reencuadre: el salto es FUNCIONAL (pasa por encima de lo bajo) mediante un segundo grid del plan consultado solo en el aire; una sola constante de core para «bajo», compartida con el render de vallas; nada de contrato, bridge, save ni NPC. «Saltar» = salto del jugador (lectura del coordinador; se le informa y puede redirigir). Que saltar una cerca sirva para huir de un enemigo cuerpo a cuerpo se ACEPTA como consecuencia de juego. Se corrigen la frase de CLAUDE.md y el comentario de plan-collision.ts. Riesgo del dintel (PASO_LIBRE_M) en el apogeo: se mide y se resuelve. Las AABB de lo spawneado siguen macizas en el aire: se declara.


> **Alcance (tras la crítica).** El salto es del JUGADOR y pasa por encima de los volúmenes BAJOS del plan. «Bajo» es UNA constante de core, la misma que hoy decide qué `wall` se pinta como valla (`fps-detail.ts`, `h ≤ 2,4` celdas), y la altura de cada volumen sale de los defectos de `volume-prims.ts`, no de una tabla aparte. El agua (`ground`) bloquea siempre. Las cajas de objetos spawneados por el motor NO se saltan en este tramo (se dice). El bridge, los NPC, el A*, `scene-validate` y el save no cambian: el validador sigue garantizando «se recorre andando», que es una cota inferior. El comentario de `plan-collision.ts` y la sección «Altura» de CLAUDE.md se corrigen para decir que el jugador en el aire usa un segundo grid. La física del salto (altura, duración) vive en `combat_config.json`/core, y la tecla es Espacio (ya no la ve el mundo con el diálogo abierto). Decisión para el usuario: saltar una cerca te salva de un enemigo cuerpo a cuerpo. Riesgo que hay que verificar: con el apogeo del salto, la cámara no puede entrar en el dintel de un gate (`PASO_LIBRE_M`). NO se entrega un salto solo visual.
