# QA — Sacar la generación de sprites de personaje a un proyecto independiente

**Veredicto: NO APTO.** El servicio nuevo cumple los cuatro criterios literales del usuario y
los cumple bien —lo he ejercido como un tercero, sin un solo identificador de ne-fan—, pero
**ne-fan no arranca**: `./start.sh --preset play` y `--preset cliente-web` mueren en el
servicio nuevo y abortan el stack entero. No es un NPC en maniquí: es que no hay juego. El
candado que lo habría cazado (`qa/presets.mjs`) ya existía en el repo y no se corrió.

Rama `feat/sprite-forge-skin` (3 commits sobre `main`) + repo nuevo `~/code/sprite-forge`
(7 commits, CI verde, privado).

---

## 1 · Los criterios literales del usuario

| Criterio (cita) | Estado | Evidencia |
|---|---|---|
| **(a)** «un proyecto **independiente** porque lo va a usar **otro proyecto**» | ✅ cumple | Repo propio en `~/code/sprite-forge`, `github.com/alberto-hortelano/sprite-forge` (privado), CI propio en 3 trabajos, verde en el último push (`gh run list` → `completed success` para `047e025`). Ne-fan lo consume por HTTP y no comparte código: `grep` de imports cruzados = 0 |
| **(b)** «recibe **ángulos, fps, medidas, animaciones**… y **una o varias imágenes de referencia**» | ✅ cumple | `POST /sheets {model, anims[], angle, fps, directions, width, height}`. Con DOS referencias propias: `/identity` → HTTP 200, `/skins` → HTTP 200, 32 PNG. Con 3 anims: `/sheets` devuelve **3 hojas** en una petición |
| **(c)** «devuelve **uno o varios sprites** con las animaciones elegidas» | ✅ cumple | `/skins` devolvió 8 direcciones × 4 fotogramas = **32 PNG en base64**, `frames[0][0]` = 256×256 RGBA con alfa 0–255 (fondo quitado de verdad). **Ni una URL, ni un hash de caché** en la respuesta: `[k for k in resp if 'url' in k or k=='hash']` → vacío |
| **(d)** «cachea los `y_bot` **con la configuración** con la que se generaron, **NO las imágenes generadas**» | ✅ cumple | Las dos mitades, medidas: `fps=12 → base_key=84b8b91255a268db (352 PNG)` y `fps=24 → af719c44ed000699 (704 PNG)` **conviven**, cada una con su `config.json` que guarda el payload literal (`…|fps=n12|width=n256|…`). Y tras `/identity`+`/skins`: **0 ficheros nuevos** en todo el árbol del servicio (`find` antes/después, 8089 ficheros), 0 directorios `heroes`, 0 metas con coste, 0 base64 en el log |
| **(añadido)** «el servicio **describe qué animaciones ofrece**… depende de los assets» | ✅ cumple | `GET /catalog` → 20 modelos, 16 anims con `duration_s` y `calls_per_anim`, 1 ángulo, `defaults`, `limits`, `skin`, `warnings`. Y **sale del disco en vivo**: sobre un árbol de enlaces, quitar `slash.fbx` deja las anims en `idle, walk` y quitar `paladin` deja `modelos: y_bot`, **sin reiniciar**; los ausentes van a `warnings[]` (13 → 14), no al silencio |
| **(añadido)** Mixamo como **ejemplo**, no sujeto | ✅ cumple | `sets/mixamo.json` es el único sitio con nombres propios; el README §«Los assets los pones tú» explica cómo bajarse *un* set y dice que vale cualquiera; `locomotion` es propiedad del clip, no una lista de nombres |
| **Un proyecto ajeno pide sprites sin nada de ne-fan** | ✅ cumple | Lo hice yo, desde cero: imagen de referencia dibujada aquí mismo (`mi-referencia.png`, 512², nada de ne-fan), `style_note` en texto libre, **sin `style_id`, sin `style_role`, sin pack**. `/identity` 200 en 0,1 s, `/skins` 200 en 13,6 s con 32 PNG |
| **Tras `/skins` el servicio no guarda nada** | ✅ cumple | Ver (d). Además, con los ojos abiertos: **temporales** → `find -newer` sobre el árbol, su caché, `/tmp`, `/var/tmp` y `~/.cache` no devuelve un solo fichero del servicio; **caché HTTP** → no hay ninguna (`grep` de escrituras en el worker: los tres `save()` van a `BytesIO`, y los únicos `Path()` de `app.py` son de LECTURA de la hoja base); **logs** → el log íntegro del servicio son 6 líneas y 0 con `iVBOR`/`data:image` |
| **Ne-fan sigue funcionando** | ❌ **NO cumple** | `./start.sh --preset cliente-web` → `❌ sprite-forge /health did not respond within 90s` y el launcher para el stack entero. `qa/presets.mjs cliente-web` → `✘ NO levantó: 3000 8767 8768 8770 9877 9878`. Detalle en el hallazgo 1 |
| El wire no cambia (`sprite-renderer.ts`, `portrait.ts`, fake-ai-server, guiones 07 y 13) | ✅ cumple, con un matiz | `git diff main...HEAD`: `portrait.ts` y `07` **sin tocar**; `sprite-renderer.ts` y `13`, **solo comentarios** (la ruta del tool viejo → «CLI de sprite-forge»); `fake-ai-server.mjs` **+22 líneas aditivas** (la ruta `/sprite_catalog` nueva, que pedía la decisión de `SKIN_IMAGE_CALLS`) — su handler de `/skin_sprite_sheet` no cambia una coma. Y los dos guiones pasan: **16/16 en verde** |
| Borrado del mismo día, `grep` a cero | ✅ cumple | Los diez términos, comprobados uno a uno (ver §3) |
| Archivado, no borrado | ✅ cumple | `archivo/labs/skinning/` = **41 MB** (`bases`, `characters`, `heroes`, `runs`) y `archivo/cache/sprite_sheets/` = **580 MB** en **169 directorios** (124 + 45, como decía el plan). Medido con `du --si`; los «39 MB / 536 MB» del informe son los mismos números en MiB |
| Las hojas de ne-fan no se movieron | ✅ cumple | `tools/huellas.sh` sobre `nefan-html/public/sprites` **casa exactamente** con `reference/fingerprints.txt`, las once hojas. Probado en negativo: añadiendo un byte a un PNG, `--check` da ROJO con el diff y vuelve a VERDE al restaurarlo |
| `rembg` fuera de las dependencias | ✅ el ingeniero tiene razón, el plan se equivocaba | Ver §4 |
| `./start.sh --preset play` con créditos | ⚠️ **no probado** — y el trozo sin probar es **mucho mayor** de lo que dice el informe. Ver §6 |

---

## 2 · La verificación fuerte: el traslado no mueve un píxel

El informe afirma «1752 de 1752 PNG idénticos» contra el renderizador de ne-fan. Ese
renderizador ya no está en la rama, así que lo saqué de `main` y lo corrí yo:

```
git show main:tools/render-sprite-sheets/{render,page,fbx-anim-span}.mjs page.html → /tmp/viejo
node /tmp/viejo/render.mjs --models y_bot --anims heavy walk   (renderizador de main)
node bin/sprite-forge.mjs render --models y_bot --anims heavy walk   (sprite-forge)

  y_bot/heavy : 144 PNG comparados, DISTINTOS = 0   meta idéntico (salvo generated_at)
  y_bot/walk  : 104 PNG comparados, DISTINTOS = 0   meta idéntico (salvo generated_at)
```

**248 de 248 idénticos** en las dos hojas que muestreé (él midió las once). La afirmación se
sostiene, y no es una lectura del diff.

Y la red de paridad **muerde en las dos direcciones**, probada por mí sobre la hoja que
carga la deuda:

```
CONTROL (render nuevo vs reference/, lista real)  VERDE  144 frames; 2 desvíos congelados y ninguno peor
NEG «empeora» (magnitud 0.083062 → 0.0805)        ROJO   "…EMPEORA el desvío congelado (0.083062 > 0.080500)"
NEG «ya no ocurre» (frame sano en la lista)       ROJO   "…el desvío congelado ya no ocurre — bórralo de …"
NEG «sin lista» (la red desnuda)                  ROJO   "dir_0_frame_009: luminancia -8.0% > ±8%"
```

Los dos fotogramas de deuda son reales, están declarados y **no son regresión del traslado**:
el ~5 % de sesgo es contra `public/sprites`, que hizo el renderizador de Godot. Confirmado:
la hoja recién renderizada difiere en 144/144 PNG de `public/sprites` y en 0/144 del
renderizador de `main`.

---

## 3 · Los diez términos a cero

| Término | Vivo | Término | Vivo |
|---|---|---|---|
| `sprite_skin_meshy` | 0 | `SKIN_IMAGE_CALLS` | 0 |
| `tools/render-sprite-sheets` | 0 | `HERO_VIEW_FRAGMENTS` | 0 |
| `labs/skinning` | 0 código · 1 doc | `ANIM_PROFILES` | 0 |
| `SPRITE_SHEETS_DIR` | 0 | `ATLAS_MAX_CELLS` | 0 |
| `sprite_skin_gen` | 0 | `isometric_30` | 0 código · 1 doc · 1 candado |

Los dos restos son legítimos y los doy por buenos: `labs/README.md` **dice dónde fue** el lab
(`archivo/labs/skinning/`), y `docs/arquitectura/ia-servicios.md` **explica** que el viejo
defecto de `angle` era `isometric_30` — que es justo lo que hay que contar para que no vuelva.
El tercero es el patrón de `arch-rules.json`, donde el término tiene que estar escrito para
poder prohibirse; `docs/**` no es root de esa regla, así que ninguno la infringe.
`nefan-core`: **35 tests de arquitectura en verde** dentro de los 1291.

---

## 4 · `rembg`: el ingeniero acierta y el plan se equivocaba

Verificado, y no de oídas:

```
ai_server/sprite_generator.py:88     from rembg import remove        (/generate_sprite, gpu-worker)
ai_server/model_generator.py:319,322 from rembg import remove/new_session   (/generate_model)
grep rembg ai_server/requirements.txt pyproject.toml → VACÍO   (tampoco en main)
git diff main...HEAD -- requirements.txt pyproject.toml → VACÍO (no tocó nada)
```

Dos consumidores vivos y **nunca declarado**. No había nada que quitar, y quitarlo habría
roto dos endpoints. Los dos ficheros que lo usan no aparecen en el diff, así que no hay
endpoint roto que buscar. Donde sí está declarado ahora es en `sprite-forge/python/requirements.txt`,
con el motivo y el tamaño al lado, y con **import perezoso** y mensaje propio si falta
(`"falta rembg (quita el fondo del repintado): pip install -r python/requirements.txt"`).

---

## 5 · Hallazgos

### 🔴 BLOQUEANTE 1 — `./start.sh --preset play` y `--preset cliente-web` no arrancan

El commit se titula *«El launcher conoce sprite-forge, o 'play' arranca sin personajes»*. Hoy
`play` no arranca **en absoluto**.

**Reproducción, desde donde empieza el usuario** (terminal nuevo, sin nada exportado):

```
$ ./start.sh --preset cliente-web
▶ Preset 2 · cliente-web · Cliente web (dev) (no interactivo)
▶ Launching selected services...
✅ asset-store :8767  (log: /tmp/nefan-asset-store.log)
❌ sprite-forge /health did not respond within 90s (http://127.0.0.1:8770/catalog)
🧹 parando lo que arrancó este launcher...

$ wc -c /tmp/nefan-sprite-forge.log
0 /tmp/nefan-sprite-forge.log          ← el log del servicio que falló está VACÍO
```

No hay bridge, no hay cliente, no hay juego. Y el usuario no tiene ni una pista: 90 segundos
de espera y un log de cero bytes. Son **dos defectos encadenados**, y los dos hay que
arreglar:

**1a · En sprite-forge: si el worker de Python no puede arrancar, el servicio entero se muere
en silencio con código 0.** Contradice su propio README (§«El repintado es opcional»: *«Sin
Python, sin sus dependencias o sin `SPRITE_FORGE_IMAGE_KEY`, el servicio sigue sirviendo hojas
base y `/catalog` lo dice»*) y el docstring de `src/skin.mjs` (*«Lo que NO hace es fingir»*).

```
$ python3 -m sprite_forge_skin.app --port 0
ModuleNotFoundError: No module named 'httpx'          ← el python del sistema, el que usa start.sh

$ node bin/sprite-forge.mjs serve --assets …/assets/characters --port 8771
$ echo "EXIT=$?  bytes de salida: $(…)"
EXIT=0  bytes de salida: 0                             ← 1 segundo, cero salida
$ node bin/sprite-forge.mjs serve --sin-skin --assets … --port 8771
sprite-forge 0.1.0 · set "mixamo" …  escuchando en http://127.0.0.1:8771     ← con --sin-skin, vive
```

La causa está en `src/skin.mjs`, en `parar()`: cuando `arrancar()` sale por la rama de fallo,
el hijo **ya ha salido**, así que `p.on("exit", …)` no volverá a disparar nunca y la promesa
queda colgada de un `setTimeout` que está **`unref`'d**. Como en ese punto el servidor HTTP
todavía no ha hecho `listen`, el bucle de eventos se queda sin nada que lo sostenga y Node
sale con 0 **antes de imprimir el `! repintado NO disponible`** que ya tenía preparado. Los
`errores` de stderr del worker (el `ModuleNotFoundError`) se pierden con él.

**1b · En ne-fan: `start.sh` no le da al servicio ni intérprete ni credencial.**
`start_sprite_forge` hace `cd "$SPRITE_FORGE_DIR"; exec node bin/sprite-forge.mjs serve …` sin
activar el `.venv` —que es lo que sí hacen los tres subshells de `gpu-worker`, `remote-gen` y
`ai_server` (`start.sh:219,232,293`)—, así que el worker se lanza con `/usr/bin/python3`. Y
aunque se arregle 1a, el segundo piso sigue en pie: el servicio **exige `SPRITE_FORGE_IMAGE_KEY`**
y ne-fan tiene su clave en `.env` como `MESHY_API_KEY`, que solo lee `config_snapshot.py`
dentro de los procesos Python. Medido, con un intérprete que sí tiene las deps:

```
$ env -u SPRITE_FORGE_IMAGE_KEY SPRITE_FORGE_PYTHON=…/.venv/bin/python node bin/sprite-forge.mjs serve …
  ! repintado NO disponible: falta SPRITE_FORGE_IMAGE_KEY — sin clave no hay repintado.
$ curl /catalog | jq .skin
{ "enabled": false, "reason": "falta SPRITE_FORGE_IMAGE_KEY — …" }
```

O sea: el escenario que §9.7 dice haber cerrado —«cada NPC en maniquí con un 503 en un log que
nadie mira»— **sigue vivo un piso más abajo**, y llegaría en cuanto se arregle 1a.

**Por qué la entrega lo dio por bueno.** §9.7 muestra `✅ sprite-forge :8770` corriendo
`./start.sh --preset cliente-web`. Esa medida solo sale si el shell ya tenía el `.venv`
activado y la clave exportada; `start.sh` no crea ninguna de las dos cosas. Es un
«funciona en mi máquina» con la evidencia dentro.

**El candado existía y no se corrió.** `qa/presets.mjs` es exactamente esto —*«¿Arranca cada
preset de `./start.sh` lo que dice que arranca?»*—, lee `SERVICES`/`PRESET_PROFILES` del propio
`start.sh` y no necesitaba ni una línea nueva:

```
$ node qa/presets.mjs --lista        # reconoce el servicio nuevo sin tocarlo
play         esperados: 3000 3737 8765 8766 8767 8768 8770 9877 9878
cliente-web  esperados: 3000 8767 8768 8770 9877 9878

$ node qa/presets.mjs cliente-web
  ✘ NO levantó: 3000 8767 8768 8770 9877 9878
0/1 presets arrancan exactamente su máscara        EXIT=1
```

Que `node qa/run.mjs` diera 16/16 no lo desmiente: la batería levanta `e2e-sin-creditos`, el
único preset con servicios que **no** incluye sprite-forge.

**Lo que esperaba el usuario:** arrancar el juego. Lo que obtiene: 90 s de espera, un stack que
se apaga solo y un log vacío.

---

### 🟠 IMPORTANTE 2 — el adaptador se queda con cero tests

`ai_server/routers/remote_generation.py` gana ~270 líneas (`_forge`, `_leer_bases`,
`_apuntar_base`, `_skin_sheet_key`, `hero_key`, `skin_sprite_sheet_endpoint`,
`sprite_catalog_endpoint`) y es **el único puente** entre el juego y el servicio nuevo. En el
mismo diff se borran las 228 líneas de `test_sprite_skin_meshy.py` y **no se añade ninguna**:

```
$ git diff --stat main...HEAD -- ai_server/tests/
 ai_server/tests/test_sprite_skin_meshy.py | 228 ------
$ grep -rln "sprite_forge\|skin_sprite_sheet\|_base_keys\|hero_key" ai_server/tests/ nefan-core/test/
(nada)
```

El comentario que el diff mete en `.github/workflows/ci.yml` («pillow + httpx: deps ligeras de
los tests de imagen **y del adaptador de sprite-forge**») ya es falso el día que se escribe.
Incluye el arreglo de §9.3, que era el hallazgo caro de la entrega. **Mitigado**: dejo un
candado ejecutable, §7.

---

### 🟠 IMPORTANTE 3 — el ciclo de vida del worker no tiene ni un test en el repo nuevo

```
$ grep -rln "skin.mjs\|createSkinWorker" test/
NINGUNO
```

`test/server.test.mjs` construye el servicio con `createService(...)` y nunca llama a
`arrancar()`. Es exactamente donde vive el defecto 1a: 89 pruebas en verde y el modo de fallo
más probable de un despliegue nuevo —«no instalé las deps de Python»— sin cubrir. Un test que
arranque `serve` con un `SPRITE_FORGE_PYTHON` que no existe y exija que el proceso **siga
escuchando** y que `/catalog` traiga `skin.enabled=false` lo habría cazado, y no necesita ni
Chrome ni FBX.

---

### 🟡 MENOR 4 — el README del repo nuevo se quedó en el paso 2

§«Qué necesita» sigue diciendo *«Python 3 + numpy + Pillow **solo para `tools/comparar.py`**»*
cuando Python es ahora la mitad del servicio, y no nombra `SPRITE_FORGE_IMAGE_KEY`. La tabla
§«Ficheros» no lista `src/skin.mjs`, `src/anim-profile.mjs` ni `python/`. El material del paso
3 está bien contado en §«Dos lenguajes, una puerta» y §«El repintado es opcional», pero un
tercero que instale por §«Qué necesita» monta Node + Chrome, arranca… y se le muere sin decir
nada (defecto 1a). Las dos secciones son parte de lo que se le vende al segundo proyecto.

### 🟡 MENOR 5 — ne-fan no documenta la credencial del servicio

`docs/arquitectura/ia-servicios.md` §sprite-forge describe las cuatro rutas, el adaptador y de
dónde salen los assets, pero **no dice que el servicio necesita su propia clave de imagen**, ni
cómo se relaciona con el `MESHY_API_KEY` del `.env`. Es la información que falta para que
`play` gaste un euro.

### 🟡 MENOR 6 — coletilla de comentario rota

`nefan-core/src/contracts/asset-store.ts:128-129`: la línea añadida rompe la alineación del
bloque (` *  (ai_server/…` con un espacio de menos). Cosmético.

---

## 6 · No probado

- **La llamada real al proveedor de imagen** (`/identity` y `/skins` contra Meshy/fal). No la
  he hecho: gasta dinero, y el encargo lo prohíbe. Todo lo demás del camino sí está ejercido
  con el fake, incluido el recorte de fondo real con `rembg` (el log del worker enseña
  onnxruntime cargando y cayendo a CPU).
- **§9.7 dice que ese es «el único trozo que queda sin tocar». No es cierto.** Con el
  bloqueante 1, hoy **el preset `play` entero está sin probar**: no llega a arrancar, y aunque
  arrancara, sin `SPRITE_FORGE_IMAGE_KEY` el repintado está apagado y `/skin_sprite_sheet`
  devuelve 503 antes de rozar al proveedor. Lo que falta por verificar no es una llamada HTTP:
  es *«un NPC vestido en pantalla y su retrato en el diálogo»*, el criterio §7 del plan.
  Cuando 1 esté arreglado, esa comprobación **sigue pendiente** y sigue costando créditos: es
  decisión del usuario, no algo que se pueda dar por bueno por parecido.
- **Concurrencia del worker** (varias peticiones de repintado a la vez). Declarado por el
  ingeniero, no medido por mí.
- **La regeneración de `nefan-html/public/sprites`**: es la «Decisión pendiente de ejecutar»
  de `requisitos.md`, trabajo futuro, fuera de esta validación. Confirmo el dato que la
  motiva: la banda de la red está medio comida por un sesgo del ~5 % contra una referencia de
  la era Godot (§2).

---

## 7 · Lo mecánico que quedaba sin candar: `qa/sprites-sin-servicio.mjs`

El hallazgo §9.3 —el arte pagado desaparecía si el servicio se caía— estaba arreglado pero
**solo comprobable a mano**. Queda candado:

```
$ node qa/sprites-sin-servicio.mjs
sujeto: y_bot/run/frontal_8 — "una exploradora con capa verde y botas altas" (hash 1ff069b32fa00602)
  ✔ servicio arriba: 200 cached, 32 urls
  · sprite-forge caído
  ✔ servicio caído: el arte pagado sigue sirviéndose (200 cached, 32 urls, mismo hash)
  ✔ servicio caído + personaje nuevo: 503 que explica la causa
  ✔ sin el índice de base_keys, el mismo pagado ya NO se puede servir (el arreglo es el índice)
VERDE — el arte pagado sobrevive a la caída, y lo nuevo dice por qué no puede.
```

**Probado en negativo**, devolviendo el adaptador a su forma pre-arreglo (que la excepción
suba siempre, sin mirar el índice) y restaurándolo después (`git diff` limpio):

```
  ✘ servicio caído: el arte PAGADO desapareció — 503 {"detail":"sprite-forge no responde…"}
  ✘ servicio caído + personaje nuevo: esperaba 503 explicando la causa, salió 503 "sprite-forge no responde…"
ROJO — 2 comprobación(es) fallaron.                                                    EXIT=1
```

Cero créditos por construcción, no por confianza: arranca sprite-forge con `--sin-skin`, así
que **no existe** worker que pueda llamar a un proveedor. Vive fuera de `qa/guiones/` por la
misma razón que `presets.mjs` (necesita matar un servicio a media prueba y no usa navegador), y
está documentado en `qa/README.md`.

**Lo que NO he candado, y a quién le toca:** el defecto 1a pide un test en el repo nuevo
(arrancar `serve` con un intérprete inválido y exigir que siga escuchando) y el 1b pide correr
`qa/presets.mjs` en la corrección — no un guion nuevo, el que ya está.

---

## 8 · Workarounds usados, y su veredicto

| Workaround | Por qué hizo falta | Veredicto |
|---|---|---|
| `SPRITE_FORGE_PYTHON=…/.venv/bin/python` para que el servicio arrancara | El `python3` del sistema no tiene las deps del worker | **Es el hallazgo 1b.** Ni `start.sh` ni el README lo ponen, así que el usuario tiene el mismo obstáculo delante |
| `SPRITE_FORGE_IMAGE_API=fake` para ejercer `/identity` y `/skins` | Cero créditos, y el encargo lo indica | **No afecta al usuario**: es el modo declarado del propio repo para recorrer el camino sin gastar, con cinco pruebas que fijan que pasa su propio anti-eco |
| `--sin-skin` para aislar el defecto 1a y para el guion nuevo | Separar «no arranca el worker» de «no arranca el servicio» | **No afecta al usuario**: es una bandera pública del CLI, y en el guion es lo que garantiza el coste cero |
| Copiar la caché de hojas a un directorio de scratch | No ensuciar la del repo al medir «no guarda nada» | **No afecta al usuario**: `--cache` es una bandera pública, y la medida es más limpia con la caché aislada |
| Extraer el renderizador viejo de `main` con `git show` a `/tmp` | Verificar la identidad byte a byte con el original, que ya no está en la rama | **No afecta al usuario**: solo lectura del histórico |
| Mover `_base_keys.json` y parchear temporalmente el adaptador para los negativos | «Rompe a mano lo que dice verificar» | **No afecta al usuario**: todo restaurado, `git diff` de `remote_generation.py` vacío |

---

## 9 · Estado de las herramientas del repo (corridas por mí, con la mutación ya terminada)

| Comando | Resultado |
|---|---|
| `node qa/run.mjs` | **16/16 guiones en verde** (07 y 13 incluidos) |
| `npm test` (nefan-core) | **1291 tests · 0 fallos** (35 de arquitectura dentro) |
| `npm run crap -- --check` | **✔ dentro de los umbrales** — 1064 funciones medidas (la pasada no está envenenada), cobertura 90,1 %, CRAP máx. 126 ≤ 127 |
| `python -m unittest ai_server/tests` · `ruff check ai_server` | **106 tests OK** · `All checks passed` |
| `npm test` (sprite-forge) · unittest de `python/` | **65 + 24 = 89 en verde**, sin Chrome ni FBX |
| CI de sprite-forge en GitHub | verde en el último push (`047e025`) |
| `node qa/presets.mjs cliente-web` | **✘ ROJO** — el bloqueante |

Las cuentas del informe del ingeniero, esta vez, cuadran todas: 1291, 90,1 %, 106, 65+24, 16/16.

---

## 10 · Observaciones que no son defectos, pero conviene decidir

- **`/skins` admite UNA animación por petición** (`{"base":{"anims":[…]}}` → 422 `"base"
  necesita {model, anim}`). Es decisión deliberada del plan §4.1 (respuesta ~2 MB, fallo
  granular, cola del cliente intacta) y la mitad gratis sí acepta varias (`/sheets` me
  devolvió 3 hojas de golpe). Literalmente el usuario pidió «genera **uno o varios sprites**
  … con **las animaciones elegidas**»: en número de sprites se cumple de sobra (32 PNG por
  llamada), en número de animaciones el bucle lo hace quien llama. Si el usuario lo leía como
  «una petición, todas las animaciones», esto es lo que hay que cambiar.
- **Una entrada de caché a medias falla fuerte, pero no se auto-cura.** Le quité un PNG a una
  hoja cacheada: `HTTP 500 · "entrada de caché corrupta en …: 103 PNG y el meta declara 104 —
  bórrala"`. Es fail-loud del bueno (nada de servir una hoja corta en silencio), pero exige
  que alguien entre a borrar, teniendo el render a 3 s y gratis.
- **Subir la versión del paquete invalida toda la caché de hojas** (`version` entra en
  `base_key`). Declarado en el informe y en el README; barato, pero es una sorpresa que se
  paga en el primer arranque tras cada `npm version`.
- **Cuando los skins se caen, el juego SÍ se lo dice al jugador.** En la captura
  `07-npc-clave-del-skin-02` del bench: *«skins IA desactivados para la sesión (los personajes
  usan la base y_bot). Motivo: … HTTP 500 …»*. No arregla el bloqueante, pero significa que el
  modo maniquí no es mudo.
- **Crítica visual**: sin cambio, y era lo que había que demostrar. En
  `13-personajes-animados-01-npc-en-partida` el personaje se lee bien en el vano de la taberna,
  con la escala correcta contra el marco y los pies asentados en el plano; en
  `10-fps-telegraph-02` la figura recibe la misma luz única que el resto del greybox y no hay
  ni z-fighting ni recorte de billboard. Es el maniquí `y_bot` de siempre porque en el bench
  los skins están apagados, y las hojas son byte a byte las de antes de la tanda (§2): no hay
  nada nuevo que juzgar, que es exactamente el resultado que se buscaba.

---

## Veredicto

**NO APTO.**

El proyecto independiente está bien hecho y cumple lo que el usuario pidió, con dos cosas que
son mejor de lo que pedía: la caché por configuración arregla un sobrescrito silencioso que
existía, y el catálogo derivado del disco le da sujeto a `#216`. Lo he ejercido como un
tercero y responde: mis imágenes, mi texto de estilo, cero identificadores de ne-fan, sprites
de vuelta y **nada guardado**.

Lo que lo tumba es del lado de ne-fan: **el juego no arranca en los dos presets que usan el
servicio**, con un log vacío y 90 segundos de espera, y el candado que lo cazaba ya estaba en
el repo sin correr. Es un arreglo acotado —el intérprete y la clave en `start.sh`, la promesa
colgada en `src/skin.mjs`— pero hasta que esté, esta tanda deja el juego peor de como lo
encontró.

Para la corrección: 1a + 1b son obligatorios, 2 y 3 son la razón por la que nadie se enteró, y
al cerrar hay que correr **`node qa/presets.mjs`** (no solo `qa/run.mjs`) y
**`node qa/sprites-sin-servicio.mjs`**. Y queda pendiente, para el usuario y con créditos, la
única comprobación que ningún guion puede hacer: un NPC vestido en pantalla y su retrato en el
diálogo.
