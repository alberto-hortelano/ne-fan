# Crítica — Tanda V (#677 + #687)

**Veredicto: REENCUADRADA.** El problema es real, pero el censo del issue está mal en tres de once (y le faltan tres), y la medida que pide **no puede decidir el número**: con el motor falso un tile llega en menos de 2 s y todos los candidatos (60/90/180/240 s) están a 30-100× de eso. Lo que decide el cortafuegos es el coste de un cuelgue real, no el p95 del camino feliz. #687 va bien junto: H-3, H-4 y H-5 viven en la misma función que la constante; H-7 no tiene sujeto.

## El problema real, en una frase

El banco espera «un tile del bridge» con CUATRO cortafuegos distintos (60, 90, 180, 240 s) por tres caminos que acaban en el mismo `runTileGeneration`, sin que nadie haya escrito por qué difieren ni cuánto cuesta cada uno cuando el bridge calla de verdad.

## La premisa, afirmación por afirmación

| Afirmación | Verificación |
|---|---|
| «Once sitios esperan un tile del bridge» | **Falso en tres.** `qa/guiones/115:175` espera a `#ts-style-progress` diciendo «Estilo aplicado»: es el PAGO del batch de estilo, no un tile. `qa/lib/sesion.mjs:499` (`regenerarMundo`) y `:541` (`curarMundo`) esperan a `data-gen-phase` terminal del título: la pre-generación de **9 escenas** (README del 120: «9 llamadas al motor falso»), un lote, no un tile |
| «Nueve a 240, dos a 90» | **Incompleto.** Faltan tres sitios del mismo sujeto: `05:255` y `42:210` (`holdUntil` a **180 s**, «el jugador entra en el tile recién generado», bendecidos como sujeto-bridge en `esperas-que-conducen.json:11-20`) y `63:130-135` (`request_tile` prefetch y espera del tile **en el save** a **60 s**). Censo real de un-tile: 90 ×2 (120, 127) · 60 ×1 (63) · 180 ×2 (05, 42) · 240 ×6 (08:106, 09:92, 15:393, 74:139, 75:235, 144:164) = once, pero otros once, con cuatro números |
| Tres caminos, un sujeto | Cierto: `request_tile` por cable → `bridge/handlers/tile.ts:284` (`sceneGen.enqueue` + `runTileGeneration`); viaje por salidas → `handlers/scene.ts:50` y `:257` (`runTileGeneration`); exploración por frontera → el propio cliente manda `request_tile`. El generador es el mismo |
| «Nadie ha medido cuánto tarda» | **Medido de sobra para el orden de magnitud.** El motor falso responde con retraso **0** por defecto (`labs/narrative/fake-ai-server.ts:120` `SCENE_DELAY_MS ?? 0`, `:285` `TILE_DELAY_MS ?? 0`). La corrida ENTERA del 127 —stack + 6 partidas + **7** esperas de tile— cuesta 17-18 s (`docs/agents/2026-09-18-el-reloj-del-banco/critica.md:13`, 8 corridas), y el ✘ por error llegó en 179 ms (`implementacion-656.md:144`). Un tile del falso está por debajo de 2 s. `labs/narrative/runs/` (agosto, motor real) no sirve: es otro contrato y otro coste |
| «HOLGURA_DEL_TECHO = 1,25 es el precedente» | Existe, pero mide varianza entre corridas de un RELOJ; aplicado a p95 ≈ 2 s daría ~3 s, que es exactamente el presupuesto de pared que #545 enseñó que miente bajo carga. El precedente no transfiere |
| H-3: precedencias invertidas | **Cierto.** `sesion.mjs:710-716` llegado > fallo > rechazado; `tile-episodio.mjs:136-138` llegado > rechazado > fallo. Inocuo hoy: `parada` solo se compara con `null` (`sesion.mjs:735`). `sesion.mjs` exento en `banco-medido.json:5` |
| H-4: 7 × 90 s bajo silencio | **Cierto.** Siete `pedirYEsperarTile` en el 127 (`:222` ×2, `:230`, `:333`, `:353` ×3); `ctx.absorbe` (`sonda.mjs:311-327`) devuelve `null` y `ctx.expect` no corta. Solo bajo silencio REAL: con `mode:"error"` o rechazo el ✘ sale en < 2 s |
| H-5: `hook.tiles ?? []` | **Cierto y latente.** `nefan-hook.ts:133` publica `tiles` como getter que siempre devuelve array; el `?? []` (`sesion.mjs:710`) solo actúa si el hook pierde la clave, y entonces `veredictoDeTile` ya lanza al leer (`tiles: hook.tiles ?? null`) — pero 90 s después |
| H-7: md5 que no casa | **Sin sujeto.** El recibo vive en `implementacion-656.md` (gitignored) y el propio fichero lo reconoce en `:442`. El 120 hoy da `19ffd5ff…` (cambió después). Nada que hacer |

## El día después

- Si se ejecuta tal como está escrito: un guion de 30 muestras dirá p50 ≈ 1 s, p95 ≈ 2 s, y con eso **cualquier** número entre 10 s y 240 s es defendible; la tanda gastará una medida para volver a decidir a ojo. Y los tres sitios que no son tiles (115, 499, 541) heredarían un presupuesto medido sobre otro sujeto: la pre-gen de 9 escenas con `HOLGURA` de un tile suelto se pone roja en cuanto el falso duerma.
- Lo que sí cambia si se reencuadra: una constante con dueño para el sujeto «un tile del bridge», usada por los once sitios (o por el helper que los agrupe, que hoy solo existe para el cable), con la aritmética del CUELGUE escrita: cuántas esperas por guion × cortafuegos = minutos perdidos cuando el bridge calla. Ese producto es lo que #656 ya dejó escrito junto a `MS_DEL_TILE` (`sesion.mjs:604-621`) y lo que H-4 pregunta.
- Lo que se vuelve visible y hoy no lo es: seis de los sitios a 240 (08, 15, 74) ni miran `viaje.error`; un viaje que el bridge declara roto quema los 240 s enteros. Es el defecto MUDO de #656 en el camino del viaje, y es lo que de verdad hace caro un cortafuegos alto. No es de esta tanda arreglarlo, pero es la razón medible por la que 240 cuesta más que 90, y hay que decirlo en vez de «medir».
- Para quien juega no cambia nada; es deuda del banco declarada. Nadie borrará nada; el riesgo es dejar la constante en el cable y los seis literales en los guiones.

## Conflictos

- **Tanda AF (#678)** censa los clientes WS del banco que cierran sin esperar y nombra el `pedirTile` del 63 como candidato a pasar al helper con dueño. El 63 es también uno de los once del censo corregido (60 s). Si AF lo mueve a `pedirYEsperarTile`, su presupuesto pasa a ser `MS_DEL_TILE` **solo**: hay que acordar quién toca el 63, o V deja el número y AF el socket. Orden: V fija la constante primero, AF la hereda.
- **Tanda U (#680)**: numeración del guion de medida, si se escribe. El prefijo lo elige quien fusiona.
- Sin contradicción con `CLAUDE.md` ni `arch-rules.json`; `esperas-que-conducen.json` ya bendice el sujeto-bridge para 05 y 42, y una constante compartida no rompe esas exenciones (nombran la `desc`, no el número).

## Coste contra valor

Medir 30 muestras es barato (~1 min de reloj) y vale como **recibo** de que el suelo está lejos; no vale como decisión. No hacer nada deja cuatro números y un guion que puede quemar 10,5 min en silencio; hacerlo mal (HOLGURA × p95) deja un presupuesto que se pone rojo bajo carga —la clase de rojo que #545 costó una semana atribuir—. El trabajo que paga es el de H-4 y la unificación con aritmética; la medida es el adorno.

## Qué le cambiaría a `requisitos.md`

Sustituir «Los issues», el criterio 1 y el 2 por esto, tal cual:

> **#677, corregido contra el árbol.** El sujeto «un tile del bridge» tiene ONCE esperas y CUATRO cortafuegos: 60 s (63:130-135, en el save), 90 s (120, 127 vía `MS_DEL_TILE`), 180 s (05:255, 42:210, `holdUntil` por frontera), 240 s (08:106, 09:92, 15:393, 74:139, 75:235, 144:164, por viaje). **Fuera del sujeto**: 115:175 (pago del batch de estilo) y `sesion.mjs:499/:541` (pre-generación de 9 escenas, un lote); se dejan como están y se dice.
>
> 1. Medida con motor falso (retraso 0 por defecto, `fake-ai-server.ts:120,:285`), N ≥ 30, p50/p95/máx, reproducible en `qa/`. Se escribe como **suelo** («un tile del falso llega en X s; el cortafuegos está a Y× de ahí»), no como fuente del número. Ya se sabe que está bajo 2 s (127 entera: 17-18 s con 7 esperas); la medida lo confirma con recibo.
> 2. **Un** cortafuegos para las once esperas, decidido por el coste del CUELGUE y escrito: esperas por guion × cortafuegos = minutos perdidos cuando el bridge calla, y qué sitios paran antes por estado (`viaje.error`, tres desenlaces) y cuáles no. Si quedan dos números, el porqué va donde se lee, y no es «lo midió el falso».
> 2b. Fuera de alcance, apuntado como issue: el 08, el 15 y el 74 no miran `viaje.error`; el viaje roto quema el cortafuegos entero (el MUDO de #656 en el camino del viaje).
>
> H-7 se cierra sin trabajo: el recibo vive en un fichero gitignored que ya lo reconoce (`implementacion-656.md:442`).

Y en «Preguntas abiertas», retirar la suposición «se aplica lo que diga la medida»: la medida no puede decir 90 ni 240, dirá 2.
