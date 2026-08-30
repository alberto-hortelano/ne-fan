# Crítica — El banco no puede mentir (#309 #280 #295 #296)

**REENCUADRADA.** La premisa desbloqueante aguanta, pero **dos de los siete criterios no pueden salir rojos por lo que dicen medir**, y el arreglo descrito deja intacto el mecanismo de #309: pasar el fake a `.ts` no comprueba nada, porque **nada en este repo comprueba tipos en `labs/`**.

| Issue | Veredicto | En una línea |
|---|---|---|
| #309 | **REENCUADRADA (mayor)** | El entregable no es «el fake a `.ts`»: es un typecheck de `labs/` en CI. `tsx` borra los tipos sin mirarlos |
| #280 | **REENCUADRADA (mayor)** | Importar `readStyleFile` cierra 2 de los 4 desvíos medidos; los otros dos viven en la RUTA, no en el lector |
| #295 | **VIGENTE** | Premisa entera verificada, criterio 4 rojo hoy. Aviso de tamaño: el guardarraíl se ejerce desde una PÁGINA |
| #296 | **VIGENTE** | Rojo hoy, y **no hay que rehacerlo** tras #271/#274: `presets.mjs` no puede vivir en un bloque desplazado |

**El problema real:** el banco no tiene ningún punto donde una divergencia con el juego sea *imposible*; sus dos mitades copian a mano lo que deberían importar u obligar.

## La premisa, afirmación por afirmación

| Afirmación | Verificación |
|---|---|
| `fake:596` sirve `scene_model`; `remote-gen.ts:222` y `dev-status-panel.ts:159` dicen `surface_model` | **CIERTA**, y peor: `git show --stat 192037b` tocó **los tres a la vez** (fake −172 líneas). Quien renombró estaba dentro del fake |
| «el mismo preset arranca … el asset-store con `npx tsx` (384)» | **FALSA**. `PRESET_PROFILES` fila 3 = `1 0 0 1 0 0 0 1 0` (`start.sh:687`): `e2e-sin-creditos` **no arranca el asset-store**. Solo vale la 352 |
| «`tsx` ya es dependencia del preset» | **CIERTA con matiz que decide el diseño**: `start_bridge` corre con cwd `nefan-core` (tsx devDep, 4.21.0); `start_fake_ai` corre desde la **raíz**, sin `package.json` ni `node_modules` — ahí `npx tsx` resuelve a un global de la máquina (`~/.npm/_npx`, 4.23.12) |
| «¿puede importar de nefan-core sin dejar de ser un servidor sin créditos?» → sí | **CIERTA**. `readStyleFile` (`blob-store.ts:114`) importa `node:fs`, `node:path` y `SAFE_ID` de `src/games/loader.ts`, que trae zod + `style-refs` + `ui-theme` y **no hace I/O al importar**. Cero red, cero créditos. Y el fake **ya importa fuera de su carpeta** (`fake:23` → `../../qa/lib/stack.mjs`) |
| «grep gasta run.mjs → 0», «hoy son cuatro guiones» | **CIERTAS** (0; y 07, 15, 21, 32) |
| «`aisla`/`aislar()` ya existe, 504-540» | **CIERTA** (`run.mjs:504-541`; camino a `SIN_MEDIR` en `:729-741`) |
| «`presets.mjs` comprueba el catálogo solo al empezar» | **CIERTA**: `:129` una vez; en el bucle `:161` `colados = puertosArriba(c.prohibidos)` → `✘ levantó lo que NO dice` + `exit 1` |

El motivo escrito en `fake:530-533` **está muerto**, sí — pero porque el bridge trae `tsx` al preset y porque el import no arrastra nada caro, no porque el asset-store esté arriba.

## El día después (lo que el enunciado no ve)

1. **Un `.ts` bajo `tsx` no comprueba tipos.** `labs/` no entra en ningún proyecto TS: `tsconfig.json` incluye `src|bridge|services`, `tsconfig.scripts.json` incluye `scripts/**`, y el job `ai-server` del CI corre `python -m compileall -q ai_server labs` — **Python**. Un fake `.ts` sigue sirviendo `scene_model` en silencio. Misma carencia que **#231** (abierto, `deuda`) en un tercer directorio.
2. **Renombrar el fichero le quita dos candados.** `nadie-inventa-un-puerto` y `solo-se-mata-el-puerto-propio` acotan a `labs/**/*.mjs` (`arch-rules.json:492`, `:507`), no a `.ts`; solo `campos-retirados-no-vuelven` cubre `labs/**/*.ts` (`:405`). Tras el renombre los dos siguen **verdes sin mirar el fichero**.
3. **Importar `readStyleFile` no cierra los cuatro desvíos.** Mime/`extname` y el 404 viven en el lector; **la barra final vive en la ruta** (`http-server.ts:82-85`) y **`Content-Length` en la emisión** (`:237-241`). El criterio 2, literal, se cumple dejando copiados a mano justo los dos desvíos que QA midió. Esas 11 líneas no tocan `ManifestDb` ni sqlite (el CORS se pone fuera, en `createAssetStoreServer`): son extraíbles sin arrastrar el asset-store.
4. **#295 es más grande que un `export const gasta`.** `diagnosticoDeCreditos` se ejerce **desde una página de Chromium** (dos `/health` con su CORS) y el runner abre la página **después** de `aislar()` (`run.mjs:742`). Además convierte 4 desenlaces hoy ROJOS (`ctx.expect` false) en `⊘`: es lo que pide el issue, pero es un cambio de veredicto que hay que declarar.
5. **Qué se tira**: el comentario de 20 líneas de `fake:530-549` y su coartada («lo caza el guion 26»). Qué queda mixto y nadie limpiará: `replay-server.mjs` y `game-emulator.mjs` siguen en `.mjs` (§6 los protege), así que `start.sh:322` sigue necesitando `node`.

## Conflictos

- **#231** (`deuda`, abierto): **solapamiento**, no contradicción — cablear el typecheck de `labs/` aparte del de `test/` paga dos veces lo mismo. Nombrarlo en el issue, no fusionarlo.
- **#308** (abierto): el guion 22 es intermitente, **4 rojas de 6 sobre el árbol limpio**. El criterio 3 pide «los 37 guiones, EXIT=0»: **hoy eso no se puede conseguir**, y su primer fallo se le imputará a esta tanda. Es el conflicto que más caro sale.
  *Apostilla 2026-08-30: #308 y #320 CERRADOS — el 22 no era intermitente sino un guion que medía la fixture anterior, y el control del 34 pasaba en verde con tres de las cuatro teclas muertas. Ya no hay ajenos que declarar.*
- **#271/#274 — §6 es sostenible y el arreglo no se rehace.** `presets.mjs` arranca los ocho presets (incluidos `play` y `playtest-motor`) y `start.sh:1044-1056` **se NIEGA** a arrancar ai_server/remote-gen/narrative-mcp/sprite-forge con offset ≠ 0. Luego `presets.mjs` vive siempre en el bloque base, pase lo que pase con el catálogo: nombrar al ocupante ajeno y marcar la corrida no concluyente **es la verdad residual**, no un provisional.
- `CLAUDE.md` (pre-producción): el `.mjs` se borra en el **mismo commit** que arranca el `.ts`, no antes de saber que responde `/health`.

## ¿Cuatro issues o dos? Dos, y no se parten igual

**A = #309+#280** es **un solo trabajo**: los dos necesitan la conversión, el arranque bajo tsx y el typecheck de `labs/`; separarlos paga ese cableado dos veces. **B = #295+#296** comparten el veredicto `⊘` y nada más: ficheros distintos (`run.mjs` / `presets.mjs`), mecanismos distintos, y `run.mjs` ni siquiera llama a `presets.mjs`.

**Una PR no es un error; el orden sí.** A cambia cómo arranca el stack del que depende toda la batería: mezclada con B, un fallo deja el bisect entre dos diffs que no se tocan. Una rama, **B primero y A al final**, o dos PR apiladas. El orden que protege el aparato:

1. **Línea base ANTES de tocar nada**: `node qa/run.mjs` sobre el árbol limpio, apuntado. Sin ese número el criterio 3 no se puede leer.
2. **B (#296 → #295)**: solo añade veredictos, no puede tumbar el stack. Batería otra vez: el delta es atribuible.
3. **A**: que el fake `.ts` responda `/health` lanzado **a mano** (cwd `nefan-core`) ANTES de tocar `start.sh`; luego #280 (la ruta), luego #309 (typecheck en CI + los dos `files` de `arch-rules.json`). El borrado del `.mjs` va en ese commit.
4. `qa/presets.mjs` exige el catálogo ENTERO libre y no admite offset: correrlo requiere que no haya otro agente con un puerto arriba.

## Coste contra valor

Es la más cara de las tres y la única que no cambia **nada** para quien juega. Dentro de la tanda el valor está **invertido respecto al precio**: el único issue con coste en euros medido es **#295** (mandó un `POST /skin_sprite_sheet` real y salió verde) y el que más horas ahorra desde que la máquina admite varios agentes es **#296** — los dos baratos. A compra «que la clase de fallo deje de ser expresable», y ese valor es **cero si el typecheck de `labs/` no entra en CI**. Si hay que recortar, se recorta A, nunca B. **No es peor inversión que las otras dos tandas**, pero es la única cuyo rédito es «la próxima tanda se mide honradamente»: no se puede elegir dos veces seguidas.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

- **§3 #280**: «Medido hoy: `e2e-sin-creditos` (`PRESET_PROFILES` fila 3) **no arranca el asset-store**. Quien trae `tsx` al preset es el bridge (`start.sh:352`, cwd `nefan-core`). El fake arranca desde la RAÍZ, que no tiene `node_modules`: `npx tsx` ahí resolvería a un `tsx` global de la máquina.»
- **Criterio 1** — hoy verde por la puerta de atrás: renombrar `surface_model` ya rompe `nefan-html`, que importa el tipo, y eso satisface «algo falla» sin que el fake se entere. Reescribir: «Renombrar `surface_model` **y todos sus consumidores tipados** deja al motor falso en rojo por sí solo, en un comando que corre en CI. Verificable: el typecheck de `labs/` falla señalando `labs/narrative/fake-ai-server.ts`. Hoy no existe ningún proyecto TS que incluya `labs/`.»
- **Criterio 2**: «El fake no reimplementa la RUTA `GET /styles/{id}/{file}`: la importa. Verificable: las líneas de `http-server.ts:82-85` (normalización + barra final) y la emisión con `Content-Length` de `:237-241` **no aparecen** en `labs/narrative/`, además del `readStyleFile` importado. Importar solo el lector deja a mano dos de los cuatro desvíos que midió QA.»
- **Criterio 3**: «Línea base apuntada ANTES de tocar nada. El criterio es *el mismo veredicto que la línea base*, no EXIT=0: el guion 22 es intermitente hoy (#308, 4 rojas de 6 sobre el árbol limpio) y su rojo no es de esta tanda.»
  *Apostilla 2026-08-30: #308 y #320 CERRADOS — el 22 no era intermitente sino un guion que medía la fixture anterior, y el control del 34 pasaba en verde con tres de las cuatro teclas muertas. Ya no hay ajenos que declarar.*
- **Criterio 4**: «…y hace cero peticiones **desde el guion**. El guardarraíl sí sale a la red: dos `/health`, hoy desde una página de Chromium.»
- **Criterio 8 (nuevo)**: «Los candados que hoy cubren el fake lo siguen cubriendo tras el renombre: `nadie-inventa-un-puerto` y `solo-se-mata-el-puerto-propio` (`arch-rules.json:492`, `:507`) nombran `labs/**/*.ts` además de `labs/**/*.mjs`.»
- **§6**: «Tampoco se arregla #308 aquí; se apunta su estado en la línea base. Y se nombra #231 en el issue del typecheck: es la misma carencia en otro directorio.»
