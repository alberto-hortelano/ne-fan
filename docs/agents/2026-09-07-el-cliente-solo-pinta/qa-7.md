# QA — PR 7 de #241: el borrador, la elección de estilo y la validación del pack salen del título a core

**Veredicto: APTO CON RESERVAS.** Es un movimiento y las cuatro conductas que cambian están declaradas y
son las que dice el informe — lo reproduje con enumeraciones **propias y más anchas** que las del ingeniero.
Elección de estilo: **3.260 casos** (todas las 326 SECUENCIAS ORDENADAS no vacías de los 5 packs reales ×
10 mundos, incluidas todas las permutaciones, para cazar también dependencias del orden de `listStyles`) →
**BRIDGE: 0 diferencias**; **TÍTULO: 724**, y las 724 caen en las DOS familias declaradas (464 «base
bloqueaba con 0 compatibles», 260 «el estilo del mundo no casaba y se escondía»); **con el repo tal cual, 0
diferencias**, que es por lo que los ocho guiones del título siguen verdes sin tocarlos. Subida de un pack:
**50 cuerpos** (los 40 míos más 10 con VARIOS fallos a la vez, para estresar el orden de las
comprobaciones) contra el `styles.py` de `1f4ab084` **EJECUTADO** en un árbol aparte y contra el de hoy →
**2 casos cambian de veredicto y los dos son «medir el nombre recortado»**, que el informe declara uno a
uno (§ «Cambios de conducta declarados» 4). Y el motivo que el título enseña coincide **carácter a
carácter** con el `detail` del 422 en los **22 casos que cazan los dos, con 0 regresiones**: (c) es verdad.
La cobertura la medí yo en un **worktree limpio de `main`**: `crap -- --check` **ya salía rojo en la base**
(88,9 % < 89 %, exit 1, 2353/2353 tests) y la rama la deja en 88,7 %; de las 86 líneas a cero de los tres
módulos nuevos, **las 82 son documentación y las 4 restantes son líneas de `import`/declaración de función**
—cero ramas y cero funciones sin ejecutar—, salvo cuatro ramas del `.transform` que sí son un hueco real y
pequeño (H7). Guion nuevo **92**, 34 asertos verdes, probado en negativo con **tres** sabotajes (6, 1 y 1
rojos). Batería completa a la primera, sin retocar ningún guion: **`91 en verde · 0 en rojo de 91`**.

**Las reservas son dos, y ninguna es del código movido.** (H1, importante) Sobrevive una **tercera
declaración ejecutable del umbral del borrador** en un tercer proceso —`ai_server/routers/narrative.py:32`,
`Field(min_length=20, max_length=64_000)`, medida en BRUTO y con 422 de Pydantic— que no deriva del snapshot,
no la caza la regla (solo escanea `nefan-html/src/**` y `nefan-core/bridge/**`) y que el plan ni siquiera
lista: hoy no hay divergencia de veredicto porque el bridge manda el texto ya recortado, pero es exactamente
la enfermedad que esta PR trata. (H3, menor) El `porque` que queda **congelado** en `client-file-size.json`
dice que las +4 líneas del título son «los imports y el rótulo de las carpetas», y el diff dice lo contrario:
el **código baja 5 líneas** (36 añadidas / 41 borradas, imports incluidos) y lo que sube son **9 de
comentario**. El propio `implementacion-7.md` lo cuenta bien; lo que se congela en el contrato es la versión
que el diff contradice.

Worktree `/home/al/code/ne-fan-241-7-qa`, HEAD desprendido `6919d120` sobre `main` `1f4ab084`. Stack propio:
`ss -ltn` antes → `22/53/80/631/4317/3636` y el bloque **ajeno +600** (`:3600`, `:10477`, `:10478`, `:19365`,
de `ne-fan-241-8-qa`); `NEFAN_PORT_OFFSET=500 ./start.sh --preset e2e-sin-creditos` → fake-ai `:19265`,
bridge `:10377` (State API `:10378`), cliente `:3500`; parado con `NEFAN_PORT_OFFSET=500 ./start.sh --parar`
→ `✅ stack cleaned` enumerando y **respetando** lo ajeno (`⏭ :10477 :10478 … — AJENO, no se toca`,
`⏭ :3600 … ne-fan-241-8-qa`, `⏭ :19365`). Ningún `pkill`, ningún `kill` por puerto, ningún uso del Playwright
MCP compartido: ojos con sonda propia (`playwright-core` de `qa/node_modules` + `abrirNavegador` del banco,
ANGLE/RTX 3060) y los guiones con `qa/run.mjs`, que eligió su bloque. Python con el `.venv` del repo raíz y
`unittest` (no hay `pytest`). Cero créditos en todo.

---

## 1 · Criterios de aceptación

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Es un movimiento salvo lo declarado — elección de estilo** | ✅ cumple | Enumeración propia (`scratchpad/qa7/equiv-estilo.mjs`, importa `eleccionDeEstilo` de `dist` y transcribe las dos reglas de `1f4ab084` de `git show`): `casos: 3260 (326 secuencias de estilo × 10 mundos)` · `BRIDGE (create_game): 0 diferencia(s)` · `TÍTULO (desplegable): 724 diferencia(s)` → `464 × A · base bloqueaba (0 compatibles); hoy ofrece el de caída marcado`, `260 × B · el estilo del mundo no casa por tema: base escondía y ponía otro; hoy lo ofrece y lo pone` · `con el repo tal cual (5 estilos × 4 juegos reales): 0 diferencia(s)`. **Ninguna diferencia fuera de A y B.** Las «9 × C» del informe (desplegable vacío) no salen aquí porque comparo veredicto+lista+puesto y no el texto del `<option>` deshabilitado: consistente |
| …y el **invariante** que el módulo promete | ✅ cumple | Sobre los mismos 3.260 casos: `invariante «porDefecto ∈ ofrecidos ⟺ ofrecidos ≠ []»: 0 violación(es)`. Es lo que hace inexpresable un `<select>` con un `value` que no es ninguna de sus opciones |
| **Es un movimiento salvo lo declarado — borrador** | ✅ cumple | `validarBorrador` en `dist`: 19 → rechazo, 20 → ok, 64.000 → ok, 64.001 → rechazo, `"   "+18+"   "` → rechazo (el recorte va dentro). En el bridge: `git show 1f4ab084:…/session.ts:159-165` medía lo mismo con **otra redacción** (`draft_too_short: …`) y el título **solo el mínimo**. Hoy los dos llaman a la misma función y dicen el mismo texto (medido en vivo, guion 92 bloque E) |
| **Es un movimiento salvo lo declarado — subida (b)** | ✅ cumple, **el cambio está declarado, no encubierto** | Copié `ai_server` a un árbol temporal, sobrescribí `routers/styles.py` y `style_packs.py` con los de `1f4ab084` y **llamé al endpoint** de cada uno con el MISMO cuerpo sobre su `styles_dir` temporal (`scratchpad/qa7/corre_subida.py`). 50 casos: `16 idénticos (veredicto Y motivo) · 32 mismo veredicto y otro motivo · 2 VEREDICTO distinto`. Los 2: `04 nombre solo espacios` (base **ok** → crea un pack llamado con ocho espacios; hoy 422) y `05 nombre 62 brutos / 60 recortado` (base 422 de Pydantic; hoy **ok**). Los dos son la misma decisión —medir el nombre RECORTADO— y están escritos en `implementacion-7.md` § «Cambios de conducta declarados» 4 |
| …y el resto de los «422» que el informe cuenta como cambio de motivo | ✅ cumple | Mi harness distingue `422-pydantic` (el `ValidationError` que FastAPI convierte en 422 estructurado) de `422` con motivo en español; normalizando ambos a «rechazo» salen los 2 de arriba. Sin normalizar son 15, y las 13 restantes son exactamente los límites que estaban en `Field(...)` y hoy dan una frase en español |
| **Declarado 5 (validar antes del `mkdir`)**, no solo dicho | ✅ cumple, medido | El harness lista el `styles_dir` después de cada caso: **8 de los 50 dejaban un `user_tinta_y_pergamino/` a medias en la base y hoy no dejan nada** (`22 cara sin desc`, `23 desc en blanco`, `24 characters sin desc`, `28 id inválido`, `31 id duplicado`, `32 mismo slug`, `37 dos fallos a la vez`, `43 img1 carpeta mala`) |
| **(c) el jugador ve el mismo motivo que le daría Python** | ✅ cumple | Los mismos 50 cuerpos por `validarSubidaDeEstilo` de `dist` contra el `detail` del endpoint de hoy: `título↔Python: 0 motivos distintos · 3 solo los ve Python · 0 regresiones`. Los 3 son los que exigen los bytes o el slug derivado (`34 base64 ilegible`, `35 no decodificable`, `32 mismo slug derivado`), declarados. En el juego real (ojos, § 4): el título dice `la imagen 1 necesita una descripción: solo la lámina de materiales puede ir sin ella. (fachada.jpg)` y Python `…sin ella.` — **idéntico salvo el paréntesis con el fichero**, que es la desviación 3 del informe |
| …y el ORDEN de las comprobaciones aguanta con varios fallos | ✅ cumple | 10 de los 50 casos son multi-fallo a propósito (nombre corto + 13 imágenes + carpeta mala; img1 carpeta mala + img2 sin descripción y al revés; id inválido + sin descripción; dos láminas + nombre malo; `style_token` largo + 9 etiquetas…). Cero motivos distintos entre las dos puntas en todos ellos: el `superRefine` conserva el orden de inserción y coincide con el orden de `raise` de Python |
| **(d) el snapshot se pone rojo si el zod cambia y el JSON no** | ✅ cumple | `imagenes: {min:1,max:12}` → `max:16` en `style-upload.ts`, sin volver a volcar: `node --import tsx --test test/contract-style-upload.test.ts` → `ℹ pass 0 · ℹ fail 3`, con `AssertionError: style-upload.json está obsoleto respecto a src/contracts/style-upload.ts. NO lo edites a mano: 'cd nefan-core && npm run dump-style-upload', y el diff entra en el mismo commit…`. Restaurado, `git status` limpio |
| …y **Python falla claro si el snapshot falta** | ✅ cumple | Renombrado `data/contract/style-upload.json`: `python -c "import style_packs"` → `FileNotFoundError: style-upload.json not found at /home/al/code/ne-fan-241-7-qa/nefan-core/data/contract/style-upload.json. Run 'cd nefan-core && npm run dump-style-upload' to regenerate it.` Igual al importar `routers.styles`. Sin defaults inventados. Restaurado |
| …y el volcado **no** está enganchado a un `pre*` (si lo estuviera, el candado no podría ponerse rojo) | ✅ cumple | `nefan-core/package.json`: `prebuild`, `predev`, `pretest` y `precoverage` solo corren `dump-config`; `dump-style-upload` es un script suelto, como `dump-physics` |
| **Regla `la-logica-de-juego-no-vuelve-al-cliente` ROJA con un token del grupo 7 en el cliente** | ✅ cumple | Fichero `nefan-html/src/ui/qa-sabotaje-92.ts` con los 8 tokens del grupo → `✖ [error] la-logica-de-juego-no-vuelve-al-cliente … 11 !== 0`, una línea por token (`UPLOAD_FOLDER_LABELS`, `draft.length <`, `draft.length >`, `styles.filter(`, `styles.find(`, `styles.some(`, `compatible[0]`, `name.length < 2`, `tags.length === 0`, `images.length === 0`, `folder !== "surfaces"`) |
| …y **con la copia del bridge** (`draft.length < 20`) | ✅ cumple | Reintroducido en `bridge/handlers/session.ts` el `const draft = (msg.draftText ?? "").trim(); if (draft.length < 20) return fail("draft_too_short: …")` de la base → `ℹ fail 1` · `nefan-core/bridge/handlers/session.ts:165 — patrón prohibido: "draft.length <"` · `1 !== 0`. El `why` sale entero, con el párrafo de la PR 7 (borrador / elección de estilo / validación de la subida, con las líneas de dónde estaba cada copia). Restaurado; `git status` limpio |
| Regla VERDE hoy, sin falsos positivos | ✅ cumple | `npm test` → `tests 2405 · pass 2405 · fail 0` (el candado corre dentro). El probe del ingeniero afirma además que `styles.map(`, el `styleCompatibleWithGame` suelto del aviso de `start_session`, el `Record` de rótulos y un `avisos.length === 0` cualquiera NO saltan |
| **Mutación**: tres entradas con `break: "sin medir"` | ✅ cumple | `mutation-targets.json`: `borrador-de-mundo` (+ `excluidos: bridge-session.test.ts` con motivo escrito), `eleccion-de-estilo`, `style-upload` (dos ficheros de batería). Los tres `porque` nombran los mutantes **por su efecto** |
| `npm run deuda` los lista | ✅ cumple | `Deuda PARCIAL — 82 items de 2 de 3 fuentes` · `⚠️ sin medir 10 de 53 módulos (10 ficheros sin dato)`. `npm run mutacion -- pendiente` → `10 módulo(s) sin base: hostil-desde-combat, politica-de-atlas, fusible-de-skins, gates-de-imagen, params-de-telegraph, obstaculos-del-jugador, frontera, borrador-de-mundo, eleccion-de-estilo, style-upload`. **En `main` limpio: `Deuda PARCIAL — 82 items`, el mismo número** — la PR no añade deuda |
| Sin una entrada, `npm test` cae «sin dueño» | ✅ cumple | Quitado `eleccion-de-estilo` del JSON → `✖ cada fichero del perímetro puro tiene dueño…` · `AssertionError: sin dueño en data/contract/mutation-targets.json: src/session/eleccion-de-estilo.ts. Un diff que toque solo esos ficheros no seleccionaría ningún módulo y saldría verde sin medir nada` (`ℹ fail 1`). Devuelta; `git status` limpio |
| **Dos mutantes a mano mueren** | ✅ cumple | (1) `BORRADOR_MIN = 20 → 19`: `test/borrador-de-mundo.test.ts` → `ℹ pass 8 · ℹ fail 3` («19 caracteres ⇒ no vale», «los espacios de los bordes NO cuentan para el mínimo», «cada rechazo trae SU motivo, y el motivo dice el número»). (2) la preselección eligiendo el primero COMPATIBLE en vez del del mundo: `test/eleccion-de-estilo.test.ts` → `ℹ pass 7 · ℹ fail 3` («el estilo del mundo, cuando existe y casa por tema», «el que NO casa se OFRECE igual, marcado, y sigue puesto», «un mundo sin tags … se queda con el suyo»). **Dato de paso**: `bridge-session.test.ts` (53 tests) no se entera de NINGUNO de los dos — coherente con el `excluidos` escrito y con que el bridge no tenga hoy test de su elección de estilo |
| **Rastros**: solo el módulo de core y el snapshot | ⚠️ **casi** — ver H1 | `grep -rnE 'UPLOAD_FOLDER_LABELS\|REF_FOLDERS\|draft\.length\|< 20\|64000\|64_000' nefan-html/src nefan-core/bridge ai_server qa docs/arquitectura nefan-core/data/styles/README.md` → 18 líneas, y **todas menos una** son legítimas: `REF_FOLDERS` como NOMBRE derivado del snapshot (`= tuple(STYLE_UPLOAD["carpetas"])`) con sus cuatro lectores, la crónica fechada del `why` y de la cabecera de `style_packs.py`, `world_md.length < 2000` (otra regla) y la referencia a `STYLE_REF_FOLDERS` en el comentario del `Record` del título. La que sobra: `ai_server/routers/narrative.py:32` (**H1**) |
| `ui.md` y `data/styles/README.md` no cuentan la versión vieja | ✅ cumple | `ui.md` no habla del filtro ni del borrador (solo del tema de la interfaz). `data/styles/README.md` gana 7 líneas que dicen dónde vive el contrato («se declaran UNA vez, en `src/contracts/style-upload.ts` … `ai_server` los lee del snapshot») y qué solo puede mirar el servidor. `mapa.md` sitúa los tres módulos en su carpeta |
| **(e) `title-screen.ts` sube 4 líneas y el motivo es verdad** | ❌ **el número sí, el motivo no** (H3) | `wc -l`: 1.734 → **1.738**; cliente 14.188 → **14.192**; `client-file-size.json` actualizado en el mismo commit. Pero el `porque` congelado dice «lo que sube son los imports y el rótulo de las carpetas, que pasa de `Array<{id,label}>` a `Record<StyleRefFolder,string>`», y el diff dice: **36 líneas de código añadidas / 41 borradas = −5 de código** (los 3 imports incluidos) y **18 de comentario añadidas / 9 borradas = +9**. El `Record` ocupa las MISMAS 5 líneas de código que el array; su bloque crece porque su comentario pasa de 4 a 6 líneas |
| **(f) la cobertura: ¿#525 o una rama sin test?** | ✅ **es #525-shaped, no hay rama sin test** (salvo H7) | Rama: `1316 funciones medidas · cobertura de líneas 88.7%` · `✘ la cobertura de líneas bajó a 88.7% (mínimo 89%)` · `EXIT=1`. **`main` en worktree limpio** (`git worktree add --detach 1f4ab084`, `node_modules` de core y de narrative-mcp enlazados, `2353/2353 tests`): `1297 funciones medidas · cobertura de líneas 88.9%` · `✘ la cobertura de líneas bajó a 88.9% (mínimo 89%)` · `CRAP_EXIT=1`. **El gate ya estaba rojo en la base.** Análisis del `lcov` de la rama: `borrador-de-mundo` 23 líneas a cero (21 doc + `export const BORRADOR_MIN` + la línea de firma de `validarBorrador`), `eleccion-de-estilo` 34 (32 doc + el `import` + la firma), `style-upload` 29 (28 doc + el `import`): **0 funciones sin ejecutar** en los tres, **0 ramas sin tomar** en dos de ellos y **4 en `style-upload`** (H7). CRAP no se mueve: `0 por encima de 73`, `7 por encima de 30`, igual que la base |

## 2 · Las tablas, con sus números

### 2a · Elección de estilo (enumeración propia, 3.260 casos)

```
casos: 3260 (326 secuencias de estilo × 10 mundos)
BRIDGE (create_game): 0 diferencia(s)
TÍTULO (desplegable): 724 diferencia(s)
    464 × A · base bloqueaba (0 compatibles); hoy ofrece el de caída marcado
    260 × B · el estilo del mundo no casa por tema: base escondía y ponía otro; hoy lo ofrece y lo pone
con el repo tal cual (5 estilos × 4 juegos reales): 0 diferencia(s)
invariante «porDefecto ∈ ofrecidos ⟺ ofrecidos ≠ []»: 0 violación(es)
```

Y lo que ofrece hoy, mundo a mundo (los 4 reales + 6 fabricados, repo tal cual):

```
· alta_fantasia    acuarela_luminosa (del mundo) | anime | medievo_crudo | sombra_de_cuento → puesto: acuarela_luminosa
· colonia_aster    acero_neon (del mundo)                                                   → puesto: acero_neon
· cuentos_oscuros  acuarela_luminosa | anime | medievo_crudo | sombra_de_cuento (del mundo) → puesto: sombra_de_cuento
· toledo_1200      acuarela_luminosa | anime | medievo_crudo (del mundo)                    → puesto: medievo_crudo
· fab_otro_tema    acero_neon (del mundo · otro tema) | acuarela_luminosa | anime | …       → puesto: acero_neon
· fab_style_inexistente  acero_neon                                                          → puesto: acero_neon
· fab_sin_tags     acero_neon | … | medievo_crudo (del mundo) | …                            → puesto: medievo_crudo
· fab_tema_huerfano  acero_neon (otro tema)                                                  → puesto: acero_neon
```

**Nota medida, no hallazgo**: un mundo **sin `style_id` no puede existir en disco** — `GameMetaSchema` lo
exige y `listGames` lo descarta (lo escribí y el título no lo ofrecía: `el título no ofrece el mundo
fabricado "fab_sin_estilo"`). El brazo «primero compatible» de la regla solo se alcanza de verdad con un
`style_id` que ya no existe (pack borrado o renombrado), que es como acabó el bloque C del guion 92.

### 2b · Subida de un pack: `main` EJECUTADO ↔ hoy (50 cuerpos)

```
50 casos · base↔hoy: 16 idénticos · 32 mismo veredicto y otro motivo · 2 veredicto distinto
   VEREDICTO DISTINTO: 04 nombre solo espacios      (base ok → user_estilo creado · hoy 422)
   VEREDICTO DISTINTO: 05 nombre 62 brutos/60 trim  (base 422 de Pydantic · hoy ok)
base dejaba pack a medias al rechazar y hoy no: 8 casos
título↔Python: 0 motivos distintos · 3 solo los ve Python · 0 regresiones
```

### 2c · Cobertura, base ↔ rama (medidas mías, misma máquina)

| | `main` `1f4ab084` (worktree limpio) | rama `6919d120` |
|---|---|---|
| tests | `2353 · pass 2353 · fail 0` | `2405 · pass 2405 · fail 0` |
| funciones medidas | 1297 | 1316 |
| cobertura de líneas | **88,9 %** | **88,7 %** |
| `crap -- --check` | `✘ … (mínimo 89%)` · **exit 1** | `✘ … (mínimo 89%)` · **exit 1** |
| CRAP > 73 / > 30 | 0 / 7 | 0 / 7 |
| `npm run deuda` | `82 items` | `82 items` |

## 3 · Flujo real (stack propio, offset 500, cero créditos)

Título → «Nueva partida» → selector de mundos, con un mundo fabricado en `NEFAN_GAMES_DIR` del scratchpad
(copia de `alta_fantasia`, tags `fantasia/medieval`, `style_id: acero_neon`):

```
mundos ofrecidos: alta_fantasia, colonia_aster, cuentos_oscuros, fab_otro_tema, toledo_1200
· fab_otro_tema  → puesto: acero_neon · continuar: true
      acero_neon :: Acero y neón (del mundo · otro tema)
      acuarela_luminosa :: Acuarela luminosa
      anime :: Anime
      medievo_crudo :: Medievo crudo
      sombra_de_cuento :: Sombra de cuento
```

Los cuatro mundos reales, exactamente como antes. Empezar partida con el cruzado **funciona**:
`PARTIDA EN MARCHA con estilo cruzado: {"sessionId":"1788802242-c4ab42","scene":"tile_0_0","style":"acero_neon"}`,
`errores en el registro: (ninguno)`, y el bridge deja su aviso **en su terminal**:
`Bridge: estilo "acero_neon" (tags: futurista,espacial,sci-fi) no casa temáticamente con el juego
"fab_otro_tema" (tags: fantasia,medieval)` (H8).

Borrador (pantalla «Crear mundo»):

```
19 caracteres            → El borrador es demasiado corto — describe el mundo con al menos unas frases (mínimo 20 caracteres).
18 útiles con espacios   → (el mismo texto: el recorte va dentro)
64.001 caracteres        → El borrador es demasiado largo — máximo 64.000 caracteres.
20 caracteres            → (la pantalla del borrador ya no está)
mundos antes : … user_mundo_bench      mundos después: … user_mundo_bench, user_mundo_bench_2
```

Subida de un pack (pre-check del título, comparado con el `detail` de Python para el mismo cuerpo):

```
carpetas del desplegable: faces=Cara del mundo (fachada, portón, muro…) | surfaces=Lámina de materiales (rejilla de
muestras planas) | characters=Personaje (model sheet) · por defecto: faces
sin nombre, sin etiquetas, sin imagen → Ponle un nombre al estilo (entre 2 y 60 caracteres).
con nombre, sin etiquetas            → Elige al menos una etiqueta temática (máximo 8).
con nombre y etiqueta, sin imagen    → Sube al menos una imagen (máximo 12).
imagen en faces SIN descripción      → la imagen 1 necesita una descripción: solo la lámina de materiales puede ir sin ella. (fachada.jpg)
nombre 62 brutos / 60 recortado      → (pasa el pre-check y viaja) Subida fallida: HTTP 404: {"detail":"fake-ai-server: ruta desconocida POST /styles/upload"}
```

El orden de las carpetas y su valor por defecto (`faces`) no cambian, como declara el informe.

### Crítica visual (capturas en `scratchpad/qa7/capturas/`)

- `03-selector-fab_otro_tema.png` — la marca **cabe y se lee** a 1.400 px, sin truncar, con el punto medio
  del resto de la tipografía de la casa. Pero es **texto plano dentro de un `<option>`**: no hay color, ni
  peso, ni icono que diga que «otro tema» es un aviso y no una categoría. Debajo, la descripción del pack
  («Ilustración sci-fi limpia y geométrica…») contradice la del mundo («Alta fantasía luminosa…») y nadie
  lo señala: el jugador tiene que leer las dos y atar cabos. Y hay **tres marcas sin leyenda** —«(del
  mundo)», «(del mundo · otro tema)», «(otro tema)»— donde «otro tema» es ambiguo («es de otro tema» /
  «elige otro tema»). Sugerencia, no bloqueo: «(del mundo · no es de este tema)».
- `09-subida-sin-descripcion.png` — el aviso rojo está donde debe (justo encima de los botones), se lee, y
  el nombre del fichero entre paréntesis es útil de verdad con varias filas. Arista tipográfica (H6): la
  frase **empieza en minúscula** («la imagen 1 necesita…») porque la plantilla arranca con `{ref}`; las
  otras nueve empiezan en mayúscula.

## 4 · Guion nuevo — `qa/guiones/92-el-estilo-que-ofrece-el-titulo-es-el-que-pone-el-bridge.mjs`

Seis bloques, **34 asertos**, `aisla: ["saves"]`, cero créditos. **A** cada mundo del juego preselecciona el
de su `game.json`, marcado «(del mundo)», con «Continuar» habilitado. **B** el mundo de tema cruzado
—fabricado en el DISCO EFÍMERO de la corrida (`QA_RUN_TMP`, el mismo `data/games` que ve el jugador; no hay
estado sintético en el cable)— se ofrece marcado «(del mundo · otro tema)», viene puesto, no bloquea
«Continuar» y **la partida arranca de verdad con él** (`sesion().styleId`). **C** el mundo cuyo pack ya no
está cae al primero compatible, sin marca, afirmado sin reescribir la regla (lo puesto es la PRIMERA
opción). **D** el invariante `value ∈ options` en los tres casos. **E** el borrador de 19 caracteres se
rechaza con **el mismo texto** en el título y en el `create_game` del bridge por el socket del juego, y 18
útiles entre espacios se rechazan igual. **F** los 64.001 se rechazan en el título y **no sale ni un
`create_game`** por el cable (contados en la página envolviendo `WebSocket.send` antes de cargar, molde del
85). Los dos motivos se escriben **a mano** en el guion y no se importan de `MOTIVOS_DE_BORRADOR`:
importarlos no distinguiría «las dos puntas dicen lo mismo» de «las dos leen la misma constante que yo».
Los mundos fabricados se borran en un `finally`.

**Probado en negativo**, un sabotaje por vez y restaurado (`git status` limpio tras cada uno):

| Sabotaje | Resultado |
|---|---|
| `eleccionDeEstilo` eligiendo siempre el primero COMPATIBLE (el criterio viejo del título) | **6 rojos**: `A · cuentos_oscuros … puesto "acuarela_luminosa" · game.json "sombra_de_cuento"`, `A · toledo_1200 … puesto "acuarela_luminosa" · game.json "medievo_crudo"`, `B · el estilo de otro tema … SE OFRECE — opciones: acuarela_luminosa, anime, medievo_crudo, sombra_de_cuento`, `B · … MARCADO — no está`, `B · … PUESTO — puesto "acuarela_luminosa"`, `B · la partida corre con el estilo que declara el mundo — sesion().styleId = "acuarela_luminosa"` |
| El bridge devolviendo otra vez su prefijo de código (`draft_too_short: …`) | **1 rojo**, y el correcto: `E · y con EL MISMO TEXTO que enseña el título — bridge «draft_too_short: El borrador…» · título «El borrador…»`. Los demás siguen verdes |
| `BORRADOR_MIN = 20 → 19` | **rojo** en `E · el título rechaza 19 caracteres con su motivo — «🌍 El motor narrativo está desarrollando tu mundo (1-3 min)…»`, y a continuación el guion **aborta** con `✘ ERROR: page.click: Timeout 30000ms exceeded.` porque la pantalla del borrador ya no está bajo él. Es un rojo honesto (el primer aserto ya dijo lo que pasaba), pero el guion podría degradar mejor; queda dicho |

Fila añadida a `qa/README.md`. **Guion y fila quedan sin commit en el árbol**, como se pidió.

## 5 · Hallazgos

**H1 · IMPORTANTE — sobrevive una tercera declaración ejecutable del umbral del borrador, en un tercer
proceso.** `ai_server/routers/narrative.py:32`: `draft_text: str = Field(min_length=20, max_length=64_000)`.
Medido en el intérprete: `19 → 422 pydantic · 20 → ok · 64000 → ok · 64001 → 422 pydantic`. No deriva del
snapshot ni de core, **mide en BRUTO** (no recortado) y no la caza la regla, que solo escanea
`nefan-html/src/**` y `nefan-core/bridge/**`. Hay además prosa hermana en
`nefan-core/src/contracts/narrative-llm.ts:66` («Borrador del jugador, 20–64 000 chars.»). *Repro desde el
arranque*: no hay ninguno hoy — el bridge manda el texto ya recortado, así que los dos veredictos coinciden;
el estado malo se produce con un `sed` (`BORRADOR_MAX = 100_000` en core → un borrador de 70.000 pasa título
y bridge y muere en ai_server con un 422 de Pydantic que el jugador lee como `develop_world: HTTP 422 …`).
*Qué esperaba el jugador*: que «un umbral y un texto» —el titular de la PR— fuera verdad en los tres
procesos. **Origen**: preexistente; el plan (§4 fila 7) solo lista `styles.py` y `style_packs.py`, así que
no es una desviación del ingeniero, pero la PR lo deja en pie sin decirlo. **Destino**: ingeniero — o el
`Field` sale y `develop_world` confía en el bridge (declarando por qué), o se deriva del snapshot como los
números de la subida; y un token en la regla no sirve porque el fichero está fuera de su `files`.

**H2 · MENOR — un comentario de la propia PR queda falso.** `nefan-core/bridge/handlers/session.ts:383-385`
justifica que el aviso de compatibilidad sea un warning y no un abort porque «**el selector del título ya
filtra**». Esta PR es exactamente la que le quitó el filtro al título. Es prosa rancia en un fichero que la
PR toca, del tipo que la memoria del repo llama «los rastros confunden a los agentes». **Origen**: esta PR.
**Destino**: ingeniero (una línea).

**H3 · MENOR — el `porque` congelado de `client-file-size.json` no es lo que dice el diff.** Ver la fila (e)
de § 1: el código **baja 5 líneas** y suben **9 de comentario**; el `Record` ocupa las mismas 5 líneas de
código que el array que sustituye. El informe del ingeniero lo cuenta bien; lo que queda escrito en el
contrato —que es lo que leerá el siguiente— no. **Origen**: esta PR. **Destino**: ingeniero (reescribir el
tramo del `porque`, sin tocar la cifra 1.738, que es correcta).

**H4 · MENOR — los motivos de los MÁXIMOS están redactados como si fueran mínimos.** 13 imágenes →
`Sube al menos una imagen (máximo 12).`; 9 etiquetas → `Elige al menos una etiqueta temática (máximo 8).`
*Repro*: título → «🎨 Subir estilo» → añadir 13 filas con imagen, «Subir». *Qué esperaba el jugador*: que le
dijeran que se ha pasado, no que suba al menos una. El número correcto va en el paréntesis, así que se
entiende leyendo entero; es una arista, no un error. **Origen**: texto NUEVO de esta PR (antes el título ni
miraba esos dos límites y el 422 de Pydantic era peor). **Destino**: ingeniero, dos plantillas en
`MOTIVOS_DE_SUBIDA` (y el snapshot con ellas).

**H5 · MENOR — los tres rechazos que solo puede ver el servidor llegan al jugador como JSON crudo.**
`title-screen.ts:1280` lanza `HTTP ${res.status}: ${await res.text()}` y `:1293` lo pinta: el jugador lee
`Subida fallida: HTTP 422: {"detail":"Id duplicado: torre"}`. Lo vi en pantalla con el 404 del motor falso.
Justo los tres casos que el título no puede cazar (base64 ilegible, imagen no decodificable, slug duplicado)
son los que pierden el motivo cuidado que esta PR comparte. **Origen**: preexistente (la base hacía lo
mismo); la PR lo convierte en el único camino de rechazo del servidor. **Destino**: issue.

**H6 · MENOR — dos motivos empiezan en minúscula.** Los dos cuya plantilla arranca con `{ref}`
(`sin_descripcion` y `imagen_vacia`) se pintan como `la imagen 1 necesita una descripción: …` y
`la imagen 1 no trae ninguna imagen.`; los otros diez empiezan en mayúscula. Captura
`09-subida-sin-descripcion.png`. **Origen**: esta PR. **Destino**: ingeniero, si le parece que vale la línea.

**H7 · MENOR — cuatro ramas de la NORMALIZACIÓN sin un solo aserto.** `src/contracts/style-upload.ts`
líneas 162, 171, 175 y 177 (`BRDA` sin tomar): el `description` del pack, el `style_token` y el `id` de
imagen **en el camino de ÉXITO** — o sea, lo que de verdad viaja al servidor
(`body: JSON.stringify(comprobado.subida)`). Ningún test comprueba que la `subida` devuelta los conserve, y
un mutante que los tirara del `.transform` sobreviviría al suite entero (Python no la usa). Hoy es
inalcanzable desde el título (no recoge esos campos), por eso es menor. **Origen**: esta PR (hueco de la
batería nueva). **Destino**: ingeniero, un test de 4 líneas.

**H8 · MENOR (experiencia) — con la conducta (a), arrancar con un estilo de otro tema es el camino POR
DEFECTO y el único aviso es un paréntesis.** El aviso del bridge existe y se dispara
(`Bridge: estilo "acero_neon" … no casa temáticamente con el juego "fab_otro_tema"`) pero es un
`console.warn` del servidor: `__nefan.errores()` queda vacío y el jugador no ve nada una vez dentro. Antes
de esta PR el estado era inalcanzable (el título forzaba un compatible); ahora viene preseleccionado.
**Origen**: mitad conducta declarada por el usuario, mitad preexistente (ya lo apuntaba el hallazgo 5 del
ingeniero). **Destino**: issue, si se quiere que el aviso llegue al registro del jugador.

## 6 · Workarounds usados

| Workaround | Veredicto |
|---|---|
| **Mundo fabricado** (`fab_otro_tema`, `fab_pack_borrado`) en `NEFAN_GAMES_DIR` del scratchpad y en el disco efímero de la corrida | **No es hallazgo.** Es el mismo `data/games` que ve el jugador y se llega ahí por dos caminos suyos: borrar un pack, o que `develop_world` le proponga un `style_id` de otro tema. No oculta ningún obstáculo — al contrario, produce uno que el juego no trae hoy |
| **Copiar `ai_server` a un árbol temporal** y sobrescribir `routers/styles.py` y `style_packs.py` con los de `1f4ab084` para EJECUTAR el Python de la base | **No afecta al jugador.** Solo mide la base; el árbol de trabajo no se toca (`git status` limpio) |
| **`_styles_dir_from_config` parcheado** a un `mkdtemp` en el harness de Python | **No afecta al jugador.** Es para no escribir 50 packs en `data/styles` del repo; sin él, el mismo código haría lo mismo en el directorio real |
| **Worktree limpio de `main` con `node_modules` enlazados por symlink** para medir su cobertura | **Declarado.** La primera corrida perdió `test/contract-fixtures.test.ts` (`Cannot find package '@nefan/core'`) por faltar el link de `narrative-mcp/node_modules`; se enlazó y se repitió, y la segunda corrida es la que se cita (`2353/2353`, 88,9 %). El worktree se retiró al terminar (`git worktree remove`) |
| **Sonda propia con `playwright-core`** en vez del Playwright MCP | Obligado por el encargo (MCP compartido). Sin efecto en lo medido: usa `abrirNavegador` del banco, misma GPU y mismos args que `qa/run.mjs` |

## 7 · No probado

- **La subida de un pack POR EL CABLE, end-to-end.** El preset `e2e-sin-creditos` no levanta remote-gen
  (`POST /styles/upload` no existe ahí: lo vi como `HTTP 404 {"detail":"fake-ai-server: ruta desconocida
  POST /styles/upload"}`) y arrancarlo con offset ≠ 0 está prohibido. **En su lugar**: los dos endpoints
  Python EJECUTADOS en proceso con 50 cuerpos, que es más fuerte que un test pero no es el cable.
- **La mutación de los tres módulos.** Sin base previa; `npm run mutacion -- local <id>` la rechaza por coste
  desconocido, como estaba previsto. Llega con la autorización 2.
- **El caso «sin ni un style pack instalado»** en vivo (habría que vaciar `data/styles` del árbol). Medido
  por función (`porDefecto === null` con lista vacía, 0 violaciones del invariante) y por test.
- **Gasto real de créditos**: cero en toda la verificación. El guardarraíl lo declaró en cada guion
  (`⛨ guardarraíl: cliente y bridge declaran fake:true`); el contador del motor falso al final de la
  batería marca solo rutas del fake.
- **El CI del runner**: `crap -- --check` sale rojo aquí en las dos ramas; si en el runner de GitHub sale
  verde con otro reparto de la coverage de V8, eso no lo puedo medir desde esta máquina.

## 8 · Verificación ejecutada (salida literal)

```
nefan-core · npm run verify   → ℹ tests 2405 · ℹ suites 429 · ℹ pass 2405 · ℹ fail 0 · duration_ms 21813
nefan-core · npm run coverage → 1316 funciones medidas · cobertura de líneas 88.7% · complejidad máxima 46
nefan-core · npm run crap -- --check → ✘ la cobertura de líneas bajó a 88.7% (mínimo 89%)   [main: 88.9%, también ✘]
nefan-core · npm run deuda    → Deuda PARCIAL — 82 items de 2 de 3 fuentes                  [main: 82 items]
nefan-html · npx tsc --noEmit → TSC exit 0 ; npm run lint → sin avisos ; npm run build → ✓ built in 1.50s
ai_server  · python -m unittest discover -s ai_server/tests → Ran 240 tests in 20.579s · OK
ai_server  · ruff check ai_server → All checks passed!
```

**Batería completa**, sin retocar ningún guion, a la primera:

```
91 en verde · 0 en rojo de 91 · capturas en /home/al/code/ne-fan-241-7-qa/qa/capturas/2026-09-07T17-38-54-332Z-604171
```

Cero rojos y cero `⊘`: no hubo que repetir ninguno. Los dos `⚠ HALLAZGO` que imprime la corrida son los
preexistentes que ya documentaron QA-3 (#483, el registro de errores tapa el chip de gráficos) y QA-6 (#352,
el modal por un frame rechazado en el bridge); ninguno es de esta PR.

**Veredicto: APTO CON RESERVAS** — la PR entra; H1 (la tercera copia del umbral en `ai_server`) y H3 (el
motivo congelado que el diff contradice) deberían cerrarse antes de #346, que es lo siguiente que toca ese
fichero.

---

## Vuelta (2026-09-07)

Segundo commit en `programa-241/7-titulo`, mismo worktree `/home/al/code/ne-fan-241-7`, stack propio
`NEFAN_PORT_OFFSET=100` (no hizo falta levantarlo: los guiones eligen su bloque solos). Se cierran **H1, H2,
H3 y H7**; **H4, H5 y H6** van a **#536** y **H8** a **#537**, ya abiertos, y no se tocan aquí.

### H1 · el umbral del borrador tiene una sola fuente también en Python

La copia en bruto de `ai_server/routers/narrative.py:32` (`Field(min_length=20, max_length=64_000)`) muere.
Los dos números siguen viviendo en `src/protocol/borrador-de-mundo.ts` y ahora VIAJAN, con el molde exacto de
`physics.json` y del `style-upload.json` de esta misma PR:

| Pieza | Qué |
|---|---|
| `src/protocol/borrador-de-mundo.ts` | `borradorSnapshot()` → `{$comment, min, max}`. Los MOTIVOS **no** viajan y está escrito por qué: ai_server no los emite (su rechazo es el 422 estructurado de Pydantic), así que mandárselos sería contrato muerto |
| `scripts/dump-borrador-de-mundo.ts` + `npm run dump-borrador-de-mundo` | vuelca `data/contract/borrador-de-mundo.json`. **NO** enganchado a los hooks `pre*`, por el motivo escrito en `dump-physics.ts`: si se regenerase solo, el candado de frescura no podría ponerse rojo nunca |
| `test/contract-borrador-de-mundo.test.ts` (3 casos) | lo commiteado es lo que produce la fuente de hoy; lleva las dos claves que Python exige y **no** lleva `motivos`; mínimo entero, positivo y por debajo del máximo |
| `ai_server/narrative_schemas.py` | `_load_contract_borrador()` fail-loud (mismo molde que `_load_contract_physics`) → `BORRADOR_MIN` / `BORRADOR_MAX` |
| `ai_server/routers/narrative.py` | `Field(min_length=BORRADOR_MIN, max_length=BORRADOR_MAX)`, con el docstring diciendo que el texto llega ya recortado del bridge y que esto es la red de debajo |
| `ai_server/tests/test_borrador_de_mundo_contract.py` (4 casos) | el **router REAL** montado en una app pelada: 19 → **422**, 20 → **503** («LLM backend not initialised»: pasó el umbral y murió por falta de motor, que es justo la distinción), 64.000 → 503, 64.001 → 422; lo que aplica Pydantic es lo que hay en el JSON commiteado; y sin snapshot, `FileNotFoundError` con el comando dentro |
| `data/contract/arch-rules.json` | regla nueva **`el-umbral-del-borrador-no-se-copia-a-mano`**, hermana de `la-fisica-no-se-copia-a-mano` (mismos `files` más `nefan-core/bridge/**`), porque el H1 decía bien que un token del grupo 7 no sirve: `ai_server` no está en sus `files`. Su `why` cuenta la copia medida y **lo que NO caza** (un nombre nuevo, un `len(texto) < 20` a pelo) |
| `test/architecture.test.ts` | probe del grupo: las dos formas de re-declararlo saltan en los cinco procesos, y leer el snapshot / derivar el `Field` / nombrar la constante en prosa / mandar un `draft_text` cualquiera, no |
| `data/contract/mutation-targets.json` | `borrador-de-mundo` pasa a batería de DOS ficheros (como `style-upload`) y su `porque` nombra el mutante nuevo: un `borradorSnapshot()` que devuelva otro número deja a ai_server rechazando con 422 lo que el título y el bridge aceptan |
| `src/contracts/narrative-llm.ts:65` | la **prosa hermana** («Borrador del jugador, 20–64 000 chars.») deja de repetir los números y apunta a `validarBorrador` |

`grep -rn '64_000\|64000\|min_length=20' ai_server nefan-core nefan-html labs qa` tras la vuelta: **ni una sola
declaración ejecutable fuera de la fuente**. Lo que queda, revisado línea a línea: `BORRADOR_MAX = 64_000` en
`src/protocol/borrador-de-mundo.ts` (la fuente) y `"max": 64000` en el snapshot que sale de ella; los TESTS que
miden el filo (`borrador-de-mundo.test.ts`) y los que citan la copia retirada como texto de un caso
(`architecture.test.ts`, el probe nuevo y el del grupo 7); y **crónica fechada** —el `why` de la regla nueva,
la cabecera del módulo, el comentario de `narrative_schemas.py`, el docstring del `DevelopWorldRequest` y el del
test Python—, que cuenta qué había y por qué se fue, como hicieron la PR 1 y el `why` de
`la-fisica-no-se-copia-a-mano`. Ninguna de esas líneas la lee nadie para decidir nada.

**Probado en negativo, un sabotaje por vez y restaurado** (`git status` limpio tras cada uno):

| Sabotaje | Resultado |
|---|---|
| `BORRADOR_MAX = 100_000` en la fuente, sin volver a volcar | `contract-borrador-de-mundo.test.ts` → `pass 1 · fail 2`, con `AssertionError: borrador-de-mundo.json está obsoleto respecto a src/protocol/borrador-de-mundo.ts. NO lo edites a mano: 'cd nefan-core && npm run dump-borrador-de-mundo', y el diff entra en el mismo commit…` |
| Borrar `data/contract/borrador-de-mundo.json` e importar `narrative_schemas` (y `routers.narrative`) | `FileNotFoundError: borrador-de-mundo.json not found at /home/al/code/ne-fan-241-7/nefan-core/data/contract/borrador-de-mundo.json. Run 'cd nefan-core && npm run dump-borrador-de-mundo' to regenerate it.` — sin defaults inventados |
| Devolver a `narrative.py` la línea EXACTA que había (`Field(min_length=20, max_length=64_000)`) | `✖ [error] el-umbral-del-borrador-no-se-copia-a-mano` · `ai_server/routers/narrative.py:47 — patrón prohibido: "draft_text: str = Field(min_length=20, max_length=6"` · `1 !== 0` |
| Separar el máximo de Python del snapshot (`max_length=100_000`) | `test_borrador_de_mundo_contract` → `FAILED (failures=2)`: `AssertionError: {'min_length': 20, 'max_length': 100000} != {'min_length': 20, 'max_length': 64000}` y, la que importa porque es conducta, `AssertionError: 503 != 422` (64.001 caracteres dejaban de rechazarse) |

### H2 · el comentario que la propia PR dejó falso

`bridge/handlers/session.ts` ya no dice «el selector del título ya filtra». Dice la verdad: sigue siendo
warning y no abort porque el matching es heurístico y un typo en un tag no debe brickear una partida, **y**
que desde la PR 7 el título ya no filtra —ofrece el estilo del mundo marcado «(del mundo · otro tema)» y
preseleccionado—, así que este aviso es lo único que queda; hoy es un `console.warn` que el jugador no ve, y
que llegue a su registro lo pide **#537**.

### H3 · el `porque` congelado, con el diff medido de nuevo

Medido por mí sobre el commit, no copiado de la ficha de arriba
(`git show 6919d120 -- nefan-html/src/ui/title-screen.ts`, clasificando cada línea `+`/`−`):

```
añadidas: codigo 36 comentario 18 blancas 0 | total 54
borradas: codigo 41 comentario  9 blancas 0 | total 50
delta codigo -5 · delta comentario +9 · 1734 → 1738
```

Y el detalle del `Record`, también medido: el `Array<{id,label}>` eran 5 líneas de código con 4 de comentario;
el `Record<StyleRefFolder,string>` son **las mismas 5** con **6** de comentario. El `porque` de
`client-file-size.json` dice ahora eso, con la cifra 1.738 intacta.

### H7 · las cuatro ramas del `.transform`

Dos tests nuevos en `test/style-upload.test.ts`, sobre el camino de ÉXITO, que es lo que de verdad viaja
(`body: JSON.stringify(comprobado.subida)`): (1) la descripción del pack y el `style_token` salen recortados y
el `id` de la imagen sale **intacto** (es el que entra en la clave de caché); (2) lo que no se mandó no se
inventa — la lámina sin `description` ni `id` sale con cadena vacía y sin `id`, y los dos opcionales del pack
no aparecen. Medido en el `lcov` de la corrida de esta vuelta: `src/contracts/style-upload.ts` pasa de **4
ramas sin tomar a `BRF:53 · BRH:53`**, o sea las 53 tomadas.

**Mutantes a mano** (restaurados): el `.transform` tirando el `id` de la imagen → `pass 28 · fail 1`, y el
mismo test rojo; el `.transform` tirando el `style_token` → `pass 28 · fail 1`.

### Guion 92

`qa/guiones/92-…mjs` y su fila **entran en el commit**: la fila se insertó en `qa/README.md` justo detrás de la
del `91-`, y `docs/agents/2026-09-07-el-cliente-solo-pinta/fila-92.txt` se borró. `node qa/run.mjs 92` →
`1 en verde · 0 en rojo de 1`; `node qa/run.mjs 07 12 18 19 27 28 33 52` → `8 en verde · 0 en rojo de 8`. Cero
créditos (motor falso), y el bloque de puertos lo eligió `run.mjs`; `ss -ltn` antes y después, sin nada ajeno
tocado y sin un solo `pkill`.

### Verificación de la vuelta (salida literal)

```
nefan-core · npm run verify   → ℹ tests 2412 · ℹ suites 430 · ℹ pass 2412 · ℹ fail 0 · duration_ms 21410
nefan-core · npm run coverage → 1317 funciones medidas · cobertura de líneas 88.8% · complejidad máxima 46
nefan-core · npm run crap -- --check → ✘ la cobertura de líneas bajó a 88.8% (mínimo 89%) · EXIT=1
                                        Tope CRAP ≤ 73 — 0 por encima · CRAP ≤ 30 — 7 por encima
nefan-core · npm run deuda    → Deuda PARCIAL — 82 items de 2 de 3 fuentes
nefan-html · npx tsc --noEmit → TSC exit 0 ; npm run lint → sin avisos ; npm run build → ✓ built in 1.54s
ai_server  · python -m unittest discover -s ai_server/tests → Ran 244 tests in 20.592s · OK
ai_server  · ruff check ai_server → All checks passed! ; python -m compileall -q ai_server labs → OK
qa         · node qa/run.mjs 92 → 1 en verde · 0 en rojo de 1
qa         · node qa/run.mjs 07 12 18 19 27 28 33 52 → 8 en verde · 0 en rojo de 8
```

`crap -- --check` **sigue rojo, y sigue estándolo por lo mismo**: ya lo estaba en `main` con 88,9 %. La rama
estaba en 88,7 % y esta vuelta la deja en **88,8 %** (los tres tests nuevos cubren código nuevo), o sea que no
la empeora; CRAP no se mueve (0 > 73, 7 > 30) y `deuda` sigue en 82 items. La mutación de los tres módulos
sigue **sin medir** hasta la autorización 2, ahora con un mutante más nombrado en el `porque`.
