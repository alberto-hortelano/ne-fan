# #513 — «El batch de pago de un estilo vive en el navegador» · crítica

**REENCUADRADA** — y lo que queda es **decisión del usuario** (última sección).

El fichero está intacto y sus literales siguen duplicados: la tarea no ha caducado. Lo que ha caducado es su **daño**. El cuerpo dice que cerrar la pestaña corta un proceso de pago «y no se entera nadie, ni el bridge, ni el ledger»: el ledger **sí** se entera de cada imagen, y con los servicios en pie **no arde un solo dólar**. Lo que se pierde es el *dueño* del arte pagado y el *registro* de la aplicación — real, pero otro problema, y con patrón ya resuelto aquí para la otra mitad del arte (#376). Y hay un daño que el cuerpo no menciona y sí es dinero mal prometido: **el importe que se enseña antes de gastar miente en las dos direcciones**.

## El problema real, en una frase

El arte de superficie que paga el batch **solo queda con dueño si la pestaña llega viva al final de la corrida**, porque quien lo pinea y quien registra la aplicación es el navegador. Mudar el proceso (bridge o ai_server) ataca al **conductor**, no a la **propiedad**: un batch conducido por el bridge que siguiera pineando al final tendría el mismo agujero.

## La premisa, afirmación por afirmación

| Afirmación | Verificación de hoy |
|---|---|
| 531 líneas; ~83 puras / ~450 de proceso | ✅ 531 exactas, clase `:120-531`, **10 puntos de red** (8 `fetch` en `:153,163,355,378,416,453,459,515` + 2 WS en `:139,475`). Los dos bloques puros (celdas `:199-253`, roster `:257-280`) suman ~79 líneas **intercaladas** entre ellos: no se levantan como bloque |
| `CELLS_PER_PAGE=12` duplica `surface_atlas_generator.py:37` | ✅ sigue. `ai_server/tests/test_surface_atlas.py:57` vigila el lado Python; **la pareja no la vigila nadie** |
| «el `0.15` solo existe aquí» | ❌ **falso y peor**: es `COST_USD["nano-banana-pro"]` (`meshy_client.py:364`). El cliente duplica la **tabla de precios del servidor** y aplica un solo precio a **dos** modelos (`runtime_config.json:21-22`; `surface_atlas_generator.py:433` elige por página) |
| «no se entera el ledger» | ❌ falso: `SPEND.add` por imagen (`surface_atlas_generator.py:401`, `remote_generation.py:742,760`), ledger real **187 eventos / $37,54**. Lo que no sabe es **de qué aplicación** era cada dólar — eso es #426 |
| «no se entera el bridge» | ✅ cierto: sin `record_style_application` (`bridge/handlers/style-apply.ts:60`) no queda rastro |
| «el batch se corta» | ✅ el bucle del cliente muere; la petición **en vuelo no**: uvicorn 0.42 marca `disconnected` y **no cancela** (`h11_impl.py:105-128`, `httptools_impl.py:115-127`) |
| Bloqueada por #241 / `title-screen.ts` (PR 7) | ❌ caducado: **#241 y #346 CLOSED**, y cita el programa equivocado — `client-file-size.json` ya lo dice bien («#513 arranca CUANDO #346 cierre») |

**Dos hechos que el cuerpo no recoge, y son suyos:**

1. **La estimación del atlas es un suelo estructural.** `pack_missing` (`surface_atlas_generator.py:140-175`) separa tiles de uniques y **abre página propia por cada ref de cara distinta** (su propio comentario: «cada ref distinta ⇒ ≥1 página gpt-image-2 (~$0.17)»). `ceil(missing/12)×$0,15` (`:296`) no puede saberlo. Aritmética sobre ese código: 12 celdas que sean 6 uniques de 6 refs + 6 tiles se cotizan a **$0,15** y cuestan **$1,17**. **7,8×.**
2. **El bloque de skins cotiza el roster ENTERO cada vez.** `missing: skins.length` (`:304`): el plan nunca pregunta cuántos faltan, y **no puede** — remote-gen tiene tres rutas (`:71,630,806`) y ninguna es un dry-run de skins, al revés que el atlas (`resolve_only`) y el pack (`/missing`). Como los skins mandan en el importe (~17 llamadas × $0,17 ≈ **$2,9 por personaje**), tras aplicar un estilo el botón «↻ Regenerar estilo» pide **la factura completa** por algo que costaría $0. Ese es el número detrás del «invita a pagar dos veces» de #548.

## El dinero, medido

- **Pestaña muerta con los servicios vivos → $0 en créditos.** Todo lo pagado se vuelca antes de contestar (el atlas hace `surface_cache.put` al volver del `to_thread`; el skin escribe frames + `meta.json` y **se pinea solo** en `registrar_arte_de_personaje`), y la re-corrida resuelve **por contenido**. La idempotencia del cobro ya existe: la da el servidor, no el cliente.
- **Lo que sí quema: que muera el PROCESO a mitad de petición** (Ctrl+C, `k`, reboot). El atlas paga página a página dentro de un `asyncio.to_thread` y **no guarda ni una celda** hasta acabar el chunk: se pierde entero, de **$0,90** (6 páginas, mínimo de 64 celdas) a **$10,88** (techo aritmético: 64 celdas con ref propia). **Vive en remote-gen; mudar el conductor no lo toca.**
- **Sin dueño (latente): las superficies de la corrida**, pineadas solo al final (`:459`). El prune es LRU con techo 2 GiB (`runtime_config.json:24`) y lo dispara un único llamante: el arranque de ai_server (`main.py:87`). Caché hoy **130 MB** (115 en `cache/surfaces`) → **$0 hoy**; la exposición se abre a 16× el tamaño actual.
- **La única ventana que deja colgando una aplicación entera**: `:453-466` suelta los pins de la aplicación **anterior** (DELETE) antes de poner los nuevos (POST).

## El día después

Para quien juega **no cambia nada** salvo que se decida (a) que el batch sobreviva a la pestaña o (b) que el importe deje de mentir; si #513 solo muda el proceso es **deuda declarada**, y hay que decirlo en vez de venderla como arreglo de gasto. **Se vuelve más difícil** lo que hoy sostiene la corrección del batch —«las MISMAS funciones puras que la partida»—: cada frontera nueva es un sitio más donde la clave de caché puede divergir, y divergir *es* pagar dos veces; esas funciones son TS y el repo ya paga un port a mano de una de ellas (`pack_missing` = «port de `layoutAtlas`, mismas constantes»). **Habría que borrar**: `ui/style-apply.ts` entero, su excepción en `client-file-size.json` (quedarían dos), `MAX_CELLS_PER_REQUEST`/`CELLS_PER_PAGE`/`ATLAS_PAGE_EST_USD`, y `StyleRunLedger` + `__nefan.estilo()` (`nefan-hook.ts:166`), que existe solo para auditar desde fuera un proceso que pasaría a estar dentro — lo leen los guiones 07, 72 y 97.

## Conflictos

- **#548 — mismo problema, cara de UI: fusionable, y su cuerpo se queda corto.** No es «un fallo de navegación» lo que reactiva el botón: el panel **siempre** re-cotiza el roster. Y su daño en créditos está acotado por el caché del servidor ($0). Él mismo remite aquí.
- **#514 — dependencia de orden, y su censo está mal.** Dice «tres ficheros de `src/games/` que el cliente importa»; son **cuatro**, y `arch-rules.json:120` ya los nombra: el cuarto es `style-application-schema.ts`, cuyo **único** importador del cliente es `style-apply.ts`. #513 primero lo saca del grafo; #514 primero nace con un censo falso.
- **#426, #417, #413, #369** son vecinos del mismo almacén, **no bloqueos**: ninguno decide dónde corre el batch. **#536/#537** solo comparten pantalla: **no fusionar**. Sin conflicto con `CLAUDE.md` ni con `arch-rules.json`; #346 cerró y **desbloquea**.

## Coste contra valor

No hacer nada cuesta **$0 en créditos** mientras la caché siga bajo 2 GiB y nadie mate un servicio a mitad de corrida. Lo que cuesta todos los días es lo otro: enseñar una cifra que puede ser 8× baja (atlas) o entera-y-ya-pagada (skins) **justo antes del único botón del juego que gasta dinero real**. Eso es barato y no exige mudar nada. Mudar el proceso es el trabajo grande y su valor es de arquitectura y auditoría, no de ahorro. Encuadre recomendado: **el importe primero, el domicilio después**.

## Qué le cambiaría al cuerpo del issue (para pegar tal cual)

> **Corregido el 2026-09-10 contra el código.** NO es cierto que el ledger no se entere (`SPEND.add` por imagen; 187 eventos / $37,54), ni que cerrar la pestaña queme créditos (uvicorn no cancela la petición en vuelo, lo pagado se vuelca antes de contestar y la re-corrida es cache-hit), ni que el `0.15` esté solo aquí (duplica `meshy_client.py:364` e ignora el segundo modelo, $0,17). El bloqueo por #241/`title-screen.ts` está resuelto: #241 y #346 cerraron.
>
> **El problema es**: (1) el arte de superficie solo queda **con dueño** (pin) y la aplicación **registrada** si la pestaña llega viva al final — lo que #376 ya resolvió para el arte de personaje, que se pinea solo en el servidor; (2) el importe que se enseña antes de gastar **miente en las dos direcciones**: suelo en el atlas (`ceil(missing/12)×$0,15` ignora que `pack_missing` abre página por ref — $0,15 cotizado / $1,17 real) y **roster entero** en los skins (`missing: skins.length`; remote-gen no tiene dry-run de skins). (3) Absorbe **#548**.
>
> **Fuera de alcance, explícito**: el dinero que de verdad puede arder está en remote-gen —un chunk de hasta 64 celdas no persiste nada hasta terminar ($0,90–$10,88)— y mudar el conductor no lo arregla.

## Decisión del usuario (lo único que queda abierto)

**P1 · ¿Qué le promete el juego al dinero del jugador cuando cierra la pestaña?**
**(a)** Nada nuevo: el batch sigue necesitando la pestaña; #513 se limita a que lo pagado quede con dueño y registrado (patrón de #376) y a que el importe no mienta. Cierra #548. Barato.
**(b)** El batch pasa a ser un job del bridge con progreso y reanudación, como `generate_game`: cerrar la pestaña no lo corta y al volver se ve dónde va. El patrón existe en el repo; cuesta canal de progreso, estado del job y reanudación. **Hoy (b) no ahorra ni un dólar frente a (a)**: se paga en tiempo del jugador, no en créditos.

**P2 · ¿El importe entra en #513 o va aparte?** Misma pantalla y mismo fichero, pero es trabajo de servidor (un dry-run de skins que hoy no existe). Aparte ⇒ la cifra sigue mintiendo mientras dure #513.

**No hace falta gastar créditos para verificarlo**: `labs/narrative/fake-ai-server.ts` sirve las cuatro rutas de pago marcándolas `dePago(...)` y los guiones 07, 72 y 97 ya conducen el panel; la muerte de la pestaña a mitad de corrida se ejerce ahí, gratis.
