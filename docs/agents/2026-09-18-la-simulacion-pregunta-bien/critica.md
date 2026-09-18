# Crítica — Tanda P · #658 REENCUADRADA · #662 REENCUADRADA · la agrupación NO se sostiene

Medido hoy sobre `main` = `900b5b71` contra `nefan-core/dist`, con sondas propias en `…/scratchpad/`
(`prec.mjs`, `grid.mjs`, `caja2.mjs`, `sweep.mjs`). Cero créditos, nada arrancado.
**El problema real, uno por issue.** #658: *nada acota la coordenada de un tile, y una coordenada absurda
congela el tick del bridge para siempre* — el `for(;;)` es el síntoma, la puerta abierta es `tile.tx/ty`.
#662: *el banco pregunta «¿puedo ir ahí?» donde quiere saber «¿hay algo ahí?»*, y **dos de esos asertos no
pueden ponerse rojos** — que es peor que los 29 que el issue cuenta.

---

## #658 — REENCUADRADA. El cuelgue existe; el suelo que lo alcanza no es el que dice el issue

| Afirmación del issue | Verificación |
|---|---|
| «`f += signo*TILE_MPC` deja de avanzar en coordenadas grandes» | **CIERTO y reproducido**: `penetracionEnSolido(v,v,0,4,{ocupado:()=>true})` no vuelve nunca desde `v = 2^52`. Umbral exacto **4.503.599.627.370.456 m ≈ 4,5036e15** (tx ≈ **7,04e13**; 0,476 años‑luz). Por debajo sale SIEMPRE por tope en ≤ 80 iteraciones |
| «corre en el tick del bridge, así que el tick se cuelga» | **CIERTO, pero por otra puerta.** Sobre el suelo de **GRID** —el único que ven `collidesAt`, `queImpideElPaso` y `porDondeSalirDeAqui`— **no puede colgarse**: medido, un grid 128×128 TODO sólido (16.384 celdas) a tx = 7,1e13 contesta `solapaSolido = false`. El mismo ulp que congela `f` deja el cuerpo de ancho CERO y el solape ABIERTO de un cuerpo sin ancho es vacío (`terrain-collision.ts:209-212`: `c0 = k`, `c1 = k-1`), así que `salidaMedida` devuelve `null` antes de marchar |
| *(no está en el issue)* | **La vía VIVA es la CAJA.** `penetracionEnCaja` es analítica y no pierde magnitud (medido: 4,4 m en el centro de una caja 8×8 a 1e16). El único llamante que le pasa un suelo con cajas es `sitioParaAparecer(punto, PLAYER_RADIUS_M, ctx.simCollision)` (`bridge/handlers/scene.ts:128`). **Reproducido: cuelga** |
| «el fail‑loud de `:262` se dispara 0 de 138.048 veces» | **CONFIRMADO con medida propia**: 0 disparos en **25.928** iteraciones sobre robledo+puerto+zorder (malla 0,25 m, suelo terreno+plan como lo monta el bridge; 0 saturaciones). Y el número VIVO es mayor: el `porque` commiteado de `mutation-targets.json` dice **0 de 379.080**. El 138.048 es del plan de la tanda I y está superado |
| «9 de los 11 equivalentes los hospedan tres piezas degeneradas» | **FALSO por uno: son 8.** Ternarios L121×2 + L127×2 (4) y `punto: {x,z}\|null` L261:80, L261:86, L262:9, **L149** (4). Los otros tres NO son de esas piezas: L144 (`signo>=0` con `1\|-1`), L227 (corte en seco) y L175 (el épsilon) |

**Consecuencia.** El guardia NO está «una capa más arriba, donde no pasa nunca»: está en la **función
correcta** —`sitioParaAparecer` es el único llamante alcanzable— y en la **forma equivocada**, porque
`siguiente === p` no puede dispararse si el bucle de abajo no devuelve el control. Y el disparador no es
«coordenadas grandes» sino **una entrada sin cota**: `tile: {tx: z.number().int()}` (`scene-schema.ts:185`),
`Number.isInteger` (`scene-validate.ts:294`), `"type":"integer"` en `generate_scene.json` y
`anchor: {tx,ty}` (`world-map/types.ts:76`) aceptan 7e13 sin pestañear. Ningún camino del juego produce esa
cifra: la produce el motor narrativo o un save editado.

**El día después.** Para quien juega, nada: es deuda declarada de fail‑loud, y como tal está bien. Retirar
`punto: {x,z} | null` mueve el recuento de mutantes, así que `break: 87` hay que **volver a medirlo**. Y si
entra el guardia y no la cota, queda un fail‑loud defendiéndose de un valor que el contrato sigue admitiendo.

**Lo que NO debe hacerse.** (1) Construir el candado sobre suelo de GRID: **nace verde con el defecto
puesto**, medido; el único suelo que reproduce es el de CAJAS. (2) Derivar su límite de `TOPE_MARCHA_M` ni
de nada que calcule la función bajo prueba (circularidad, tanda G). (3) Fusionar un cambio en
`salida-del-solido.ts` antes de que el coordinador reparta `35317748262`: `repartir` casa por **blob** y ese
módulo volvería «sin base»/incomparable — dos de las SIETE de `comparar`.

---

## #662 — REENCUADRADA. El 29 es exacto para UNA grafía y ciego para la otra

| Afirmación del issue | Verificación |
|---|---|
| «29 sitios de `window.__nefan.probeCollide` en 16 guiones» | **EXACTO hoy, al número**: 29 en 16 (02·1, 05·2, 10·2, 132·1, 133·2, 134·1, 14·1, 15·1, 16·3, 30·2, 31·3, 41·1, 45·3, 73·1, 81·1, 93·4), excluidos los MIGRADOS, el 119 declarado y las dos menciones en texto del 145. Las líneas citadas han derivado ≤ 3 |
| «…y ese es el inventario de la clase» | **FALSO: es un censo por GRAFÍA.** `ctx.nefan("probeCollide", x, z)` llega a la MISMA función (`qa/lib/sonda.mjs:330` → `window.__nefan[p](...)`) y el censo no lo ve: **12 más en 10 guiones** (02·2, 05·1, 06·1, 08·1, 09·1, 134·2, 144·1, 16·1, 30·1, 31·1) y **5 más en 2 ejecutables de `qa/`**. Total real: **46 sitios en 26 ficheros** |
| «el caso que mejor lo enseña es el mirador del 134» | **Hay uno peor y está en la mitad ciega**: `08:164` y `09:202` afirman *«el punto de aparición no es sólido (no aparece incrustado)»* con el jugador **encima del punto**. `qa/README.md:539` ya mide que eso vale `false` también en el centro macizo de un edificio: **esos dos asertos no pueden ponerse rojos hoy** |
| «los legítimos son 119:342, el hook, el 14 y el 73» | **Incompleto**: `93:434` y `93:437` son las dos mitades de un aserto cuyo SUJETO es la asimetría (`desdeLejos` vs `desdeSiMismo`); migrarlos lo vuelve tautológico. Es el error en espejo y no está declarado |
| «una aparca al jugador a 28 m» (el título) | **Son DOS miradores**: `93:413` hace el mismo protocolo a mano (`setPlayerPos(p+6,p+6)` → sonda → restaurar) |
| *(no está en el issue)* | **El candado de la clase comparte la ceguera**: el bloque 1 del guion 145 cuenta `/__nefan\.probeCollide/g` y solo sobre los 5 MIGRADOS. Migrar un sitio a `ctx.nefan("probeCollide")` **regresa en verde** |

**Coste real del criterio de cierre.** El issue presupuesta «una corrida por candidato». El runner acepta
filtro por nombre y la tanda J re-corrió SIETE guiones en una sola corrida
(`node qa/run.mjs 118 119 120 127 128 145 72`): los ~20 de navegador caben en **una** selectiva más la
batería completa. **Cabe en la tanda.** Lo que NO cabe es el **guion 15**: es **#673**, abierto hoy, rojo
**4 de 21** con un cambio ajeno y **sin vía causal encontrada**. Un verde ahí no prueba la migración y un
rojo no se puede atribuir. **Corte: el 15 fuera, declarado «aplazado por #673», no «movimiento».**

**El día después.** Para quien juega, nada directo; lo que cambia es que **dos asertos vuelven a poder
ponerse rojos**. No se cierra ninguna puerta. Lo que nadie borrará: el `MIRADOR` del 134 y el `setPlayerPos`
de `93:413`.

---

## Conflictos

- **#673 ↔ guion 15** — el único bloqueo duro de la tanda (arriba).
- **Corrida `35317748262` ↔ #658** — casa por blob. Repartir primero, fusionar después.
- **#643 (congelado por el usuario) ↔ la «propina» de #658** — `qa/el-rumbo-de-salida-no-lo-frena-la-otra-fuente.mjs`
  **congela 212 rumbos**; reestructurar `SalidaMedida`/`sitioParaAparecer` puede moverlos y poner rojo un
  candado cuyo sujeto no se está tocando. Mirarlo antes, no después.
- **#646 y #465 ↔ #658** — misma tubería (`anchor.rect`, NPC al centro crudo). No se contradicen; el
  guardia de #658 les sirve. Sin dependencia de orden.
- **`arch-rules.json`** — nada de lo propuesto toca una frontera candada; #662 vive entero en `qa/`.
**«Por qué juntos»: NO se sostiene, y es la trampa de la tanda G otra vez.** Los dos issues **no comparten
fichero ni pieza**: #658 vive en `nefan-core/src/simulation/` + el contrato de `tile`; #662 vive **entero**
en `qa/`. Intersección **vacía** — el mismo hallazgo C del plan de la tanda I sobre #643+#648. Comparten una
familia narrativa, que no es una pieza. No hay ahorro y sí un riesgo (la re-corrida de #662 esperaría a que
`dist` refleje #658 si van en la misma rama). **Dos PR independientes; #662 no espera al reparto.**

## Coste contra valor

- **#658**: barato (guardia + cota + candado sobre suelo de cajas) contra un cuelgue del tick que hoy solo
  delata un `Timeout` prestado, y que desaparece en cuanto el mutante L145 cambie. **Vale.** La **«propina»**
  es la mitad cara y la que choca con #643 y con la corrida en vuelo: **sepárala**, no es lo que pide el
  issue y arrastra una re-medida de `break`.
- **#662**: medio, y el valor no son los 29 — son los **dos asertos que hoy no pueden ponerse rojos** (08 y
  09) y el candado del 145 que no sujeta lo que promete. «No hacer nada» conserva dos verdes falsos.

## Qué cambiarle a `requisitos.md` (redactado para pegarse)

1. **#658**, en vez de «el tick se cuelga»: *«el bucle se cuelga desde |coordenada| ≥ 2^52 = 4,5036e15 m (tx ≈ 7,04e13). Sobre el suelo de GRID es inalcanzable —medido: un grid 128×128 todo sólido a tx = 7,1e13 contesta `solapaSolido = false`—; el único suelo que lo alcanza es el de CAJAS, y su único llamante es `sitioParaAparecer` (`bridge/handlers/scene.ts:128`), reproducido. El guardia está en la función correcta y en la forma equivocada. La puerta de entrada es `tile.tx/ty` sin cota (`scene-schema.ts:185`, `scene-validate.ts:294`, `generate_scene.json`) y `anchor.{tx,ty}` (`world-map/types.ts:76`).»*
2. **#658**: «0 de 138.048» → **«0 de 379.080»**, y *«verificado aparte: 0 de 25.928 sobre las tres fixtures»*. «9 de los 11» → **«8 de los 11»** (L121×2, L127×2; L261:80, L261:86, L262:9, L149). Y: *«la propina NO entra en esta tanda: mueve `break: 87` y choca con los 212 rumbos de #643 y con la corrida en vuelo».*
3. **#658**, a las restricciones: *«el candado se construye sobre suelo de CAJAS; sobre GRID nace verde, medido. Su límite no puede derivarse de `TOPE_MARCHA_M` ni de la función bajo prueba.»*
4. **#662**: «29 sitios en 16 guiones» → *«46 sitios en 26 ficheros: 29 por `window.__nefan.probeCollide` en 16 guiones (censo exacto, verificado) + 12 por `ctx.nefan("probeCollide", …)` en 10 guiones + 5 en dos ejecutables de `qa/`. La segunda grafía llega a la MISMA función (`qa/lib/sonda.mjs:330`) y es invisible al censo y al bloque 1 del guion 145.»*
5. **#662**, como caso principal: *«`08:164` y `09:202` afirman “el punto de aparición no es sólido” con el jugador ENCIMA del punto; `qa/README.md:539` ya mide que eso vale `false` en el centro macizo de un edificio. Son los DOS asertos que hoy no pueden ponerse rojos, y son la razón del issue.»*
6. **#662**, a los legítimos: *«`93:434` y `93:437` son las dos mitades del aserto de la asimetría; migrarlos lo vuelve tautológico. Y `93:413` es un SEGUNDO mirador, así que el título dice “una” donde hay dos.»*
7. **#662**: «cada candidato cuesta una corrida» → *«el runner acepta filtro por nombre (tanda J: siete en una corrida): los ~20 caben en una selectiva más la batería completa»*. Y: *«el guion 15 queda FUERA, declarado “aplazado por #673”».*
8. Sustituir **«Por qué juntos»** por: *«No comparten fichero ni pieza —#658 en `nefan-core/src/simulation/` + contrato; #662 entero en `qa/`, intersección vacía—, igual que el hallazgo C de la tanda I. Van en DOS PR independientes: #662 no espera al reparto de mutación, #658 sí.»*
