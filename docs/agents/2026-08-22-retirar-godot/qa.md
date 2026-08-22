# QA — la retirada del cliente Godot

Validado contra `requisitos.md` (petición literal del usuario), no contra el plan ni contra el
informe de implementación. Tres PRs mergeadas en `main`: **#208** (el sustituto), **#209** (la
retirada) y **#214** (la prosa). HEAD `498b727`.

Todo lo de abajo se ejecutó de verdad: el juego arrancado desde `./start.sh`, los siete presets
levantados uno a uno, el renderizador nuevo corrido **desde un clon limpio del repo**. Cero
créditos gastados. Nada de producción tocado (las tres mutaciones temporales para probar
candados en negativo se revirtieron y el árbol quedó limpio).

## Criterios de aceptación

| # | Criterio (literal de `requisitos.md`) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Un clon limpio produce las hojas de sprites **sin Godot**, demostrado regenerando `y_bot/idle/frontal_8` y comparándola con la actual | ✅ cumple | `git clone` a `/tmp/…/clon` (649 ficheros, **sin `godot/`**) + `npm install` en `tools/render-sprite-sheets` + `node tools/render-sprite-sheets/render.mjs --models y_bot --anims idle walk` ⇒ 352 y 104 PNG en **5,2 s**. `comparar.py --todos`: **VERDE, 352/352 y 104/104 frames** dentro de tolerancia. El tool solo lanza `/usr/bin/google-chrome` (`render.mjs:34,306,311`) |
| 2 | El juego real arranca y se juega con personajes animados: `./start.sh`, partida, jugador y NPC moviéndose | ✅ cumple | `./start.sh --preset e2e-sin-creditos` → título → mundo → «Base y_bot» → Comenzar ⇒ escena `tile_0_0` en 0,6 s, NPC `barkeep` que **se desplaza solo 2,18 m en 10 s**, jugador 6,69 m manteniendo `up`. Personaje visible y **animado**: 6 capturas a 220 ms muestran poses distintas (`tira-anim.png`) y el sprite gira con el facing. Guion nuevo `qa/guiones/13-personajes-animados.mjs`, verde |
| 3 | `grep` de `godot\|gdscript\|xvfb` a cero fuera de `archivo/` y de documentación histórica | ⚠️ casi | 203 hits, todos registro fechado o el propio `tools/render-sprite-sheets/**` (excepción declarada) **salvo `next.md`** (2 hits), que la auditoría de #214 no enumeró — ver H4 |
| 4 | Cada preset superviviente arranca lo que dice; verificar con `s` que levanta sus puertos | ✅ cumple | `node qa/presets.mjs` (nuevo): **7/7**, puertos arriba == máscara, incluidos `play` (8 puertos, 10 s) y `playtest-motor`. Probado en negativo: cambiando `on html`→`on asset-store` en `start.sh`, `html-fixtures` se pone rojo. **Pero levantar el puerto no es cumplir la promesa: ver H1** |
| 5 | Las instrucciones a subagentes dejan de mandar `movement_test.py` bajo xvfb | ✅ cumple | `grep -rniE "godot\|xvfb\|movement_test\|gdscript" .claude/` ⇒ **0 hits**. `settings.local.json` sigue siendo JSON válido (55 permisos, 0 de Godot). Leí `.claude/agents/qa.md` y `skills/final-check/SKILL.md` con contexto limpio: no me mandaron a nada que no exista (el diario `[H]` que citan **sí** existe en el cliente web y funciona — comprobado en partida) |
| 6 | `npm run verify` verde al cerrar cada PR | ✅ cumple | Local: **1084/1084, 0 fallos, 7,4 s** (y de nuevo verde con mis dos ficheros de QA dentro, que caen bajo la regla `campos-retirados-no-vuelven`). CI de GitHub: **success** en los tres pushes a `main` (#208 32587328022, #209 32589206786, #214 32590170469) |
| — | **Nada generado se ha perdido** (enmienda permanente) | ✅ cumple | Los **152** ficheros que git borró en #209+#214 están en `archivo/`: 137 comparados **hash a hash contra el blob de git, 0 diferencias**; los 15 restantes eran symlinks (11 resuelven dentro de `archivo/`, 4 apuntan a destinos vivos o archivados). `archivo/godot` conserva 985 ficheros y 1,1 GB, incluido `.godot/`. El único fichero que salió de git en #208 (`…/ambient_anims/walking.fbx`) está en disco en `assets/characters/` |
| — | La deuda baja de 43 a 32 | ✅ cumple | `npm run deuda` ⇒ «Deuda medida — 32 items», 1,2 s |
| — | La regla de celdas cambia de sujeto en vez de desaparecer | ✅ cumple | Probada **en negativo**: añadiendo `const meters_per_cell = 1` a `nefan-html/src/world/collision.ts`, `architecture.test.ts` falla con `[cliente-no-convierte-celdas-a-metros]`. Revertido |

## Hallazgos

### Importante

**H1 · El preset `html-fixtures` levanta su puerto pero no hace lo que promete: el cliente
renderiza NEGRO.** (Preexistente, no es regresión de esta tanda; pero es el preset que la
tanda mantuvo y volvió a documentar.)

`start.sh` y `CLAUDE.md:66` lo describen como *«solo el cliente web: fixtures del selector Room
+ teclas dev, cero backend»*. Reproducción desde el arranque:

```
./start.sh --preset html-fixtures
# abrir http://localhost:3000/
```

1. Durante ~8 s no hay título: sale un **muro de error rojo** «No se puede arrancar la partida
   — bridge did not connect within 5000ms» con 4 entradas en el error-log (captura
   `fx-t10.png`). El botón «Nueva partida» nunca aparece.
2. Tras pulsar «Cerrar», el selector Room ofrece 2 fixtures y al elegir `robledo_tile` la
   escena **carga** (`Scene loaded: tile_0_0`, `fps()` = `{ready:true, tiles:["tile_0_0"],
   surfaces:["tile_0_0"], billboards:0}`, `scene.objects` = 24, consola:
   `[collision] tile_0_0: plan aplicado — 609 celdas sólidas`) …
3. …**y el lienzo se queda completamente negro** (capturas `fx-fixture.png`, `fx-diag.png`;
   comprobado a t+2, +10, +30 y +60 s, sin `pageerror`).

Control: la MISMA fixture por el MISMO camino con el bridge arriba renderiza el pueblo
correctamente (`qa/capturas/01-arranque-y-fixture-02-fixture.png`). Lo que cambia es el bridge,
no la fixture. Diferencia observable: `billboards` 0 vs 97.

Lo que esperaba quien lo usa: iterar renderer/UI sin backend, que es para lo único que existe
ese preset. Hoy no se puede.

**H2 · La paridad del renderizador nuevo se midió sobre `y_bot` y no se sostiene en el otro
modelo que ya está en el repo.** (De esta tanda, PR #208.)

Regenerando `paladin/idle/frontal_8` desde el clon limpio y comparándola con la que hay en
`nefan-html/public/sprites/`:

```
python3 tools/render-sprite-sheets/comparar.py --todos /tmp/…/sprites-clon/paladin/idle/frontal_8 \
        nefan-html/public/sprites/paladin/idle/frontal_8
ROJO — 171 comprobación(es) fuera de tolerancia   (171 de 352 frames, todas de LUMINANCIA,
                                                   hasta −20,1 %; bbox 0 y cobertura 1)
```

Encuadre y silueta son perfectos: el port geométrico está bien. Lo que no casa es la respuesta
del material. Mirado como director de arte (`paladin-cmp.png`): el paladín nuevo tiene
**especular duro** —el escudo se va a blanco y pierde la heráldica ocre— y las sombras se
aplastan a negro; el de Godot es plano y legible. En `y_bot` el mismo efecto existe pero es
pequeño (contraste +12,5 %, saturación −21 %) y pasa la tolerancia porque el maniquí es de
color plano; el paladín lleva texturas y ahí se ve.

`page.mjs:236-237` linealiza `color/specular/emissive` pero no toca la respuesta especular del
material que crea `FBXLoader`. Consecuencia práctica: regenerar hoy una hoja de las que ya
están en el repo cambia el aspecto del personaje, y un lote mixto (unas hojas viejas, otras
nuevas) da un reparto que no comparte iluminación. **El criterio literal se cumple** —pide
`y_bot/idle`—; lo que no está medido es el resto.

**H3 · `Ctrl+C` en cualquier preset mata procesos que el launcher no arrancó — SIGKILL sobre
todo el catálogo de puertos.** (Preexistente; la prosa que esta tanda reescribió sigue
prometiendo lo contrario.)

`CLAUDE.md:74` dice *«Ctrl+C mata limpiamente todo lo que el launcher arrancó (`trap EXIT`)»*.
El `cleanup` de `start.sh:885-903` recorre `ALL_PORTS` (los 9 del catálogo) y llama a
`kill_port` (`start.sh:38` = `fuser -k`, o sea **SIGKILL**) sobre cualquiera que esté ocupado,
lo hubiera arrancado él o no. Medido:

```
# proceso ajeno escuchando en :8767
./start.sh --preset html-fixtures     # su máscara NO incluye asset-store
Ctrl+C
⇒ intruso.sh: line 5: 611626 Killed   python3 -c "...bind(('127.0.0.1',8767))..."
```

Impacto real: el terminal de Claude Code que posee el `narrative-mcp` de `:3737` muere con
cualquier `Ctrl+C` del launcher — le pasó al ingeniero durante su propia verificación (lo
anota en `implementacion.md`) y me obligó a serializar las pruebas de presets. La misma carrera
mata al servicio del preset SIGUIENTE si se arranca antes de que el anterior termine su pasada
de `fuser -k` (medido: `fake-ai-server` salió «Killed» al encadenar `cliente-web` →
`e2e-sin-creditos`; mi arnés lo esquiva esperando a que el launcher muera, no a que los puertos
queden libres).

### Menor

**H4 · `next.md` se quedó fuera de la auditoría del grep.** Es el único fichero versionado
fuera de `archivo/`, `docs/agents/`, los dumps de bench y `tools/render-sprite-sheets/` que
nombra a Godot, y **no aparece en la tabla de #214**. Sus dos hits: `next.md:34` («Fallos
preexistentes de `movement_test.py`», listado bajo **Pendiente**) y `next.md:56`
(«`godot/scripts/main.gd` (~1200 líneas): candidato a extraer…», bajo **Modularidad —
restos**). El documento lleva cabecera «Documento histórico — no es el backlog», así que cae
del lado de la excepción, pero las dos líneas están redactadas como trabajo pendiente sobre
ficheros que ya no existen. Decidir y declarar, no dejarlo por omisión.

**H5 · El renderizador nuevo conserva los cuatro ángulos de las vistas retiradas.**
`page.mjs:25-33` (`ANGLE_CAMERA`) y `render.mjs:70` (`SUPPORTED_ANGLES`) siguen ofreciendo
`top_down`, `isometric_30`, `isometric_45` y `frontal`, que renderizan de verdad (pitch
distinto) y escriben hojas que **nada puede pintar**: el cliente tiene `worldAngle =
"frontal_8"` fijo (`nefan-html/src/main.ts:163`) y su tabla de ángulos se borró en esta misma
tanda. `--help` los anuncia como opciones válidas. Es exactamente la poda que pedía §6.3 del
plan, aplicada al cliente y al Python pero no al fichero nuevo.

**H6 · `--all` no incluye `y_bot`.** `render.mjs:68`:
`DEFAULT_MODELS = ["paladin","eve","warrok","skeletonzombie","arissa","drake"]`. El comando que
un recién llegado usaría para «regenerar los personajes» salta **el único modelo que el juego
necesita** (`BASE_MODEL = "y_bot"`, con el set de 10 anims que `preloadBase` exige fail-loud).
Heredado del tool archivado, pero el fichero es nuevo y es el momento de arreglarlo.

**H7 · El título ofrece 7 modelos y 6 no funcionan.** (Preexistente, pero es el hueco que esta
tanda deja abierto teniendo ya la herramienta para cerrarlo.) En «Crear personaje» el desplegable
«Modelo base (Mixamo)» lista `y_bot, paladin, eve, warrok, skeletonzombie, arissa, drake`
(`title-screen.ts:73-81`). Elegir cualquiera menos `y_bot`:

```
error-log ▸ sprite: sheet load failed for paladin/walk/frontal_8
           Error: non-JSON response for /sprites/paladin/walk/frontal_8/meta.json (content-type: text/html)
```

…y la partida sigue con el maniquí y_bot. En `public/sprites/` solo hay `y_bot` (10 anims) y
`paladin` (solo `idle`). Se arregla con una corrida del tool nuevo (~4 min para los 6 modelos),
con la salvedad de H2.

**H8 · El 200 mentiroso de Vite.** Cualquier PNG o `meta.json` que no exista bajo `/sprites/…`
lo sirve el dev server como `index.html` con **HTTP 200 y `content-type: text/html`**
(comprobado con `curl`). Me dio un falso verde al sembrar el guion 13 y es la razón de que su
aserto mire el `content-type`. El cliente no se traga el `meta.json` (falla al parsear el JSON,
que es lo que se ve en H7), pero cualquier comprobación futura basada en `r.ok` sobre estos
estáticos será un falso verde. Anotado en el guion y en `qa/README.md`.

**H9 · Prosa de QA desactualizada, arreglada por mí.** `qa/README.md` decía que el guion
`12-una-sola-vista-sin-eleccion` «hoy va en rojo» por el `<title>` de la pestaña; se corrigió
en **#206** (`7781bc0`) y hoy da verde. #209 tocó ese fichero (para el slug del preset) y no
actualizó la fila. Actualizada al sembrar mis guiones.

**H10 · Portadas rotas en el preset de bench.** Con `e2e-sin-creditos` (el preset que imprime
una URL para que la abra una persona) el selector de mundos muestra **cuatro marcos con el
icono de imagen rota**: las portadas se piden a `ASSET_STORE_URL` (`title-screen.ts:1089`) y
ese preset no levanta el asset-store. Con `cliente-web` se ven perfectas (capturas de juego de
#207, 1536×1024, sin fallos de red). No es de esta tanda —comparte pantalla con #207— pero es
lo primero que ve quien abre el bench.

**H11 · Un índice posicional sobrevivió a la mejora §6.1.** `EXCLUSIVE_PAIRS=("2 7" "0 8")`
(`start.sh:366`) sigue siendo posicional y se consume como `ACTIVE[$a]`/`ACTIVE[$b]`
(`start.sh:446-453`). Hoy es correcto (`2`=ai_server vs `7`=fake-ai; `0`=bridge vs
`8`=replay-server, que comparten `:9877`), y el resto del fichero está limpio
(`grep -n "ACTIVE\[[0-9]" start.sh` vacío), pero es la única tabla que un servicio nuevo puede
desplazar en silencio — y justo la que impide seleccionar a la vez dos servicios que pelean por
el mismo puerto. Dos líneas de `svc_idx` la matarían como clase, igual que se hizo con el resto.

**H12 · Comentario obsoleto en el runner de QA.** `qa/run.mjs:72-73` sigue diciendo
*«Arranca el preset 5 … `./start.sh --preset 5`»*; el código ya usa el slug (bien), pero el
número 5 es hoy `playtest-motor`. Es el error exacto que la mejora §6.2 vino a matar, escrito
en el comentario que la explica.

## Workarounds usados

| Workaround | Veredicto |
|---|---|
| **Cerrar un muro de error** para llegar al selector Room en `html-fixtures` | **Es un hallazgo, no un paso**: H1. El usuario tiene ese muro delante |
| `setPlayerPos` / `setYaw` (API de bench) para plantarme frente al NPC y fotografiar la animación | Aceptable **solo para las capturas**: el NPC ya era visible y animado por el camino normal (captura `04-tras-andar.png`, tras andar con `up`). Ningún aserto del guion 13 depende de ellas |
| Modo de personajes **«Base y_bot»** en el guion 13 en vez de «Skins IA» | Deliberado y declarado: con «Skins IA» el fake-ai devuelve 500 para `paladin/walk` («esperado en bench») y el cliente degrada con una entrada en el error-log. No oculta nada del criterio: el criterio es que haya personajes animados, y los hay |
| Tres mutaciones temporales de código (`start.sh` ×2, `collision.ts`) para probar candados **en negativo** | Método, no apaño: revertidas y verificadas con `git status` limpio |
| `stdin` cerrado para saltar la pausa de Claude Code al arrancar `play`/`story-web` sin TUI | Es el camino que ya usa `qa/run.mjs`; no cambia qué servicios arrancan |

## No probado

- **Una partida narrativa real con el motor** (`play` / `story-web-sin-imagenes` con Claude Code
  al otro lado): gasta créditos y necesita un segundo terminal. Verificado que ambos presets
  levantan sus puertos, no que la historia fluya.
- **`replay-web` reproduciendo una película de verdad**: arrancado y con sus puertos, pero sin
  `LOG=runs/…/events.ndjson` no reproduce nada. Sin probar.
- **Gasto real de créditos**: cero llamadas a servicios de pago en toda la sesión.
- **La intermitencia de #210 no se reprodujo**: `node qa/run.mjs` completo **2 de 2 veces en
  verde (12/12 cada una)**, más 3 corridas filtradas del guion 13. `05-terreno-desde-ground` y
  `07-npc-clave-del-skin` no fallaron ni una vez. No cierro el issue con eso: 2 corridas no
  refutan un fallo de 1 de cada 2, pero la tanda no lo empeora.
- **Los benches supervivientes de `labs/`** (`fps`, `authoring`) no se ejecutaron; su mitad
  Godot está archivada y sus informes ya no se pueden regenerar (declarado por el ingeniero).
- **Que `archivo/` sobreviva**: es gitignorada y vive en el mismo disco. Comprobé que su
  contenido casa hash a hash con lo que git borró, no que haya copia fuera de esta máquina.

## Lo que dejo ejecutable

| Fichero | Qué fija | Probado en negativo |
|---|---|---|
| `qa/guiones/13-personajes-animados.mjs` | Que el juego sigue teniendo gente: las 10 hojas base servidas y COMPLETAS (último frame incluido, mirando `content-type` por H8) + NPC que se mueve solo + jugador que anda, en partida real desde el título | Sí: escondiendo `y_bot/death/frontal_8/dir_0_frame_027.png` se pone rojo con el fichero exacto; restaurado, verde |
| `qa/presets.mjs` | Que cada preset levanta EXACTAMENTE los puertos de su máscara, leyendo `SERVICES`/`SERVICE_LABELS`/`PRESET_SLUGS`/`PRESET_PROFILES` del propio `start.sh` (una máscara con columnas de más falla antes de arrancar nada) | Sí: con `on html` → `on asset-store` en `start.sh`, `html-fixtures` sale rojo («NO levantó: 3000») |

Ambos documentados en `qa/README.md`. `presets.mjs` vive fuera de `guiones/` a propósito: el
runner arranca **un** stack y se lo pasa a todos los guiones, y esto arranca y para siete.

## Tiempos reales

| Comando | Tiempo |
|---|---|
| `render.mjs --models y_bot --anims idle` (352 PNG) | 4,1 s |
| `comparar.py --todos` (352 frames) | 0,8 s |
| clon limpio + `npm install` + render de 2 hojas | ~25 s |
| `node qa/presets.mjs` (7 presets arrancados y parados) | 2 min 33 s |
| `node qa/run.mjs` (12 guiones) | 1 min 32 s × 2 corridas |
| `npm run verify` | 7,4 s · `npm run deuda` 1,2 s · tests `ai_server` 2,6 s |

Carga máxima de la máquina durante toda la sesión: **0,42** (empezó en 0,42, terminó en 0,12).
Nada corrió más de 2,5 min. `npm run mutate` **no** se lanzó.

## Veredicto

**Apto con reservas.**

Los seis criterios de aceptación del usuario se cumplen —el juego arranca y se juega con
personajes animados, un clon sin Godot regenera las hojas con paridad medida, los siete presets
levantan lo que dicen, las instrucciones a subagentes están limpias, el CI verde— y la enmienda
permanente se respeta con rigor: **152 de 152 ficheros recuperables desde `archivo/`, 137 de
ellos idénticos hash a hash**.

Las reservas son tres y ninguna invalida la tanda: la paridad del renderizador está medida en
un solo modelo y **no se sostiene en el otro que ya está en el repo** (H2, y es de esta tanda);
el preset `html-fixtures` levanta su puerto pero renderiza negro, o sea que «cada preset
arranca lo que dice» se verificó por puertos y por puertos no basta (H1); y el `Ctrl+C` del
launcher sigue matando procesos ajenos mientras la documentación promete lo contrario (H3).
