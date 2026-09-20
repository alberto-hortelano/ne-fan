# QA — tanda AB (#426): el ledger sabe de dónde salió cada dólar

Sobre el commit `9805e5bf` de `feature/tanda-ab-el-ledger-sabe-de-donde-salio-el-dolar`, en el
worktree `/home/al/code/ne-fan-tanda-ab-el-ledger-sabe-de-donde-salio-el-dolar` (árbol limpio al
empezar; `.venv` compartido de `/home/al/code/ne-fan`). Cero créditos: ningún servicio de pago, y el
único remote-gen que arranqué habló con NADIE (sin asset-store, sin fal, sin sprite-forge). El ledger
vivo del checkout principal (`/home/al/code/ne-fan/cache/spend/events.jsonl`, 187 líneas, md5
`8ba5d5a9…`) **no se ha tocado**: todo lo que se hizo con él fue sobre una copia byte-idéntica.

Criterios: los cinco del **reencuadre del crítico** (que `requisitos.md` declara que sustituyen a los
del issue), más el 5 original (suite verde, fail-loud por `HTTPException`) que el reencuadre no
retiró.

## Criterio → veredicto → evidencia

| # | Criterio (literal del reencuadre) | Veredicto | Evidencia |
|---|---|---|---|
| 1a | Todo evento nuevo lleva procedencia obligatoria, enum CERRADO con escritor (`real`/`fixture`; ni `banco` ni `fake-ai-server`) | ✅ cumple | Sonda propia sobre un tracker temporal: `add` sin kw → `TypeError: missing 1 required keyword-only argument: 'procedencia'`; `procedencia=None`, `""`, `"Real"`, `True`, y el 4º arg posicional → `ValueError`/`TypeError`; **el fichero no llega a existir** en ninguno. `PROCEDENCIAS == ("real","fixture")` (test `test_el_enum_es_exactamente_real_y_fixture`). Sabotaje S1 (defecto `="real"` en la firma) → `test_add_sin_procedencia_es_TypeError_y_no_escribe` FAIL |
| 1b | En el adaptador de sprite-forge la procedencia sale de `api` de la RESPUESTA, nunca de un literal | ✅ cumple | `remote_generation.py`: `procedencia_hero = _procedencia_o_502("/identity", ident.get("api"))` y `procedencia_skin = _procedencia_o_502("/skins", (meta.get("skin") or {}).get("api"))`, las dos ANTES de escribir arte. Test `test_la_procedencia_sale_del_api_de_la_RESPUESTA_no_de_un_literal` (mismo forge con `api: "openai"` → dos eventos `real`). Sabotajes S5 (literal `"fixture"` en el skin) y S6 (asignar y luego PISAR con `"real"`) → rojos en el padrón **y** en el test del adaptador. El repo real de sprite-forge (`~/code/sprite-forge/python/sprite_forge_skin/app.py:162,250`) emite `"api": api.name` con `name = "meshy"` / `"fake"` |
| 2a | `total_usd()` y `/dev/status` dan el gasto real sin mirar `what` | ✅ cumple | Sonda: ledger vacío → 0 / `por_procedencia` a ceros con las dos claves; solo fixture (2×0,24) → `total_usd 0`, `call_count 0`, `fixture.usd 0.48`; mixto (0,10 real + 0,24 fixture + 0,05 real) → `total_usd 0.15`, `call_count 2`, `fixture 0.24/1`. `_suma` filtra por `e["procedencia"]`, no por `what`. **Flujo real**: remote-gen en pie con un ledger mixto sembrado → `GET /dev/status` → `{"total_usd":0.23,"call_count":2,"por_procedencia":{"real":{"usd":0.23,"call_count":2},"fixture":{"usd":0.48,"call_count":2}}}` |
| 2b | `calls[]` lleva el campo; contrato TS y copia del fake lo reflejan | ✅ cumple | Respuesta REAL de Python (`devstatus-tras-mv.json`): `spend` = `[call_count, calls, por_procedencia, total_usd]`, `por_procedencia.{real,fixture}` = `[call_count, usd]`, `calls[i]` con las cinco claves — casa clave a clave con `DevSpendStatus`/`DevSpendCall` de `remote-gen.ts:229-259`. `npm run typecheck:labs` verde (5 s); sabotaje S7 (fake sin `por_procedencia`) → `error TS2741: Property 'por_procedencia' is missing`. **Guion 150** (nuevo, ver abajo): en la batería, el tooltip del panel copia las cuatro cifras del wire del fake, 3 corridas × 5 ✔; negativo (fake sin el campo) → ROJO |
| 3 | Censo de llamantes por el árbol (`ast`): los cuatro de hoy; un `add` nuevo sin procedencia falla al escribir | ✅ cumple | `test_los_escritores_del_ledger_tienen_padron.py`: padrón `{generate_missing:1, _run_page:1, skin_sprite_sheet_endpoint:2}` con `ast.walk`, no `grep` (los dos del adaptador tienen el nombre partido en dos líneas). Sabotaje S2 (`SPEND.add` de contrabando en `surface_atlas_generator.py`) → `test_el_padron_es_exactamente_el_que_hay` FAIL. Cabecera «LO QUE ESTO NO SUJETA» (alias, `getattr`, otra instancia, fuera de `ai_server/`) — comprobado por mi cuenta que **no hay** ningún `SpendTracker`/`events.jsonl` fuera de `ai_server/` (grep en `.ts/.mjs/.py/.sh/.json`, 0 fuera; `labs/fps/gen.py` tiene su propio `spend.json` de fal, que no es este ledger) |
| 4 | Los 187 sin campo se ARCHIVAN como en T9, no se migran ni se marcan `desconocida`; el arquitecto decide sobre la herramienta y el paso 6 | ✅ cumple (el `mv` del principal queda PENDIENTE del coordinador, como manda el encargo) | Flujo real sobre la copia: remote-gen arrancado con `NEFAN_SPEND_DIR=<tmp>/spend-viejo/cache/spend` (187 líneas, md5 idéntico al vivo) → `GET /dev/status` **HTTP 500** con `detail` = `…events.jsonl:1 es un evento sin \`procedencia\`: un ledger anterior a #426 no se migra ni se marca, se ARCHIVA como en T9 → mkdir -p …/archivo/cache/spend && mv … events-sin-procedencia-2026-09-20.jsonl`. **Ejecuté ese mismo comando tal cual sale del `detail`** → el fichero aparece en `archivo/cache/spend/` (21.835 bytes) → `GET /dev/status` **HTTP 200** con todo a ceros, sin reiniciar. Sabotaje S4 (`_events()` se SALTA la línea vieja = migración muda) → 4 FAIL. Herramienta por texto y su test **borrados** (`grep -rn archivar_gasto_de_test` fuera de `docs/agents/`: 0). Para el principal el remedio calcula `mkdir -p /home/al/code/ne-fan/archivo/cache/spend && mv /home/al/code/ne-fan/cache/spend/events.jsonl …/events-sin-procedencia-<fecha>.jsonl` (verificado llamando a `_remedio_para_ledger_viejo` con esa ruta) |
| 5 | Candado en negativo: un forge de mentira con `api: "fixture"` FUERA de `unittest` y sin la ruta real no suma al gasto real | ✅ cumple | `node qa/el-ledger-de-gasto-no-lo-escribe-la-suite.mjs` **×3: 30 ✔ / 0 ✘ / EXIT=0 las tres**, salidas 1 y 2 idénticas salvo el md5 del ledger. Paso 6: `unittest` NO cargado (medido), ledger con forma `…/cache/spend`, 200 del adaptador, 2 eventos `fixture`, `total_usd 0`, `por_procedencia.fixture > 0`. Está en `candados-headless` (`ci.yml:315`). Los dos negativos del guion los corrió el ingeniero; yo repetí la mitad Python de esa avería (S5/S6, arriba) |
| 5-orig | Tests Python en verde; fail-loud por `HTTPException`, nunca `return {"error"}` | ✅ cumple | `NEFAN_SPEND_DIR=$(mktemp -d) python -m unittest discover -s ai_server/tests` → **Ran 266 tests · OK**. `dev_status`: `except LedgerIlegible → HTTPException(500, detail)`; adaptador: `ValueError → HTTPException(502)`. Sabotaje S3 (`dev_status` se traga `LedgerIlegible` y devuelve ceros) → `test_dev_status_sobre_un_ledger_anterior_a_426_es_500_con_el_remedio` FAIL. `cd nefan-core && npm test` con el guion 150 en el árbol: **3117/3117** |

Siete sabotajes (S1–S7), cada uno restaurado desde copia y `md5sum -c` **OK en los cinco ficheros**;
`git status` al terminar solo muestra el guion 150 nuevo.

## Hallazgos

### H1 · IMPORTANTE — el 500 con el remedio no llega a la pantalla: el panel dice «ai_server offline» con remote-gen en pie

**Reproducción desde el arranque** (lo que verá quien opere el checkout principal entre la fusión y
el `mv`): remote-gen arrancado con un ledger anterior a #426 → cliente (`./start.sh`, preset
`html-fixtures` con `NEFAN_PORT_OFFSET=200`, remote-gen a mano en 8968 porque el launcher se niega a
arrancarlo con offset; la página en `http://127.0.0.1:3200/?offset=200`) → segunda fila del HUD:
**`ai_server offline (sin gasto/config)`**, `#ds-spend` vacío, toggle de dev-cache deshabilitado con
el título «ai_server no responde — dev-cache no disponible». Captura:
`qa/capturas/tanda-ab-panel-dev-ledger-viejo.png`. La consola del navegador sí enseña
`500 (Internal Server Error) @ …/dev/status`, pero el log de errores del juego (`errors.push`) **no
recibe nada**: sus 7 entradas son todas del bridge ausente. El `detail` con el `mv` solo se ve por `curl`.

**Causa**: `dev-status-panel.ts:112-114` — `if (!res.ok) throw new Error(\`HTTP ${res.status}\`)`
cae en el `catch {` que está escrito para «ai_server no responde» y pinta «offline». El ingeniero lo
reporta en `implementacion.md §6` con esa misma línea, y tiene razón en que el camino ya existía (el
500 de config sin refrescar lleva desde siempre contándose como «offline»).

**Lo que espera el usuario**: la casa prohíbe degradar en silencio, y el propio fichero lo dice
(«un HUD que miente es peor que un HUD con un dato menos», `setSession`). Aquí el HUD miente dos veces:
dice que un servicio está caído cuando está en pie, y esconde el único mensaje accionable que el
servidor produce a propósito.

**Juicio**: no devuelve la tanda **con dos condiciones**. (1) El `mv` del checkout principal es
condición de la fusión, no un apunte: es el único ledger viejo que existe en la máquina (los
worktrees no tienen `cache/spend/`), y con él archivado el estado de H1 no es alcanzable por el camino
de #426. Lo probé sobre la copia: el panel pasa de «offline» a
`gasto sesión 0,00 € · total 0,00 €` solo, en el siguiente sondeo, sin recargar. (2) H1 se abre
como issue **antes** de cerrar #426, o lo corrige el mismo ingeniero en esta rama: es pequeño
—distinguir `!res.ok` de fallo de red, leer `detail` y sacarlo por `errors.push("dev-status", …)`
y por `#ds-config`— pero necesita un candado y el fake no sabe contestar 500 (el guion 150 lo declara
en «lo que no mide»); recomiendo el issue con esa nota. La regla de «prohibido es sin medir» pesa aquí
a favor de no maquillar: mejor un issue con la reproducción que un arreglo de UI sin negativo.

### H2 · menor — `_events()` valida `procedencia` y nada más: una línea a mano rompe en anónimo

Sondas sobre un tracker temporal: línea con `procedencia` pero **sin `usd`** → `KeyError: 'usd'`;
`usd: "0.5"` o `usd: null` → `TypeError: unsupported operand`; `usd: -3` **se suma** (`total -3`);
`[1,2]` o `"hola"` → `LedgerIlegible` pero con el texto «es un evento sin `procedencia`», que no es lo
que pasa. Ninguno de esos es `LedgerIlegible`, así que en `/dev/status` salen como el **500 anónimo**
que el plan (§6) dijo cerrar. Nadie escribe el ledger a mano hoy; es exactamente el mismo tipo de
agujero que #426 vino a tapar (el campo que no se valida), así que se deja dicho. Remedio si se quiere:
`_events()` valida también `usd` numérico ≥ 0 y `dict`, con la misma `LedgerIlegible`.

### H3 · menor — el remedio del 500 supone la forma `<raíz>/cache/spend/`

`_remedio_para_ledger_viejo` sube tres niveles a ciegas: con `NEFAN_SPEND_DIR=/tmp/x` y un ledger viejo
dentro, el `mv` que propone es a `/tmp/archivo/cache/spend/…` (probado: `…/h/events.jsonl` →
`mkdir -p /tmp/archivo/cache/spend`). Para el checkout principal y para cualquier `…/cache/spend` es
correcto. Solo afecta a quien use la variable con un ledger viejo — que hoy no es nadie.

### H4 · menor / observación — `procedencia_segun_api` distingue mayúsculas

`"FIXTURE"` → `real`, `" fake "` → `fixture` (recorta espacios, no case). La dirección es la segura
(un nombre raro cuenta como dinero, nunca desaparece) y sprite-forge emite en minúscula; se declara
para que nadie lo dé por cubierto.

### H5 · menor, NO de esta tanda — remote-gen loguea el puerto del snapshot, no el que escucha

`Remote-Gen ready. HTTP :8768` con `--port 8968` (`remote_gen_main.py:86` usa `load_port` en vez de
`args.port`). Lo vi al arrancarlo a mano; no lo toca #426.

### Observaciones sin veredicto

- El trailer del commit es `Co-Authored-By: Claude Opus 5 (1M context)` y no el que pedía el encargo;
  el ingeniero lo declara y lo justifica. Decisión del coordinador.
- El guion nuevo va como **150** porque es el primer prefijo libre en este árbol; #680 dice que el
  número se elige al fusionar. `npm test` (que incluye el candado de prefijo único de la tanda U) sale
  verde con 150 aquí.
- `labs/fps/gen.py` lleva su propio `spend.json` de fal fuera del tracker: otro registro de gasto que
  `/dev/status` no ve. Fuera de alcance de #426; se apunta.

## Guion que queda: `qa/guiones/150-el-panel-de-dev-cuenta-solo-el-gasto-real.mjs`

Lo mecánico de esta tanda ya tenía dueño ejecutable (la suite Python y el guion headless en CI). Lo
que no tenía era el ÚLTIMO eslabón, el panel leyendo el wire en un navegador de verdad —el ingeniero lo
deja en «no visto». El guion lo cubre en el título, sin partida y `sinMotor`: espera a que el tooltip
de `#ds-spend` diga «Total REAL … (fixture: …)», compara las cuatro cifras con el `/dev/status` de la
MISMA URL que sondea la página (`?ai=`), comprueba que la línea visible es `total_usd × usd_eur_rate`
en euros y que el panel no dice «offline». Medido: `node qa/run.mjs 150-el-panel` **×3 → 5 ✔ / 0 ✘,
EXIT=0**; negativo (fake sin `por_procedencia`) → `timeout esperando el tooltip` + 4 excepciones en la
página, **0 en verde · 1 en rojo, EXIT=1**; fake restaurado, `md5sum -c` OK. **Lo que no mide**, en
su cabecera: con el fake a ceros no distingue «solo real» de «todo» (eso vive en la suite y en el paso
6 del headless), ni el 500 del ledger viejo (H1).

## Workarounds usados durante la prueba

| Workaround | Por qué | ¿Afecta al usuario? |
|---|---|---|
| remote-gen arrancado a mano (`python ai_server/remote_gen_main.py --port 8968`) en vez de por el launcher | El launcher se NIEGA a arrancar remote-gen con `NEFAN_PORT_OFFSET≠0` (política documentada) y el encargo fija el 200 | No: el usuario corre offset 0 y el launcher lo arranca. Mismo binario, misma `NEFAN_SPEND_DIR` |
| Cliente con preset `html-fixtures` (sin bridge): overlay «Sin conexión con la partida» en el centro | Sin bridge no hay partida; el panel de dev vive en la barra superior y se construye al cargar, con o sin bridge | No para lo medido: el panel es visible y sondea igual (captura). El overlay no lo tapa |
| Ledger de prueba en `NEFAN_SPEND_DIR=<tmp>/spend-viejo/cache/spend` en vez del real | El encargo prohíbe tocar el vivo; fuera de `unittest` el constructor no consulta la forma, así que es el MISMO camino de código | No |
| Eventos mixtos sembrados a mano en la copia (2 fixture + 2 real) | Sin créditos no hay escritor real; el formato sembrado es el que escribe `add` (cinco claves, verificado por `test_el_evento_en_disco_lleva_el_campo`) | No |
| El `mv` del remedio ejecutado sobre la COPIA, no sobre el principal | Encargo explícito: lo hace el coordinador al fusionar | Es la reserva 1 del veredicto |

## No probado

- **Gasto real** contra fal/Meshy y contra sprite-forge de verdad (`api: "meshy"` en el wire real):
  cuesta créditos. Se apoya en el repo de sprite-forge leído en local y en los tests del adaptador con
  `api: "openai"`.
- **El `mv` sobre `/home/al/code/ne-fan/cache/spend/`**: lo ejecuta el coordinador. Probado sobre una
  copia byte-idéntica (md5 `8ba5d5a91954de667b0995904249ffaf`), incluida la recuperación del panel.
- **El panel ante el 500 en la batería**: el fake no produce ese 500; medido a mano (H1).
- **`npm run verify` completo**: lo dio el ingeniero (3117/3117); yo corrí `npm test` (3117/3117) y
  `typecheck:labs` por separado, no el `build`+`lint`.

## Veredicto

**Apto con reservas.**

1. El `mv` del checkout principal (el comando exacto lo imprime el propio 500, y está en
   `implementacion.md §3`) es **condición de la fusión**, no un apunte: sin él, `/dev/status` del
   principal contesta 500 y el panel de dev dice «offline» con remote-gen en pie (H1).
2. H1 se abre como issue antes de cerrar #426 (o lo corrige el mismo ingeniero en la rama, si el
   coordinador prefiere no fusionar una degradación muda aunque sea heredada). H2–H4 van en el mismo
   issue o en el backlog de `ai_server/` sin deuda medida que el plan ya pide.
