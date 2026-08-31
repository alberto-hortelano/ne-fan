# Crítica — remote-gen atado por los dos lados (#318 + #319 + #256)

**Veredicto: VIGENTE** (los tres issues; con dos afinados de criterio, abajo). La recomendación
de retirar `/backend_status` queda **respaldada y reforzada** por un dato que la pregunta abierta
no tenía.

## El problema real en una frase

Las formas del contrato remote-gen viven copiadas a mano en cinco sitios del cliente y en el
productor Python, y ninguna copia tiene quien la compare — la clase de fallo que #280/#309 ya
pagaron, en los dos flancos que a esa pareja le quedaron abiertos.

## Premisa, verificada a HEAD (`4bb014e`) — todo medido hoy

- **Censo inline: 5 exactos, ni uno más.** `grep "res.json()) as {"` en `nefan-html/src` da
  `style-apply.ts:375,438`, `title-screen.ts:1157,1194`, `sprite-renderer.ts:149`. Los 8 usos
  sanos castan a tipo importado del contrato. ✓
- **`cached` lo emite el servicio real**, no solo sus tests: `ai_server/routers/remote_generation.py:457`,
  y el docstring `:323` lo documenta. `SkinSpriteSheetResponse` (`remote-gen.ts:88-105`) no lo
  declara. El `satisfies … & { cached: boolean }` del fake está hoy en `fake-ai-server.ts:576`
  (no :904 — el fichero se movió otra vez; misma sustancia). ✓
- **Premisa NUEVA que el requisito no tiene**: los cinco sitios no solo redefinen — **inventan**.
  Dos leen `error?: string` (`style-apply.ts:442`, `sprite-renderer.ts:153`) que el servicio real
  NUNCA emite: solo existe `"ok": True` (`remote_generation.py:455`); los fallos van por
  `HTTPException` (fail-loud). Y `sprite-renderer.ts:151` tipa `meta` como `SpriteSheetMeta`
  (tipo del CLIENTE, `sprite-renderer.ts:23`) donde el contrato dice `Record<string, unknown>`.
  «Importar el contrato» obliga a resolver esos dos deltas explícitamente — ver afinado A.
- **`StyleUploadResponse` y `StyleCompleteResponse` CASAN con el productor Python**: `styles.py:224-229`
  emite exactamente los 5 campos del upload (`missing_refs` → `{id,folder,description}` =
  `StyleMissingRef`), y `/complete` emite `{generated,cost_usd,message}` (:276) o
  `{generated,cost_usd,skipped}` (`style_pack_builder.py:296`). Importarlos no propaga error. ✓
- **Los dos campos mudos siguen mudos**: `test_spend_tracker.py:59-84` (hoy `DevStatusEndpointTest`)
  asevera `api_cache.enabled`, `spend.total_usd`, `config.usd_eur_rate`, `keys.*` — nada sobre
  `config.surface_model`/`sprite_skin_model`. **Matiz medido**: el nombre aparece DOS veces en
  `cache_assets.py` — la tupla de validación (:52) y el dict de salida (:67-68). Renombrar la
  TUPLA ya rompe hoy (500 fail-loud → el test de shape falla); lo que pasa callado es renombrar
  la **salida** — el wire. El negativo del criterio 4 tiene que renombrar ahí. Ver afinado B.
- **El fake enruta por `req.url ===` en ~20 rutas** (`fake-ai-server.ts:286-648`); la divergencia
  con query sigue. ✓
- **`/backend_status`: 0 llamadores** en `nefan-html/src`, `qa/`, `labs/`, tests. Muñón real:
  `generation.py:75-107` (solo `ai_vision`), `narrative-llm.ts:102-104` + endpoint `:151`,
  `main.py:26` (`_SILENCED`), `ia-servicios.md:24`, `docs/microservices/README.md:133,143`,
  `migration.md:96` — el grep del criterio 6 los caza todos. ✓
- **Dato nuevo para la pregunta abierta**: `/dev/status` lo monta **remote-gen :8768**
  (`remote_gen_main.py:103`) y `ai_vision` lo conoce **ai_server :8765**. «Darle el panel como
  cliente» = el panel encuestando un segundo proceso por la salud del motor narrativo, que el
  dev ya ve en el terminal del bridge. Y «el sitio natural sería /dev/status» exigiría plomería
  entre procesos — razón de más para retirar hoy y diseñar eso el día que exista la necesidad.
- **Claves de caché: intactas.** `cached` es un campo de TIPO TS; la clave de imagen se computa
  del request (prompt/style/ids de refs, `remote_generation.py:392` y contexto), jamás de la
  forma de la respuesta. Cero repago de arte. ✓
- **Criterio 3, candable sin falsos positivos hoy**: los 5 inline son todos endpoints CON tipo en
  el contrato; los 8 legítimos no casan con el patrón `as {`. Es un tripwire evadible (un
  interface local escapa al regex) — suficiente para el modo de fallo observado; la garantía
  total sería de tipo, y eso es decisión del arquitecto, no de este criterio.

## El día después

Para el jugador, nada cambia (deuda declarada: el LED «reusado/pintado» sigue igual). Lo que se
vuelve más difícil es lo que debe: añadir un campo ad-hoc a una respuesta remote-gen exige tocar
el contrato primero. Riesgo de cierre en falso: un ingeniero puede llegar a censo 0 importando el
tipo y conservando la invención con otra sintaxis (re-cast de `meta`, intersección para `error`)
— el afinado A lo tapa. Lo que quedaría vivo sin que nadie lo borre: nada, si los criterios 1 y 6
se cumplen literalmente (el `& { cached }` y `_SILENCED` están nombrados o cubiertos por grep).

## Conflictos

Ninguno duro. #341 toca `main.ts`, #329 toca `input/*` — ficheros distintos de los tres de esta
tanda. #216/#255 (catálogo de sprites, personajes del clon limpio) se BENEFICIAN de que
`style-apply.ts`/`title-screen.ts` queden importando el contrato antes de que ellos los toquen.
#235 (E2E del tramo Python) es familia pero no solapa: esta tanda compara formas, no recorre
caminos. La corrida de mutación en vuelo es asunto del coordinador, como dice el requisito.

## Coste contra valor

Barato y cierra 3 issues: un campo al contrato, 5 sustituciones de import, un candado regex del
estilo de los que `arch-rules.json` ya tiene, el hueco de 2 campos en Python y una retirada ya
medio hecha. No hacerlo deja el punto ciego del banco (#309) cerrado solo a medias, y la familia
280/309/318/319 se está cerrando con el contexto caliente — retomarla en frío costará más que
toda la tanda.

## Qué cambiaría de `requisitos.md` (pegable)

- **A · Criterio 2, añadir**: «Al cierre, ningún sitio del censo lee un campo que el contrato no
  declare ni re-tipa un campo del contrato con un cast lateral: los `error?: string` de
  `style-apply.ts:442` y `sprite-renderer.ts:153` (el servicio real nunca emite `error` con 200:
  fail-loud por HTTPException) y el `meta` como `SpriteSheetMeta` se resuelven con decisión
  explícita en el plan, no sobreviven como intersección o re-cast.»
- **B · Criterio 4, precisar**: «El negativo renombra el campo en el **dict de salida** de
  `dev_status` (`cache_assets.py:67-68`), no en la tupla de validación (:52) — la tupla ya rompe
  hoy con 500.» Y degradar «fixtures compartidas» de “mecanismo probable” a “una opción”: para
  DOS campos de un endpoint de dev, el arquitecto debe pesar cerrar la instancia contra cerrar la
  clase (el propio repo tiene el patrón censo-de-claves en `test_sprite_forge_adapter.py:268`);
  anclar en fixtures arrastra además la trampa de #237 sin necesidad.
- **C · Pregunta abierta #256**: visto bueno a **retirar**, con la premisa corregida — `/dev/status`
  es de remote-gen (:8768) y `ai_vision` de ai_server (:8765): la alternativa «panel como
  cliente» cruza procesos para un valor que nadie mira; no es empate, es retirada.
- **D · Cita movida**: el `satisfies … & { cached }` está en `fake-ai-server.ts:576` (no :904).
