# QA — PR B (#375): el perfil de repintado entra en la clave del arte vestido

Validado sobre `61de342` en el worktree `.claude/worktrees/t8-qa-b` (detached), el 2026-09-03.
Contra la petición ORIGINAL (`requisitos.md` + el texto literal del issue #375 leído de GitHub),
no contra el plan. **Cero créditos**: ni una llamada a `/identity` ni a `/skins`; el ledger de
gasto del checkout principal quedó intacto (mtime 2026-09-02, sin tocar).

**Veredicto: APTO CON RESERVAS.** El criterio de cierre del issue está cumplido y su candado
probado en rojo de tres formas distintas, incluida la que el coordinador pedía especialmente
(«¿y si alguien lo mete pero mal?»). Las reservas no rompen la funcionalidad: son un candado del
repo que la PR deja en ROJO sin poder devolverlo a verde en esta máquina, un fail-loud de los
tres declarados que no tiene candado, y un guion de barrido cuyo alcance es más ancho que su
nombre.

---

## Criterios

| # | Criterio (literal) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | «Cambiar `keyframes` … de una anim **en el set** produce una clave distinta» | ✅ | `qa/perfil-de-repintado-en-la-clave.mjs`, contra el sprite-forge REAL y el contenido del set VIVO: `idle` 8→10 kf mueve la clave del vestido `bec8c72eee758842` → `e247b7e496123720`. Revertir la devuelve |
| 2 | «… o `play_fps` …» | ✅ | Mismo guion: 2,2→3,7 fps → `14d38e6fa3647b53`. Revertir la devuelve |
| 3 | «dos llamadas a la función de clave con perfiles distintos tienen que dar hashes distintos» | ✅ | `test_cada_MITAD_del_perfil_cambia_la_clave` + `test_cada_campo_cambia_la_clave_del_sheet` (fila `perfil`). Corridos: `Ran 46 tests … OK` |
| 4 | «el candado es un test que se ponga rojo si el perfil deja de entrar» | ✅ **probado en negativo por mí** | Mutante 1 (quitar `perfil_txt` del payload de `_skin_sheet_key`): **3 tests rojos**, `test_cada_campo_cambia_la_clave_del_sheet` («cambiar "perfil" NO cambió la clave»), `test_cada_MITAD_del_perfil_cambia_la_clave` y `test_cambiar_el_perfil_de_la_anim_da_OTRO_hash`. Revertido, `git diff` vacío |
| 5 | El candado también caza al que lo mete **MAL** | ✅ | Mutante 2 (`perfil_txt = json.dumps(list(perfil))`, o sea hashear el crudo en vez de los dos campos normalizados): rojo en `test_el_perfil_no_distingue_un_entero_de_su_float`. Mutante 3 (solo `keyframes`): 2 rojos, uno nombrando `play_fps` |
| 6 | «`4` y `4.0` son el mismo perfil» (afirmación del ingeniero) | ✅ **y el caso es real, no hipotético** | Comprobado en positivo (`k((4,4)) == k((4,4.0))`, `k((4,2.2)) == k((4.0,2.2))`) y en negativo (mutante 2). Y el catálogo del servicio REAL publica `play_fps: 4` como **entero** para 10 de las 16 anims (`run`, `quick`, `heavy`, `hit_react`, `death` y las 6 ambientales): sin la normalización, esas repagarían |
| 7 | Sin colisión entre las dos mitades | ✅ | `k((1,44.0)) ≠ k((14,4.0))` y `k((44,1.0)) ≠ k((4,41.0))`: el separador `kf@…fps` aguanta |
| 8 | «Decidir de paso **dónde** entra … No son equivalentes» | ✅ **medido, no supuesto** | Docstring de `_skin_sheet_key` con la razón. Y en el guion: los dos cambios de perfil mueven la clave del vestido y dejan `base_key` en `84b8b91255a268db`, idéntica |
| 9 | La decisión sobre `version`/#369-R7, escrita con su coste | ✅ | Docstring de `_skin_sheet_key`, con el coste (~16 llamadas por NPC) y la razón (identidad ajena; filtrarla desde el consumidor es el espejo que deriva) |
| 10 | «El set tiene 16 anims y 6 no declaran perfil» → declararlas **no mueve ninguna clave** | ✅ **verificado por mí, no creído** | Dos sprite-forge reales, uno con el set de `HEAD~1` y otro con el de la PR: `diff` de los 16 perfiles publicados → **SIN DIFERENCIAS**. Y `PERFIL_POR_DEFECTO` de sprite-forge es literalmente `{keyframes: 4, play_fps: 4.0}` (`src/anim-profile.mjs`) |
| 11 | El candado de las 16 se pone rojo si una no declara perfil | ✅ | `npm test -- test/sprite-set.test.ts` verde con el set de la PR (4/4); contra el set de `HEAD~1`, mi guion lo nombra: «sin perfil declarado: talking, drinking, wounded_idle, sitting_idle, waving, praying» |
| 12 | Camino degradado: la forma vieja de `_base_keys.json` se trata como ausente **y se dice** | ✅ | 9 escenarios propios a nivel de ENDPOINT (forma vieja, entrada nueva sin `perfil`, perfil a medias, fichero truncado, `keyframes: 0`, booleano, `play_fps` string, JSON que no es objeto): **503 en los 9**, y el warning literal «índice de base_keys con la forma anterior a #375 (N de M entradas sin perfil de repintado); se ignora ENTERO y se reconstruye al vuelo» |
| 13 | … y con el servicio de VERDAD caído, lo YA PAGADO se sigue sirviendo | ✅ | `node qa/sprites-sin-servicio.mjs` → **VERDE 4/4** (con un sujeto alcanzable): 200 `cached` con 64 URLs con el servicio muerto, y el índice reconstruido en la forma nueva (`{base_key, perfil}`) |
| 14 | Los tres fail-loud del 502 dicen POR QUÉ | ✅ los mensajes · ⚠️ **uno sin candado** | Los cuatro salen con su causa (ver abajo). Pero el mutante M4 muestra que el tercero no tiene test → **hallazgo 2** |
| 15 | La desviación `_forge` → `_forge_http(metodo, …)`: «sin eso el GET se queda sin la degradación por 503» | ✅ **la afirmación es cierta** | Escenario propio: `/sheets` vivo + `/catalog` respondiendo 503 → el endpoint **degrada** (200 `cached`, mismo hash). Con `/catalog` en 500 → 502 con la causa, que es lo correcto (no hay nada que servir con una clave que no se puede componer) |
| 16 | Barrido en la MISMA PR, con sus cifras | ✅ el guion y las cifras · ⚠️ no ejecutado (es del coordinador) | Recontadas por mí sobre el disco, sin usar su tabla: **27 sheets · 1.152 frames · 28,6 MB · $17,28**. Idénticas |
| 17 | Los 27 sheets quedan de verdad inalcanzables | ✅ | Reimplementé la fórmula VIEJA y con los datos reales de `05fe989fd80962fb/meta.json` da exactamente `05fe989fd80962fb`, el nombre del directorio en disco; la nueva da `bec8c72eee758842` |
| 18 | Suite Python + ruff | ✅ | `python -m unittest discover -s ai_server/tests` → `Ran 178 tests … OK`; `ruff check ai_server` → `All checks passed!`. Las cifras del ingeniero cuadran |
| 19 | `npm run verify` verde | ⚠️ **no probado entero** | Corrí solo `npm test` (1873 pass, 1 fichero rojo). Ese rojo —`test/contract-fixtures.test.ts`— **falla igual en `HEAD~1`**: es artefacto de mi worktree (node_modules enlazado del checkout principal, `@nefan/core` resuelve a otra build). No es de esta PR. Build, typechecks y lint no los corrí |
| 20 | Cero créditos | ✅ | sprite-forge siempre con `--sin-skin` (sin worker: `/identity` y `/skins` devuelven 503 por construcción) y solo `GET /catalog` + `POST /sheets format=none`. `cache/spend/events.jsonl` del checkout principal intacto |
| 21 | `qa/sprites-sin-servicio.mjs` en su estado ACTUAL | ❌ **ROJO** | Con el `cache/` de hoy: 2 de 4 comprobaciones fallan → **hallazgo 1** |

### Los cuatro mensajes del fail-loud, literales

```
[anim que el catálogo no conoce]
  sprite-forge no conoce la anim "walk" en su catálogo: no se puede saber con qué perfil la repintaría
[skin_plan_error]
  sprite-forge no puede repintar "rota": "rota": keyframes debe ser > 0 (era 0)
[keyframes/play_fps inutilizables]
  sprite-forge publica "walk" sin perfil de repintado utilizable (keyframes=None, play_fps=None)
[catálogo sin animations]
  sprite-forge /catalog no trae "animations": sin perfil para "walk"
```

Ninguno es un 502 mudo, y en los cuatro casos se comprobó que **no se llama a `/skins`**.

---

## Hallazgos

### 1 · IMPORTANTE — la PR deja `qa/sprites-sin-servicio.mjs` en ROJO y su receta de recuperación no se puede ejecutar en esta máquina

**No es «falta de sujeto tras el barrido», como dice `implementacion-b.md`: está rojo HOY, antes
del barrido**, porque la clave se movió y los 27 sheets ya no los encuentra nadie.

Repro, desde cero:

```bash
# worktree con el código de la PR y una copia del cache/sprite_sheets de hoy
node qa/sprites-sin-servicio.mjs
```

```
sujeto: y_bot/idle/frontal_8 — "Blas, el tabernero" (hash 05fe989fd80962fb)
  ✘ servicio arriba: esperaba 200 cached con urls, salió 503 {"detail":"sprite-forge /skins: el worker de repintado no se ha arrancado todavía"}
  ✘ servicio caído: el arte PAGADO desapareció — 503 {"detail":"sprite-forge no responde y \"Blas, el tabernero\" no está en la caché de y_bot/idle/frontal_8: no se puede generar"}
  ✔ servicio caído + personaje nuevo: 503 que explica la causa
  ✔ sin el índice de base_keys, el mismo pagado ya NO se puede servir
ROJO — 2 comprobación(es) fallaron.
```

**El guion NO está roto por el código.** Lo comprobé: en cuanto existe un sheet bajo la clave
NUEVA, el mismo guion sale **VERDE 4/4** con el adaptador de la PR y el servicio real muerto a
media prueba. Lo que le falta es el sujeto.

**Y el sujeto no se puede fabricar aquí.** La receta que la PR escribe en `qa/README.md` y en el
mensaje de error del guion —«arranca `sprite-forge` con `SPRITE_FORGE_IMAGE_API=fake` y pide un
`/skin_sprite_sheet` cualquiera»— necesita el worker de repintado, que necesita `rembg`
(466 MB). Medido:

```bash
SPRITE_FORGE_IMAGE_API=fake SPRITE_FORGE_PYTHON=<venv de ne-fan> node bin/sprite-forge.mjs serve …
  ! repintado NO disponible: falta `rembg` (quita el fondo del repintado): pip install -r python/requirements.txt
GET /catalog → {"enabled": false, "reason": "falta `rembg` …"}
```

`rembg` no está ni en el venv de ne-fan ni en sprite-forge (que no tiene venv). O sea: al
mergear, un candado del repo queda en rojo **por diseño**, y devolverlo a verde exige una
instalación de 466 MB que nadie ha pedido. Un rojo permanente que todo el mundo aprende a
ignorar es peor que no tener candado (`feedback_verde_que_no_comprueba`, al revés).

*Qué esperaba*: que la PR que mueve la clave deje el candado del arte pagado en verde —
regenerando un sujeto, o convirtiendo el «sin sujeto ⇒ ROJO» en un `⊘ SIN MEDIR` con su motivo,
que es la forma que la casa tiene para «no pude medir» (`qa/README.md`, regla 6). Cualquiera de
las dos vale; dejarlo en rojo sin decirlo en el README, no.

### 2 · MENOR — el tercero de los tres fail-loud del 502 no tiene candado

Mutante M4, sobre `_perfil_efectivo`:

```python
-    if not _keyframes_valido(kf) or not _play_fps_valido(fps):
+    if False:
```

→ `Ran 46 tests in 15.9s` · **OK**. La suite entera sigue verde.

`test_una_anim_que_NO_SE_PUEDE_repintar_es_502_con_su_causa` no lo cubre: la fixture canónica
`rota` trae `skin_plan_error`, así que sale por la rama anterior. Con un catálogo que publicara
`keyframes: 0` sin `skin_plan_error`, el mutante compondría la clave `0kf@0.0fps` **en silencio**
— exactamente el saneado que la casa prohíbe. Hoy sprite-forge no puede producir ese catálogo
(`costeDeCatalogo` siempre empareja los nulls con su `skin_plan_error`), pero el fail-loud existe
justo porque el servicio vive en otro repo y otra versión.

El test que falta lo escribí en mi batería adversarial y pasa contra el código de la PR:

```python
def test_3_perfil_inutilizable_SIN_skin_plan_error(self):
    cat = json.loads(json.dumps(self.forge.respuestas["/catalog"]))
    for a in cat["animations"]:
        if a["id"] == "walk":
            a["keyframes"], a["play_fps"] = None, None
            a.pop("skin_plan_error", None)
    self.forge.respuestas["/catalog"] = cat
    r = self.pedir()
    self.assertEqual(r.status_code, 502, r.text)
    self.assertNotIn("/skins", self.forge.rutas_pedidas("POST"))
```

Comparados, M5 (borrar la rama de `skin_plan_error`) y M6 (que la degradación deje de leer el
perfil del índice y use `(4, 4.0)`) **sí** se ponen rojos. Es una sola rama la que falta.

### 3 · MENOR — `archivar_sheets_varados.py` no archiva «los varados»: archiva TODOS

Su regla es «directorio con `meta.json`», sin comprobar si la clave sigue siendo alcanzable.
Repro:

```bash
# un sheet bajo la clave VIVA de hoy (bec8c72eee758842 = la que compone el adaptador ahora)
mkdir -p /tmp/cache-sim/bec8c72eee758842 && cp <meta real> /tmp/cache-sim/bec8c72eee758842/
python ai_server/tools/archivar_sheets_varados.py --cache /tmp/cache-sim --archivo /tmp/archivo-sim
```

```
hash              model/anim/angle      frames      MB      $  prompt
bec8c72eee758842  y_bot/idle/frontal_8       1     0.0   0.00  Blas, el tabernero
TOTAL             1 sheets                    1     0.0
```

Lo lista para archivar aunque sea arte perfectamente servible. El nombre del fichero, el
docstring («los sheets VESTIDOS que **una clave nueva ha dejado inalcanzables**») y el mensaje
final prometen algo más estrecho de lo que hace. Mitigado por el dry-run por defecto y por la
tabla que hay que leer, pero es un guion de un solo uso sobre arte pagado y **es rerunnable**:
regenerar arte con la clave nueva y volver a correrlo se lo lleva.

*Qué esperaba*: o que compruebe la alcanzabilidad (`_skin_sheet_key` con el catálogo vivo), o que
el nombre y el docstring digan «archiva TODO lo que hay en la caché de sheets vestidos», que es
lo que hace.

### 4 · MENOR — el rechazo del índice es por FICHERO, y reconstruirlo PIERDE las entradas buenas

Declarado en §9.2 del plan («un fichero con la forma vieja se trata como ausente»), pero el
radio de daño no está escrito. Repro (mis tests J y K, y observado además en la corrida real):

1. Se apuntan 3 triples (`idle`, `run`, `walk`).
2. Una sola entrada en forma vieja ⇒ `_leer_bases()` devuelve `{}`: **el arte pagado de los tres**
   deja de ser alcanzable con el servicio caído.
3. La siguiente petición con el servicio vivo vuelca el fichero ENTERO con **una** entrada, y las
   otras dos se pierden para siempre.

Observado en vivo: el `_base_keys.json` de mi copia, tras la corrida verde de
`sprites-sin-servicio.mjs`, quedó con **solo** `y_bot/idle/frontal_8` — antes tenía los tres.

Y ese es el estado exacto del día del merge: el `_base_keys.json` real de hoy está **entero** en
la forma vieja (`{"y_bot/idle/frontal_8": "84b8b91255a268db", …}`), así que tras mergear, con el
servicio caído, solo será alcanzable el arte de los triples que se hayan vuelto a pedir con el
servicio vivo. Es pequeño porque el índice se reconstruye solo, y consistente con
«pre-producción, cero compatibilidad»; pero merece una línea, porque es la propiedad más cara de
esta zona.

### 5 · OBSERVACIÓN — el warning se equivoca de causa cuando la entrada es NUEVA pero el perfil es inválido

Una entrada `{"base_key": "…", "perfil": {"keyframes": 0, "play_fps": 4.0}}` —forma nueva, perfil
roto— sale reportada como «índice de base_keys **con la forma anterior a #375** … sin perfil de
repintado». Lo mismo con `play_fps: "4.0"` (string) o `keyframes: true`. El comportamiento es
correcto (se ignora entero); el mensaje manda a quien lo lea a buscar una migración que no es.

### 6 · OBSERVACIÓN — el camino caliente pasa de una llamada al servicio a dos, también en cache-hit

`GET /catalog` se pide **antes** de mirar la caché, en cada `/skin_sprite_sheet`. Es gratis y el
plan lo declaró (riesgo 2), y la degradación por 503 lo cubre (criterio 15, verificado), así que
no es bloqueante. Pero `/catalog` relee el set y resuelve el índice de assets en cada llamada, y
es un fallo más en el camino que sirve arte ya pagado.

### 7 · OBSERVACIÓN — en el camino degradado se descarta la `base_key` recién obtenida

Si `/sheets` responde y `/catalog` da 503, el código usa la `base_key` **del índice** y no la que
acaba de conseguir. Hoy son la misma. El día que difieran (un bump de `version` en sprite-forge,
justo el escenario de #369-R7) serviría el arte de la hoja anterior. Es el comportamiento
deseado —servir lo pagado— pero no está escrito en el comentario, que solo habla del servicio
«que no está».

---

## Workarounds usados durante la prueba

| Workaround | Por qué | Veredicto |
|---|---|---|
| Symlinks `.venv`, `assets`, `nefan-core/node_modules`, `narrative-mcp/node_modules` → checkout principal | El worktree de QA no los trae (gitignorados / no instalados) | **No afecta al usuario**: el usuario trabaja en un checkout completo. Sí explica el único rojo de `npm test` (`contract-fixtures`), que **falla igual en `HEAD~1`** |
| Copia de `cache/sprite_sheets` (89 MB) del checkout principal al worktree | El guion resuelve la caché desde SU `repoRoot`, y correrlo desde el principal daría fe del adaptador VIEJO (el propio guion se niega, y con razón) | **No afecta al usuario**. Solo lectura sobre el original; verificado al terminar: 29 dirs, 60 heroes y `md5sum` del índice sin cambios |
| **Sujeto sintético** bajo la clave nueva (`cp -a 05fe989fd80962fb bec8c72eee758842`) | Única forma de responder «¿el guion está roto, o le falta sujeto?» sin `rembg` | **ES UN HALLAZGO, no un paso de la receta**: lo que fabriqué a mano es exactamente lo que el usuario no puede fabricar. Sostiene el hallazgo 1 |
| Mutaciones temporales de `remote_generation.py` (6 mutantes) | Probar los candados en negativo, que es obligación del rol | **No afecta al usuario**: revertidas desde una copia; `git diff` vacío tras cada una |
| `git checkout HEAD~1 -- …` para el negativo del guion nuevo | Un guion que no puede ponerse rojo se ve igual que uno que funciona | **No afecta al usuario**: revertido; `git status` limpio salvo mis dos entregables |

---

## No probado

- **`npm run verify` entero.** Corrí `npm test` (1873 pass · 1 fichero rojo, ajeno a esta PR: falla
  idéntico en `HEAD~1`). No corrí `build`, `typecheck:scripts`, `typecheck:labs` ni `lint`, ni
  `npm run crap` / `npm run deuda`: el worktree no tiene instalación propia y el resultado sería
  del `node_modules` del checkout principal. **Las cifras de CRAP/cobertura/mutación del informe
  del ingeniero NO las he verificado.**
- **La generación REAL de frames repintados con el perfil nuevo.** Imposible sin `rembg` y sin
  gastar. Lo que sí se ejerció con el servicio real es la cadena entera hasta la CLAVE, que es el
  sujeto de #375. No lo doy por bueno por parecido.
- **El barrido con `--ejecutar` sobre el `cache/` real.** Es del coordinador. Verifiqué sus cifras
  contando el disco por mi cuenta (27 · 1.152 · 28,6 MB · $17,28, idénticas) y ejercí el guion en
  dry-run.
- **Gasto real de créditos**: cero por construcción (`--sin-skin`, y `fake` es un repintado local
  sin red con `cost_usd = 0.0`), pero no he ejercido ninguna ruta de pago, así que no puedo
  afirmar nada sobre el comportamiento del pipeline que cobra.
- **La batería del cliente (`node qa/run.mjs`)**: no la corrí. El diff no toca cliente, bridge ni
  `nefan-core/src`; el único fichero de datos que toca (`sprite-set.json`) lo leen exactamente
  `start.sh` y `test/sprite-set.test.ts` (`grep` a dos consumidores, verificado).

---

## El guion que nace

**`qa/perfil-de-repintado-en-la-clave.mjs`** (con su sección en `qa/README.md`, «El sexto
ejecutable»).

Vive **fuera de `qa/guiones/`** y esa es una decisión, no un descuido: los `NN-*.mjs` los ejecuta
`qa/run.mjs`, que arranca UN stack con navegador y se lo pasa a todos. Este sujeto es el
adaptador de Python contra un servicio en otro repo — necesita el venv, `assets/characters` y
arrancar y matar su propio sprite-forge, y no abre página ninguna. Meterlo en la batería
añadiría ~40 s, dos dependencias y una página sin usar a cada `node qa/run.mjs`. Es exactamente
la razón que el propio `qa/README.md` escribe para `sprites-sin-servicio.mjs` y `presets.mjs`, y
lo he seguido: es su hermano, no un guion de batería.

Lo que fija, contra el servicio de VERDAD y con el contenido del set VIVO:

```
✔ el set que se mide es el VIVO (nefan-core/data/sprite-set.json), copiado byte a byte
✔ las 16 anims del set declaran su perfil y el catálogo publica EL MISMO

  · idle · perfil 8kf@2.2fps · base 84b8b91255a268db · vestido bec8c72eee758842

✔ keyframes: 8 → 10 mueve la clave del vestido (e247b7e496123720) y deja la base_key intacta
✔   y revertir keyframes devuelve la clave original: sin repago espurio
✔ play_fps: 2.2 → 3.7 mueve la clave del vestido (14d38e6fa3647b53) y deja la base_key intacta
✔   y revertir play_fps devuelve la clave original: sin repago espurio
✔ reescribir el mismo perfil con otro formato de número NO mueve la clave
✔ con el servicio caído el error sube como 503 — el código del que el endpoint sabe degradar
✔ el índice en la forma ANTERIOR a #375 se trata como ausente y se DICE
✔ una entrada a MEDIAS tampoco se parsea: media entrada no es media clave
✔ y el índice en la forma VIVA guarda y devuelve base_key Y perfil

VERDE — el perfil entra en la clave del vestido, no en la base, y no repaga por el formato.
```

Cubre lo que la batería del adaptador **no puede** cubrir: la aritmética real del servicio
(merge con `PERFIL_POR_DEFECTO` y colapso de keyframes), que es justo donde nacería el espejo que
#375 prohíbe. Cero créditos por construcción (`--sin-skin`); puerto desde `PUERTOS_TODOS`
(`NEFAN_PORT_OFFSET` honrado, `nadie-inventa-un-puerto`); ocupado ⇒ se niega y lo dice, **no mata
a nadie**; el set se toca en una copia de `/tmp` cuya identidad byte a byte con el vivo se afirma
primero.

**Probado en negativo**, que es lo que lo hace valer algo: contra el adaptador y el set de
`HEAD~1` sale **ROJO** nombrando el fallo —

```
✘ sin perfil declarado (heredan el defecto de OTRO repo, y ese valor entra en una clave de ne-fan):
  talking, drinking, wounded_idle, sitting_idle, waving, praying
✘ lo declarado no es lo efectivo (o no se puede repintar): talking, drinking, …
✘ EL FALLO DE #375 ESTÁ VIVO: el adaptador no tiene _perfil_efectivo — la clave del sheet vestido
  no depende del perfil de repintado, así que cambiarlo sirve el arte viejo en silencio
ROJO — 3 comprobación(es) fallaron.   (exit 1)
```

---

## Veredicto

**APTO CON RESERVAS.**

Lo central está hecho, medido y candado: el perfil entra en la clave del vestido y no en
`base_key`, el candado se pone rojo si deja de entrar, si entra mal y si entra a medias, la
decisión está escrita con su razón y con su coste, y las cifras del informe del ingeniero
—incluidas las del barrido y las del catálogo— las he recontado y cuadran una a una.

Las reservas, por orden: **(1)** la PR deja `qa/sprites-sin-servicio.mjs` en rojo y su receta de
recuperación no corre en esta máquina (importante, y es el candado de la propiedad más cara de la
zona); **(2)** falta un test de seis líneas para el tercero de los tres fail-loud (menor);
**(3)** el guion de barrido archiva más de lo que su nombre promete (menor). Ninguna toca la
funcionalidad, y las tres son baratas.
