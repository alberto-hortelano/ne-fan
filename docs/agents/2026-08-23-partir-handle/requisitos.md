# Partir `handle` del State API por concepto (#225)

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

Cuerpo íntegro: `gh api repos/alberto-hortelano/ne-fan/issues/225`.

`handle` (`nefan-core/bridge/state-http-server.ts`) tiene **complejidad 158** y es una cadena de ifs
que enruta a mano todo el State API. La nota de `data/contract/quality-thresholds.json` declara que
los **10 puntos de holgura del gate de CRAP existen por ella** y «mueren con `handle`»: mientras
siga entera, el tope no puede bajar por mucho que se limpie alrededor, y el gate protege menos de lo
que parece.

Precedente que dice que sale bien: `validateScene` era el mismo caso —la peor de la tabla, una
cadena de ifs— y la PR #194 la partió en ocho pasadas, cada una probable sola.

## Verificado por el crítico (2026-08-23) — **VIGENTE**

El primer VIGENTE de la cola. Ver `critica.md`. La afirmación que decidía el veredicto **se
sostiene, y por una razón más fuerte que la de la nota**. Tabla real de hoy:

```
  158.4  158  98%  handle · bridge/state-http-server.ts:173
  126.0  126  99%  expandScenePrimitives · src/scene/scene-expand.ts:220
   69.2   49  80%  handle · services/asset-store/http-server.ts:76
```

**El tope baja: 170 → ~127.** El peor valor pasa a `expandScenePrimitives`, pero **los 10 puntos de
holgura no migran: se evaporan.** El CRAP es cúbico en (1−cobertura), así que el ruido de medida que
mueve a `handle` 0,6 puntos (98 % de cobertura) mueve a `expandScenePrimitives` **0,11** (99 %).
El ancla nueva **no oscila**, y por eso el margen deja de hacer falta.

**Lo que el issue exagera**: «es lo único que impide bajar el tope» — impide bajarlo **de 158**. El
suelo siguiente es 126, no 30.

**El precedente no dice lo que se le atribuye**: el tope era **170 antes y 170 después** de la PR
#194. Cuando se partió, `validateScene` ya no era el ancla: había caído de 196 a 129 al **borrarse
el plató**, no al trocearse. Lo que #194 sí demuestra es que **el corte funciona** — ninguna de sus
ocho pasadas aparece hoy en el top-40.

**La tabla ruta→handler ya existe como dato**: `WorldStateApi`
(`nefan-core/src/contracts/world-state.ts:238`), 27 endpoints con method+path, y
`test/state-http-contract.test.ts` ya exige rama real para cada uno. El router la **duplica a mano**
en 28 guardas.

**La red existe a medias** (838 líneas de test contra el server real, 98 % de cobertura de `handle`)
y **no habrá score de mutación**: `bridge/` no está en el reparto de `mutation-targets.json`.

## Criterios de aceptación — con el número fijado

- **El tope de CRAP baja de 170 a ≤ 130**, con el margen **medido en tres pasadas**, no elegido. Y
  queda dicho que **no** se acerca al objetivo de 30: el suelo siguiente es 126 y está fuera de
  alcance.
- **Cada pieza se invoca sin levantar un servidor HTTP.** Es lo que hace falsable «probable sola», y
  como `bridge/` no está en el reparto de mutación, no hay score que lo demuestre por nosotros.
- **La guarda de sesión `x-nefan-session` queda UNA vez, antes del despacho**: es un invariante de
  seguridad, y duplicarlo por handler empeora el fichero aunque el CRAP baje.
- La red de caracterización que demuestre que no cambia comportamiento existe **antes** de partir.

## Orden — restricción, no nota

**#225 va antes de #179, #195 y #224**, y sin solaparse con ninguna. Las tres editan dentro de
`handle` y ninguna ha empezado a implementarse: #179 en `POST /map/link`, #195 en
`POST /scene/validate` (la llamada sin try/catch que produce el 500) y #224 en
`GET /sessions/asset_refs` (doble parseo del corpus confirmado: `list()` + `read()` por save).

## Fuera de alcance

Cambiar el contrato HTTP del State API. Reescribir `expandScenePrimitives`.

## Veredicto del crítico

**VIGENTE.** Ver `critica.md`. Sin decisiones de producto pendientes.
