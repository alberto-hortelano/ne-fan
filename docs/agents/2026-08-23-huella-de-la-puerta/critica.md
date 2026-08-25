# REENCUADRADA — el hecho es cierto, el daño que declara no existe, y la podredumbre real es mayor

## El problema real, en una frase

`volumeFootprintCells` se documenta como origen compartido de un **manifest que ya no existe** (murió con el
plató en `a6ebbc1`) y su rama `gate` devuelve **el hueco en vez de la masa**: no rompe nada hoy porque casi
nadie la llama, y por eso es una trampa para el próximo que la llame.

El issue dice que el jugador «choca con aire». **Falso**: `volumeFootprintCells` no alimenta la colisión (la
estampa `volumeCollisionGrid` desde `volumeFootprint` — `collision.ts:278,297` — y `volumeSolidDiscRadiusCells`),
ni el render, ni manifest alguno. Propone la solución correcta; la motivación con la que la vende, no.

## La premisa, afirmación por afirmación

| Afirmación | Verificación |
|---|---|
| Huella y colisión de un `gate` son disjuntas, 36 celdas fuera, congelado con `gate` excluido | **CIERTO.** Ejecutado: huella `[56,58.5,8,3]`, 36 sólidas, **0 dentro**. Docstring `volume-metrics.ts:13-15`; congelación en `volume-metrics.test.ts:92-124` y filtro `!== "gate"` en `:97` |
| **La clave del atlas sale de `canonicalSurfaceLayoutJson(buildLayout(prims))`** | **CIERTO.** `nefan-html/src/scene/fps-atlas.ts:302`; `buildLayout` (`greybox/surfaces.ts:419`) recibe **solo prims** |
| **Las prims salen de `buildTileGreyboxSpec`, que no pasa por `volume-metrics`** | **CIERTO.** Cierre de imports de `greybox.ts` = 17 ficheros, `volume-metrics` **no está**. `volume-prims.ts:14` importa `footprint.js`; su única mención (`:119`) es un comentario donde la dependencia va **al revés** |
| **El único consumidor en producción es `fps-ambience.ts`, y no entra en ninguna clave** | **CIERTO.** `grep` en todo el repo: `:65` y `:96`; el resto son tests. `fps-spec.ts` arma `primsM` en `:268` y llama a `buildFpsAmbience` en `:307`: la ambientación sale a `lightsM/sky/fog`, nunca a `primsM`. `lightsM` solo viaja a `installTile`; `canonicalGreyboxJson` no tiene consumidor vivo que calcule clave |

**Tu afirmación se sostiene, y la he falsado en positivo.** Parcheé `gate` para devolver las jambas y recalculé
la clave sobre un tile con portón + muralla:

```
antes:   LAYOUT KEY 599a2c7d366fedab05572b44 · huella [56,58.5,8,3]    · 36 sólidas,  0 dentro
después: LAYOUT KEY 599a2c7d366fedab05572b44 · huella [53,57.8,14,4.4] · 36 sólidas, 36 dentro
```

**Clave idéntica. Coste de arte: cero, confirmado.** El issue está desbloqueado de verdad.

Lo que el issue **no** sabe: `a6ebbc1` borró el `import` del builder del plató y con él el test `"manifest:
huellas == volumeFootprintCells en metros de mundo"`. El comentario de `:22-24` es falso **en las dos mitades**
—no hay manifest, y la colisión tampoco lo llama—, más de lo que denuncia el criterio de aceptación nº 3.

## Cuál de los tres arreglos — la pregunta que me hiciste

Decide esto: **el único consumidor usa solo el CENTRO** (`fps-ambience.ts:70` y `:97-99`). Comparé las 14
variantes contra `volumeFootprint`: difieren en 4, pero **el centro es idéntico en las 14, `gate` incluido**
(vano y jambas están ambos centrados en `at`), así que ningún arreglo mueve una luz. Sin diferencia de
comportamiento, se elige por integridad del contrato:

- **A · Que la huella declare las jambas — ESTE.** Es literalmente delegar en `volumeFootprint`, como ya hacen
  `building con angle`, `prop con angle` y `custom`: sube `gate` de 10 a 11 de 14 tipos que coinciden con la
  huella analítica, restaura el invariante (36/36) y cuesta cero.
- **B · Que declare ambas.** Generalidad especulativa: **nadie** necesita saber qué mitad se cruza. La colisión
  ya se calcula el vano sola en `clearGatePassage` (`collision.ts:205-223`).
- **C · Que el docstring deje de prometerlo.** Parece el barato y es el peor: bendice que
  `volumeFootprintCells(gate)` devuelva **el negativo de la masa** y desarma el canario de la clase de fallo que
  esta casa ya pagó una vez (`tower` con `r ?? 3` aquí contra `r ?? 6` allí, `5598d2e`).

**A no sustituye a arreglar el docstring: lo exige.** El comentario de `:22-24` sigue falso por el manifest
muerto aunque `gate` se arregle.

## El día después

- **Para quien juega no cambia nada** — y hay que decirlo, en vez de dejar que parezca un bug de colisión. Es
  deuda de contrato y se prioriza como tal: baja.
- **Se cierra una puerta buena**: `gate` deja de responder «¿por dónde se pasa?» con la huella (hoy nadie lo
  pregunta; está en `clearGatePassage`). **Se borra** el test congelado (`:113-124`) y el filtro de `:97`: el
  riesgo real es borrar el test y olvidar el filtro, y que `gate` siga sin cubrirse con el verde puesto.
- **Parecerá arbitrario en un mes** que `tree` (copa 3.2 vs tronco 2.4) diverja a propósito y `gate` no: una
  línea de comentario, no un rediseño. Y si `volumeFootprintCells` merece existir aparte de `volumeFootprint`
  coincidiendo en 11 de 14, **no es de esta tarea**.

## Conflictos

- **#232** (el bridge no deriva volúmenes) toca la misma familia —dos caminos hasta la huella colisionable— pero
  por `volumeCollisionGrid`, no por `volumeFootprintCells`. **Sin solapamiento y sin dependencia**.
- **`mutation-targets.json`**: `volume-metrics.ts` vive en el módulo `blueprint-huella` con `collision.ts` y
  `footprint.ts`, así que obliga a `npm run mutate -- --cambiado` sobre ese módulo sin bajar su suelo. Es el
  coste real, y no está en `requisitos.md`.
- Nada en `arch-rules.json` ni en `CLAUDE.md` se opone; ningún issue abierto la contradice.

## Coste contra valor

Cuatro líneas, un filtro, un test borrado y dos docstrings — más la mutación del módulo, que es lo que cuesta el
reloj. Valor: cero para el jugador, alto para el siguiente que llame a esa función y reciba un agujero creyendo
que recibe una masa. **No hacer nada** es defendible mientras el único consumidor use el centro, y deja de serlo
en cuanto alguien pida la huella de un `gate` para otra cosa; como cuesta casi nada, **sale más barato hacerlo
que volver a discutirlo**. Lo que **no** se hace es esperar a que rote el atlas.

## Qué le cambiarías a `requisitos.md`

Sustituir el bloque «Lo que hay que verificar» por esto:

> **Verificado (crítico, 2026-08-23).** El coste de arte es **cero**, medido y no razonado: parcheada la rama
> `gate` para devolver las jambas, la clave del atlas sale **idéntica** (`599a2c7d…`) mientras el invariante
> pasa de 0/36 a 36/36. `buildLayout` recibe solo prims, y `volume-metrics` no está en el cierre de imports de
> `buildTileGreyboxSpec`.
>
> **El arreglo es el A: que la huella declare las jambas**, delegando en `volumeFootprint` como ya hacen
> `building con angle`, `prop con angle` y `custom`. Declarar ambas es contrato para un consumidor inexistente;
> tocar solo el docstring bendice que la huella devuelva el hueco. Ninguno cambia comportamiento: el único
> consumidor (`fps-ambience.ts`) usa el **centro**, idéntico en ambos casos.

Añadir a los criterios: que el comentario de `volume-metrics.ts:22-24` deje de citar el «manifest del greybox»
(lo borró `a6ebbc1`; hoy el único consumidor es `fps-ambience.ts`); que se borren **las dos** piezas de la deuda
—el test congelado y el `.filter((t) => t !== "gate")` de `:97`—; y `npm run mutate -- --cambiado` sobre
`blueprint-huella` sin bajar su suelo. Y a «Fuera de alcance»: fusionar `volumeFootprintCells` con
`volumeFootprint`.
