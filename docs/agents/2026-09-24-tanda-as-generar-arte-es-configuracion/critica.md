**REENCUADRADA** — el problema es real y más pequeño de lo que dice la interpretación en dos puntos (pruebas y partidas nuevas ya no gastan) y más grande en otros dos (los skins no tienen carril de «solo lo pagado», y el banco necesita generar contra el motor falso). Además hay una bifurcación que cambia QUÉ se construye y que tiene que decidir el usuario: la configuración como **techo** de «Imagen IA» o como **sustituto**.

## El problema real, en una frase

Qué arte paga el juego sin que nadie lo pida está decidido por dos literales de código (`MODO_AL_EMPEZAR` y el `activo &&` de `modoDeCorrida`), y el usuario quiere que eso sea un valor del ENTORNO: en desarrollo, ningún camino automático paga nunca; en producción, sí, vecinos incluidos.

La interpretación del coordinador casa con la frase literal («debe ser configuración… no volver a generar por defecto mientras estemos en desarrollo… cuando estemos en prod sí»). Un matiz: el usuario no dice «el jugador elige» en producción. Dice «en prod sí». Eso deja abierta la bifurcación de más abajo.

## La premisa, afirmación por afirmación

1. *«#714 se cableó en `politica-de-atlas.ts` con `modoDeCorrida`»*. **Cierto**: `nefan-core/src/scene/politica-de-atlas.ts:37-39`, `resolveOnly: !(t.activo && t.generacion)`. La llaman `nefan-html/src/scene/fps-atlas.ts:171` (activo) y `:240` (vecino).
2. *«Las pruebas gastan créditos»*. **Falso hoy.** `qa/run.mjs:24-32` gatea todo guion a cero peticiones si el backend no declara ser falso (#295), y el motor falso cuenta cada ruta de pago (`labs/narrative/fake-ai-server.ts:157`, `dePago`). No hay que construir nada para las pruebas.
3. *«Por defecto se genera»*. **Falso para una partida nueva**: nace en maqueta (`nefan-core/src/session/gates-de-imagen.ts:76`, `MODO_AL_EMPEZAR = "vector"`, que manda también en el wire, `bridge/handlers/session.ts:387`). **Cierto para un save en Imagen IA**, que queda congelado y **cada reanudación, viaje o NPC nuevo paga lo que falte sin que nadie lo pida**. Ese es el gasto automático que queda vivo en desarrollo.
4. *«Censo de lo que paga»* (pregunta 1), por el código:
   - **Automático**:
     - El atlas del tile ACTIVO al cargar, reanudar o cruzar la frontera: `fps-atlas.ts:171` → `POST /generate_surface_atlas` sin `resolve_only` (`:316-324`) cuando `generationOn()` (`main.ts:216`).
     - Los skins de cada NPC y del jugador: `renderer/sprite-renderer.ts:121` → `/skin_sprite_sheet`, cuando `gatesDeImagen().personajes`.
     - Los vecinos y el prefetch hoy **no** pagan nunca (`carga-de-tile.ts:374`, `restaurar`).
   - **Deliberado**:
     - La tecla G y el menú dev: `fps-atlas.ts:121`, `generar: () => this.runFor(key)`, que salta `generationOn`.
     - Aplicar un estilo a un juego, con cotización: `ui/style-apply.ts:380/402/440`, desde `titulo/plan-de-estilo.ts`.
     - Subir un estilo y confirmar su `/complete`: `titulo/subir-estilo.ts:222/260`.
     - `build_style_pack.py`.
   - **No paga imagen**: la pre-generación del mundo (`crear-mundo.ts:111`, `bridge/handlers/game-gen.ts`). Es LLM por el motor, sin llamadas a remote-gen.
5. *«Restaurar lo pagado y lo que falte en clay»*. **Solo existe para escenarios.** El atlas tiene `resolve_only` en el servidor (`ai_server/routers/remote_generation.py:68,154`). **Los skins no**: `SkinSpriteSheetRequest` (`:621`, `extra="forbid"`) no tiene modo «solo caché», y con el gate cerrado el cliente ni pregunta: `character-sprites.ts:349` devuelve la base y_bot. En desarrollo con techo, un NPC con skin YA pagado saldría en y_bot. El `solo_cache` interno (`:732`) solo se activa cuando sprite-forge está caído, y no está expuesto.
6. *«Cómo sabe cada proceso si está en dev o prod»* (pregunta 3). **Hoy no lo sabe ninguno.** No hay `NODE_ENV`, `import.meta.env.PROD` ni `NEFAN_ENV` en `nefan-core/src`, `bridge`, `nefan-html/src`, `ai_server` ni `start.sh`: grep a cero. «Producción» no existe como entorno. El valor «sí» es solo el que no sale por defecto.
7. *¿Quién debe cortar?* **El único que distingue «automático» de «deliberado» es el cliente, que es quien pide.** remote-gen (quien paga) recibe el mismo `POST /generate_surface_atlas` desde `fps-atlas.ts:316` (automático) y desde `style-apply.ts:402` (deliberado), y el mismo `/skin_sprite_sheet` desde `sprite-renderer.ts:121` y `style-apply.ts:440`. Cortar en quien paga obliga a declarar la intención en el cable, que es un cambio de contrato en tres procesos (cliente, ai_server y motor falso). Cortar en quien pide cabe en los gates puros que ya existen (`gates-de-imagen.ts:121`, `modoDeCorrida`), que ya están medidos por test y mutación. La elección es del arquitecto. El criterio 2 tiene que poder comprobarse en cualquiera de las dos.

## La bifurcación (decide el usuario; recomiendo A)

- **A · Techo.** La configuración limita a «Imagen IA». En desarrollo, un save en Imagen IA solo restaura, y el arte nuevo sale solo por las vías deliberadas. En producción, «Imagen IA» decide como hoy y los vecinos también pintan. Conserva la elección del jugador, que es producto (título, save, chip y ~90 guiones que la nombran). El precio es que en desarrollo el chip de escenarios apenas distingue nada: la maqueta ya restaura lo pagado (`fps-atlas.ts:142-146`). El chip tiene que decir por qué no genera, igual que dice `CHARS_OFF_REASON` (`graphics-mode.ts:46`).
- **B · Sustituto.** Muere «Imagen IA» y la configuración es el único interruptor. Es un solo camino, pero borra una decisión de producto que el usuario tomó el 2026-09-14 (`gates-de-imagen.ts:52-60`, «encender Imagen IA es explícito») sin que él lo haya pedido. No se hace sin su sí expreso.
- **Descartada · Defecto** (la configuración elige con qué nace una partida). No cambia nada de lo que se queja el usuario: las partidas nuevas ya nacen sin gastar y los saves en Imagen IA seguirían gastando.

## El día después (con A)

- **Para quien juega en desarrollo**: reanudar su save en Imagen IA ya no cobra celdas ni skins que falten. Lo que faltaba se queda en clay o y_bot, y **se dice**.
- **Se vuelve más difícil**: probar la generación automática real en desarrollo, porque exige cambiar la configuración a propósito. Es lo que se pide.
- **El banco**: ~90 guiones nombran el modo imagen y varios miden precisamente que se PINTA contra el motor falso (59, 88, 114, 160). Si el stack del banco hereda el defecto de desarrollo, esos guiones siguen verdes **sin medir nada**. El valor tiene que poder ser distinto por stack, sin editar código: `e2e-sin-creditos` genera (el falso es gratis) y `play` no. Una constante única en `config.ts` no puede valer las dos cosas a la vez.
- **La regla de la casa de `config.ts:3-5`** («`false` ⇒ el camino que depende LANZA») choca con un techo que degrada a restaurar. `graphics.ai_skin` sigue esa regla y hace abortar el arranque cuando un save pide skins (`renderer/aspecto-del-jugador.ts:154`). La configuración nueva no puede heredar esa semántica: un save en Imagen IA tiene que ARRANCAR en desarrollo.
- **Lo que se queda arbitrario**: `modoDeCorrida` con `activo` como entrada, si en producción el vecino y el activo reciben el mismo trato. Y el coste de pintar vecinos en producción: al reanudar son ~8 tiles, que se pagan a la vez.

## Conflictos

- **#729** (el menú dev en un tile no activo supera al activo). Es **independiente**: es un camino deliberado y no lo toca la configuración. Ni entra ni desaparece.
- **#730** (el estilo llega después y nadie vuelve a disparar). Es **independiente del valor** y empeora con A en producción: un vecino que ahora puede pintar se queda en «nada» (`fps-atlas.ts:162-168`). No bloquea, pero conviene hacerlo en la misma tanda o justo después.
- **Arch-rules** `la-logica-de-juego-no-vuelve-al-cliente`: la decisión de gasto vive en core y el cliente solo la consulta. La configuración entra como dato a `gatesDeImagen` y `modoDeCorrida`, sin que se lea dentro (son módulos puros, `gates-de-imagen.ts:10-13`).
- `test/el-banco-declara-el-modo-de-gasto.test.ts`: los guiones declaran su modo de gasto, y ahora habrá un segundo eje.

## Coste contra valor

Vale lo que cuesta si se acota al gasto automático de saves en Imagen IA, y solo si el banco sigue midiendo la generación. No hacer nada deja el riesgo real de hoy: reanudar un save en Imagen IA en desarrollo paga lo que falte. Ese riesgo es pequeño, porque el jugador tuvo que encender Imagen IA con dos clics, pero el usuario lo ha pedido explícitamente. **No se debe**:
- tocar `MODO_AL_EMPEZAR`;
- crear una segunda fuente de «dev/prod»;
- construir nada para «las pruebas», que ya no gastan;
- dejar a los vecinos pintar en producción sin decir su coste.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **Problema**: con un save en Imagen IA, reanudar, viajar o materializar NPCs paga el arte que falte sin que nadie lo pida, y la regla «el vecino nunca pinta» está en código. Las partidas nuevas (`MODO_AL_EMPEZAR`) y el banco (#295) ya no gastan y quedan fuera.
> **Decisión pendiente del usuario**: la configuración es TECHO de «Imagen IA» (recomendado) o la SUSTITUYE.
> **Criterios**:
> 1. Una sola fuente de verdad para «los caminos automáticos pueden pagar arte nuevo: sí/no». Sin tocar nada vale «no». Se puede poner a «sí» por stack sin editar código.
> 2. Con «no», ningún camino automático llama a una ruta de pago: ni el atlas del activo, ni vecinos, ni prefetch, ni skins. Lo pagado se restaura, también los skins (hoy no existe carril de restauración de skins, y hay que construirlo). Candado probado en negativo contra los contadores `dePago` del motor falso.
> 3. Con «no», las vías deliberadas siguen pagando: G y menú dev, aplicar estilo, subir estilo con `/complete`.
> 4. Con «sí», el activo y los vecinos generan con Imagen IA encendida. Se demuestra en `e2e-sin-creditos`. Los guiones que miden pintar (59, 88, 114, 160) siguen poniéndose rojos si no se pinta.
> 5. Un save en Imagen IA ARRANCA con «no»: nada lanza, y el chip y el registro dicen que la generación está apagada por configuración.
> 6. `modoDeCorrida` no cablea la política: la recibe como dato.
