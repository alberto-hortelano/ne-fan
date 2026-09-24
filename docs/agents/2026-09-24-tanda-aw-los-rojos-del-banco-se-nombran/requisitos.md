# Requisitos — tanda AW: Los rojos del banco se nombran: ejercicio dice qué test falla y el 89 espera de verdad (#751 #746)

## Petición literal del usuario

> «Sube node a latest, mientras estemos en desarrollo no fijamos version. Mutacion lanzada, sigue con la siguiente tanda. […]» (2026-09-24). Y la petición de fondo de la jornada: «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## Los issues, verbatim

### #751

> npm run ejercicio: la batería de asset-store-contrato falló una vez en CI con «fail 1» sin nombrar el test (intermitente)
> 
> En la PR #750, run 36006756432, job 107656772195, el paso `npm run ejercicio` salió rojo:
> 
> > la batería de "asset-store-contrato" no pasa, así que su cobertura está a medias…
> 
> El TAP terminaba en `# fail 1`, pero ninguna línea decía `not ok`. Al relanzar el mismo commit salió verde, y en local también sale verde (66 baterías).
> 
> Hay dos problemas:
> 1. **Intermitencia sin diagnosticar.** Algo de la batería `asset-store-contrato` falla a veces con `--test-isolation=none` en el runner. Como no hay `not ok`, parece un fallo a nivel de fichero: un hook o una suite que lanza.
> 2. **`ejercicio` no nombra el test que falla.** Solo imprime la cola del TAP, así que el rojo no se puede diagnosticar desde el log. Debería imprimir los `not ok` y los bloques de error, o el TAP entero de la batería que falla.
> 
> Relacionado: #697 y #749 (una suite que lanza se cuenta en el EXIT, pero no en `not ok`).

### #746

> Guion 89: la espera del bloque 4 se cumple sin esperar (ultimoOriginal ya está lleno desde el bloque 1)
> 
> En `qa/guiones/89-el-arma-y-el-maximo-los-dice-el-bridge.mjs`, bloque 4, la espera «vuelven a llegar frames sin reescribir» mira `window.__qaWire.ultimoOriginal`. Ese campo ya está lleno desde el bloque 1, así que la espera se cumple al instante aunque no llegue ningún frame después de `reescribir = null`.
> 
> No da un verde falso: si no llega un frame nuevo, los aros del control salen rojos. Pero el rojo culparía a los aros y no a la falta de frames.
> 
> Propuesta: guardar `vistos` al quitar la reescritura y esperar a `vistos > n`.
> 
> Lo encontró la tanda AU (#733).

## Criterios de aceptación

Los fija el crítico en critica.md a partir del issue. Mínimos: la lógica en nefan-core (el cliente solo pinta), negativos probados en rojo, guion de QA ejecutable si hay algo observable, cero créditos (motor falso y `e2e-sin-creditos`).

## Restricciones

Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node local: `source ~/.nvm/nvm.sh && nvm use node` (v26), porque las shells pueden arrancar con 24.11.1.
