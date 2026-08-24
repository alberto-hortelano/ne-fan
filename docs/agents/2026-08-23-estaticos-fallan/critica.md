# REENCUADRADA

El problema es real, pero el issue lo cuenta como un fallo de cableado del preset y ofrece tres
salidas como si compitieran. Una **no arregla nada**; las otras dos no arreglan lo mismo y van juntas.

## El problema real, en una frase

**El cliente no tiene degradado cuando una portada no carga: pinta el icono roto del navegador** — y
el preset sin asset-store es solo la forma más fácil y más visible de provocarlo.

Que `e2e-sin-creditos` no levante el asset-store es la causa de ESTE caso, pero el `<img>` de
`coverHtml` se rompe igual si borras un `cover.jpg`, si el store se cae o si el manifest miente. El
issue apunta al dial del preset; el dial del problema es el `<img>` sin `onerror`.

## La premisa, afirmación por afirmación

| Afirmación | Verificación |
|---|---|
| `?ai=` reapunta los cuatro, asset-store incluido | **CIERTA.** `nefan-html/src/net/service-urls.ts:22` — `NEFAN_URL_ASSET_STORE: ai`, sin condición |
| El preset no levanta el asset-store | **CIERTA.** `start.sh:459` — perfil `"1 0 0 1 0 0 0 1 0"`; la quinta ranura (`assets`) es 0 |
| El fake sirve binarios con CORS en tres rutas | **CIERTA.** `labs/narrative/fake-ai-server.mjs:486,493,506`; CORS en todas las respuestas (`:427-432`) |
| …pero no tiene `GET /styles/{id}/{file}` | **CIERTA.** Solo `GET /styles/{id}/missing` (`:448`, dry-run) y `POST /styles/{id}/complete` (`:688`). La cover cae al 404 genérico de `:721` |
| `start.sh` ya afirma que el fake emula el asset-store | **CIERTA, y peor: en DOS sitios, uno visible.** `start.sh:377` (`"…+asset-store"`) se pinta en el TUI (`:620`), tres líneas debajo de `:363`, que describe el asset-store como `"blobs + manifest SQLite + covers de estilos"`. El comentario `:451` es el segundo |
| `coverHtml` ya tiene el marcador escrito | **CIERTA, con corrección.** `nefan-html/src/ui/title-screen.ts:1103` ya pinta el degradado, pero con el nombre del **ESTILO** (`style?.name ?? g.style_id`), no del mundo. El título del mundo ya va al lado (`:1110`), así que el marcador actual es el correcto: no se toca |

**Cadena causal cerrada:** 4 juegos en `nefan-core/data/games/`, sus 4 estilos por defecto tienen
`cover.jpg` en disco, `listStyles` (`src/games/loader.ts:351`) emite `cover_url` para los cuatro, el
bridge —que sí está arriba aquí— se lo manda al cliente, y el cliente lo prefija con `ASSET_STORE_URL`
que bajo `?ai=` es el fake: 404. **Cuatro marcos rotos, los cuatro del issue.**

**Y llega más lejos:** `qa/run.mjs:74` abre el cliente con el mismo `?ai=`, así que el bench
automático lleva desde #207 pintando cuatro portadas rotas en cada corrida y ningún guion mira.

## Una salida está rota y hay que descartarla por escrito

**«Que el preset levante el asset-store» NO ARREGLA EL BUG.** Aunque `start.sh` arrancara el store en
:8767, el cliente se abre con `?ai=http://127.0.0.1:18765` (`start.sh:836`) y `service-urls.ts:22`
resuelve el asset-store **al fake de todos modos**: seguiría dando 404. Para que funcionara habría que
sacar el asset-store del override, y eso rompe las tres rutas binarias que el fake sí sirve, porque el
cliente las pide **bajo el nombre asset-store** (`sprite-renderer.ts:68,169`; `main.ts:218`). La
salida barata en apariencia obliga a partir `?ai=` y a que el bench dependa de un servicio real.

Las otras dos **no son excluyentes**:

- **El `onerror`** (2 líneas: el marcado ya existe en `:1103`) arregla el **problema real**: cualquier
  portada que falle, por cualquier causa, en cualquier preset. Obligatorio.
- **`GET /styles/{id}/{file}` en el fake** solo arregla este preset, pero convierte la prosa de
  `start.sh:377` en **verdad** y le enseña al bench las portadas reales, que es para lo que existe.
  Los ficheros están en disco y el fake ya lee estáticos del árbol (`SPRITES_DIR`, `:42`).

## El día después

- **Para quien juega:** nada en partida; el bench es herramienta. Pero es lo primero que ve quien abre
  la URL, y quien la abre está evaluando el juego. Cuenta.
- **Qué se vuelve más difícil:** con el `onerror`, una portada que falta deja de gritar. Precio
  correcto, pero el fallo debe registrarse por el canal de la capa (`errors.push`, CLAUDE.md §Errores).
- **Qué se borra:** nada, no hay código muerto. **Qué se puede tirar:** el reflejo de culpar al
  preset — tras el `onerror`, que el asset-store esté arriba deja de ser condición para ver el título.
- **Qué parecerá arbitrario en un mes:** que el fake sirva `/styles/{id}/{file}` del disco real
  mientras finge todo lo demás. Merece un comentario: son ficheros commiteados, no generación.

## Conflictos

Ninguno bloqueante. Revisados `gh issue list` (24 abiertos), `git log`, `CLAUDE.md` y `arch-rules.json`:

- **#217** (Vite sirve index.html con 200 para estáticos ausentes) es de la misma familia pero otro
  origen y otro proceso. No solapa; conviene hacerlos seguidos.
- **#207** (`eba1e09`) sube la apuesta, no la contradice: las covers son ya capturas reales a 192×128.
- `arch-rules.json` no ata `labs/**` a core ni canda el fake, y la rama viva `feat/contrato-entity-npc`
  (#173) no toca `start.sh`, el fake ni el título: nada que romper.

## Coste contra valor

De las más baratas de la cola: dos líneas en el cliente, un handler pequeño en el fake, una línea de
prosa. **No hacer nada** cuesta que cada persona que abra el bench —y cada corrida de `qa/run.mjs`—
empiece por cuatro iconos rotos y una promesa desmentida. Lo que no merece la pena es la tercera.

## Qué le cambiarías a `requisitos.md`

Sustituir «El issue ofrece tres salidas y no elige» por, literal:

> El issue ofrece tres salidas. **La de «que el preset levante el asset-store» está descartada y no se
> reabre**: con `?ai=` el cliente resuelve el asset-store al fake pase lo que pase
> (`service-urls.ts:22`), así que arrancar el store en :8767 no cambia nada, y sacarlo del override
> rompería las tres rutas binarias que el fake sirve bajo ese nombre (`sprite-renderer.ts:68`,
> `main.ts:218`). Las otras dos **se hacen las dos, y no arreglan lo mismo**: el `onerror` del `<img>`
> arregla el problema real —el cliente no degrada cuando una portada no carga, en cualquier preset y
> por cualquier causa— y es obligatorio; el `GET /styles/{id}/{file}` del fake solo arregla este
> preset, pero convierte en verdad la prosa de `start.sh:377` y enseña las portadas reales al bench.

Y corregir el apartado «Lo que hay que verificar»:

> - El marcador de `coverHtml` (`title-screen.ts:1103`) lleva el nombre del **ESTILO**, no del mundo
>   —el título del mundo ya va al lado en la tarjeta—. **No lo cambies**: falta solo el `onerror` que
>   lo use, y que el fallo se registre por `errors.push`.
> - La prosa falsa está en **dos** sitios; el visible es `start.sh:377` (`SERVICE_HINTS`, se pinta en
>   el TUI), el otro es el comentario `start.sh:451`.

Añadir al alcance: **`qa/run.mjs:74` abre el cliente con el mismo `?ai=`**, así que esto lo sufre
también el bench automático — y un guion que mire las cuatro portadas es lo que evita la reincidencia.
