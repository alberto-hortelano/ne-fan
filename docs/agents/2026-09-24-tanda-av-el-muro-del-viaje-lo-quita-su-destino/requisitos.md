# Requisitos — tanda AV: El muro «Viajando...» solo lo quita el tile del destino (#742)

## Petición literal del usuario

> «Sube node a latest, mientras estemos en desarrollo no fijamos version. Mutacion lanzada, sigue con la siguiente tanda. […]» (2026-09-24). Y la petición de fondo de la jornada: «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## Los issues, verbatim

### #742

> Cualquier ready de tile oculta el muro «Viajando...»: un prefetch que llega durante un viaje lo quita antes de tiempo
> 
> Sale del plan de la tanda AT (#737), leído en `main` = `57addf93`.
> 
> El manejador del `ready` de tile llama a `muro.ocultar()` sin mirar si el tile que llega es el destino del viaje abierto (`nefan-html/src/main.ts:917-919`). Por eso un prefetch de un vecino que llega a mitad de viaje quita el muro «Viajando...» antes de que llegue el destino.
> 
> Pasa además que `overlayAbierto: muro.visible()` confunde «estar esperando algo» con «hay un muro de fallo pintado».
> 
> La regla de a quién pertenece un desenlace debería vivir en core, junto a `esperasQueTermina`, igual que la de los fallos tras #737.
> 
> Relacionado: #737, #693.

## Criterios de aceptación

Los fija el crítico en critica.md a partir del issue. Mínimos: la lógica en nefan-core (el cliente solo pinta), negativos probados en rojo, guion de QA ejecutable si hay algo observable, cero créditos (motor falso y `e2e-sin-creditos`).

## Criterios reescritos tras la crítica

El coordinador acepta el reencuadre de `critica.md` y sus ocho criterios, que sustituyen a los mínimos de arriba (los mínimos siguen valiendo):

> Alcance corregido por el crítico: el `ready` de tile hoy NO lleva con qué reconocer al destino (`bridge/context.ts:494-505`); marcarlo es parte de la tarea, simétrico al `fail()` de #737.
>
> 1. **Core decide el desenlace de LLEGADA** junto a `esperasQueTermina`/`deQuienEsElFallo` (`nefan-core/src/protocol/status-reparto.ts`): un `ready` cierra el viaje y su muro solo si es DEL viaje abierto. El cliente no compara `placeId` por su cuenta.
> 2. **El bridge marca con `placeId` todo `ready` emitido POR un viaje** (`runTileGeneration` con `opts.placeId`, `difundirPlaceRealizado`), incluidas las ramas de caché y `exists`, y el viaje `sin ancla` (sin `spawn`). Lo sujeta un test de bridge que se pone rojo si una rama lo omite, como hace `bridge-map.test.ts` con `fail()`.
> 3. **Un `ready` ajeno no quita ni el «Viajando...» ni un muro de FALLO.** El arranque sigue igual: el primer tile con el mundo vacío quita «Iniciando partida...» / «Generando mundo inicial...».
> 4. **El fallo del destino va al overlay por ser del viaje**, no por `muro.visible()`. `overlayAbierto` deja de alimentarse del DOM; si sobrevive en `ContextoDeRotulo`, con un hecho que core nombre. Un fallo de tile sin viaje con un muro de fallo pintado no lo sustituye.
> 5. **Un viaje `sin ancla` que llega queda cerrado**: `viajeAbierto()` vuelve a `null`.
> 6. **Negativos en rojo, anotados en `implementacion.md`:**
>    - quitar la marca en una rama del bridge pone rojo el test de bridge;
>    - un `ready` ajeno que termina el viaje pone rojo el unitario de core;
>    - con la condición quitada en `main.ts`, el guion sale rojo.
> 7. **Guion de QA** (`e2e-sin-creditos`, cero créditos), sobre la maquinaria del 173:
>    - con un viaje en espera, llega (A) un `ready` instantáneo de un tile existente vía `request_tile` y (B) el `ready` de un prefetch en vuelo;
>    - en los dos, el muro sigue en «Viajando...» y el ledger sigue abierto;
>    - después el viaje llega y el muro se va. Variante: el destino falla tras un `ready` ajeno, y el muro dice «No se pudo llegar» (no la línea de mensajes).
> 8. Fuera de alcance: #736 (el desenlace «rechazado»), que se hará después y reutilizará la noción de desenlace que salga de aquí.

## Restricciones

Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node local: `source ~/.nvm/nvm.sh && nvm use node` (v26), porque las shells pueden arrancar con 24.11.1.
