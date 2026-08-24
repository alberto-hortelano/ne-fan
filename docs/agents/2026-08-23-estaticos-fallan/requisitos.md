# Portadas en el bench sin créditos (#218)

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo que
> puedas con el flujo de agentes»

Y al reanudar la cola:

> «He reiniciado la sesion, ponte con los siguientes issues, si se modifica uno lo modificas y
> si se descarta simplemente pasa al siguiente y al final revisamos los descartados pero no
> pares la ejecucion de los demas a no ser que tengan dependencias y yo tenga que hacer una
> eleccion de direccion del producto.»

Tu veredicto no necesita permiso: REENCUADRADA reescribe el issue y sigue, OBSOLETA lo cierra y
pasa al siguiente. Solo se para si obliga a elegir dirección de producto.

## El issue

Cuerpo íntegro: `gh api repos/alberto-hortelano/ne-fan/issues/218`.

Con `./start.sh --preset e2e-sin-creditos` —el preset que imprime una URL para que la abra una
persona— el selector de mundos muestra **cuatro marcos con el icono de imagen rota**. Es lo primero
que ve quien abre el bench, y el bench existe justamente para mirar el juego sin gastar.

El issue ofrece tres salidas y no elige: que el fake sirva las portadas, que el preset levante el
asset-store, o que el selector degrade a un marcador con el nombre del mundo.

## Verificado por el crítico (2026-08-23)

Veredicto: **REENCUADRADA**. Ver `critica.md`. **Mis cuatro afirmaciones eran ciertas**, y dos se
quedaban cortas:

1. `?ai=` reapunta los cuatro — `nefan-html/src/net/service-urls.ts:22`, `NEFAN_URL_ASSET_STORE: ai`
   **sin condición**. El preset lleva `assets=0` (`start.sh:459`).
2. El fake sirve tres rutas binarias con CORS y **no** tiene `GET /styles/{id}/{file}`: solo
   `/missing` y `/complete`. La portada cae al 404 genérico.
3. **La mentira está en DOS sitios, y uno es visible al usuario.** No solo el comentario que yo
   citaba: `start.sh:377` (`SERVICE_HINTS`, que **se pinta en el TUI**) dice «emula
   narrative-llm+gpu-worker+remote-gen+asset-store», tres líneas debajo de la que describe el
   asset-store como «blobs + manifest SQLite + **covers de estilos**».
4. `coverHtml` tiene el marcador (`title-screen.ts:1103`) **pero con el nombre del ESTILO**, no del
   mundo. Y está bien así: el título del mundo ya va al lado en la tarjeta. **No hay que tocarlo**,
   solo falta el `onerror`.

### Una de las tres salidas del issue queda descartada por escrito

**«Que el preset levante el asset-store» NO arregla el bug.** Aunque `start.sh` lo arrancara en
:8767, el cliente se abre con `?ai=` (`start.sh:836`) y `service-urls.ts:22` resuelve el asset-store
al fake igualmente: 404. Para que funcionara habría que sacar el asset-store del override — y eso
**rompe las tres rutas binarias del fake**, porque el cliente las pide bajo el nombre del
asset-store. Queda escrito para que nadie la reproponga.

### El problema real, y por qué las otras dos no son excluyentes

**El cliente no degrada cuando una portada no carga**; el preset es solo la forma más fácil de
provocarlo.

- **`onerror`** — 2 líneas, el marcado ya existe. Arregla **cualquier** fallo de portada, en
  cualquier preset. **Obligatorio.**
- **`GET /styles/{id}/{file}` en el fake** — solo arregla este preset, pero convierte la prosa de
  `start.sh:377` en verdad y le enseña al bench las portadas reales. Barato: el fake ya lee
  estáticos del árbol.

### Hallazgo extra que amplía el alcance

**`qa/run.mjs:74` abre el cliente con el mismo `?ai=`.** El bench automático lleva **desde #207**
pintando cuatro portadas rotas en cada corrida, y **ningún guion lo mira**. Un guion que compruebe
las cuatro portadas es lo que evita la reincidencia.

Cadena causal cerrada: 4 juegos, sus 4 estilos por defecto tienen `cover.jpg` en disco, `listStyles`
(`nefan-core/src/games/loader.ts:351`) emite `cover_url` para los cuatro → exactamente los cuatro
marcos rotos del issue.

## Criterios de aceptación de la tanda (para después de tu veredicto)

- Quien abre la URL del bench **no ve iconos rotos**.
- La prosa de `start.sh` deja de prometer lo que no hace.
- El degradado del `<img>` no depende de que el asset-store esté arriba.
- Un guion de `qa/guiones/` comprueba las cuatro portadas, probado en negativo.

## Fuera de alcance

Generar portadas nuevas. Cambiar el preset a uno que gaste créditos.

## Veredicto del crítico

**REENCUADRADA.** Ver `critica.md`. Sin decisiones de producto pendientes.
Se hace **seguido de #217**: son vecinos (estático ausente que degrada mal, en otro proceso).
