# La huella de la puerta deja de ser mentira (#187)

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

Cuerpo íntegro: `gh api repos/alberto-hortelano/ne-fan/issues/187`. **Lee la actualización del
2026-08-22**, que ya desbloqueó el issue.

Resumen: para un volumen `gate`, `volumeFootprintCells` publica **el vano** y
`volumeCollisionGrid` estampa **las jambas** y limpia el vano. Medido con `w:8` en `at:[60,60]`:
36 celdas sólidas, las 36 fuera de la huella del manifest. **Disjuntas**. El docstring promete lo
contrario. Está congelado en `test/volume-metrics.test.ts`, que excluye `gate` de la lista de
tipos con el comentario «hoy incumple el invariante».

El propio issue avisa de la regla del repo: **render ≠ colisión es legítimo** (un árbol colisiona
por el tronco y se dibuja por la copa). Lo que no es legítimo es que la huella que se **declara**
y la que se **aplica** sean disjuntas sin que nadie lo sepa.

## Verificado por el crítico (2026-08-23)

Veredicto: **REENCUADRADA**. Ver `critica.md`.

**El coste de arte es cero — medido, no razonado.** El crítico no se fio de mi afirmación: parcheó
la rama `gate` para que devolviera las jambas y recalculó la clave del atlas sobre un tile con
portón y muralla.

```
antes:   LAYOUT KEY 599a2c7d366fedab05572b44 · huella [56,58.5,8,3]    · 36 sólidas,  0 dentro
después: LAYOUT KEY 599a2c7d366fedab05572b44 · huella [53,57.8,14,4.4] · 36 sólidas, 36 dentro
```

Clave **idéntica**, invariante de 0/36 a 36/36. `buildLayout` recibe solo prims
(`src/scene/greybox/surfaces.ts:419`), `volume-metrics` **no está** en el cierre de imports de
`buildTileGreyboxSpec` (17 ficheros), y el único consumidor en producción es
`src/scene/blueprint/fps-ambience.ts:65,96`, que sale a `lightsM/sky/fog` y nunca a `primsM`.

**Pero el issue se vende mal, y por eso REENCUADRADA**: dice que el jugador «choca con aire». Eso
es **falso** — `volumeFootprintCells` no alimenta la colisión, ni el render, ni ningún manifest.
Es **deuda de contrato, no un bug del jugador**, y su prioridad es baja.

**El comentario de `volume-metrics.ts:22-24` es falso en las DOS mitades**, no en una: `a6ebbc1`
(el plató fuera del core) borró el consumidor que justificaba el invariante, incluido el test
«manifest: huellas == volumeFootprintCells en metros de mundo». No hay manifest, y la colisión
tampoco lo llama.

### El arreglo es el A: que la huella declare las jambas

Delegando en `volumeFootprint`, como ya hacen `building con angle`, `prop con angle` y `custom`.
Sube `gate` de 10 a 11 de 14 tipos que coinciden con la huella analítica.

- **Ninguno de los tres arreglos cambia comportamiento**: el crítico comparó las 14 variantes de
  volumen y **el centro es idéntico en las 14**, `gate` incluido (vano y jambas están ambos
  centrados en `at`), y el único consumidor usa solo el centro. Se elige por integridad del
  contrato, no por efecto.
- **B (declarar ambas)** es generalidad especulativa: nadie necesita saber qué mitad se cruza — la
  colisión ya se calcula el vano sola en `clearGatePassage`.
- **C (solo el docstring)** parece el barato y es el peor: bendice que la huella devuelva **el
  negativo de la masa** y desarma el canario de una clase de fallo que ya se pagó una vez (`tower`
  con `r ?? 3` contra `r ?? 6`, `5598d2e`).
- **A no sustituye a arreglar el docstring: lo exige**, porque el manifest muerto lo deja falso
  igualmente.

## Criterios de aceptación de la tanda (para después de tu veredicto)

- La huella declarada y la colisión de un `gate` dejan de ser conjuntos disjuntos, o el contrato
  dice explícitamente qué relación tienen.
- `gate` sale de la lista de excluidos de `test/volume-metrics.test.ts` y el test congelado se
  borra (el propio test dice qué hacer al arreglarlo).
- El comentario de `volume-metrics.ts:22-24` deja de citar el «manifest del greybox», que borró
  `a6ebbc1`: hoy el único consumidor es `fps-ambience.ts`.
- Se borran **las dos** piezas de la deuda: el test congelado **y** el
  `.filter((t) => t !== "gate")` de `volume-metrics.test.ts:97`. Solo con el test, `gate` se queda
  sin cubrir y el verde no comprueba nada.
- `npm run mutate -- --cambiado` sobre `blueprint-huella`, **sin bajar su suelo**.

## Fuera de alcance

Rediseñar la colisión o el emisor de prims de otros tipos de volumen. Regenerar arte. **Fusionar
`volumeFootprintCells` con `volumeFootprint`.**

## Veredicto del crítico

**REENCUADRADA** — deuda de contrato, no bug del jugador; prioridad baja, arreglo A.
Ver `critica.md`. Sin decisiones de producto pendientes.
