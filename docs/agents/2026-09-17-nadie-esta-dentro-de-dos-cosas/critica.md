# Crítica — Tanda I · #643 **REENCUADRADA** · #648 **VIGENTE** (con la cuenta corregida por uno)

Medido hoy sobre `main` = `e5cdebb5`. Sondas en el scratchpad; producción sin tocar y `git status` limpio al
acabar. Cero créditos: nada de esto abre navegador ni llama a un servicio.

**La premisa de los requisitos que se cae antes de empezar.** Dicen que «el fichero ha cambiado desde
entonces»: **no ha cambiado.** `salida-del-solido.ts` tiene UN commit (`6ca8dc1d`, PR #641) y el blob que midió
la corrida 35217880491 (`reports/mutation/corrida.json` → `cf2c13f2`) es `00980f42`, **el mismo de HEAD**. Las
líneas del `porque` (L121/127/144/149/175/227/229/256-262) casan una a una: los 17 valen sin re-medir.

## 1 · #643 — REENCUADRADA

**El problema real:** dos fuentes miden la penetración por separado, así que **el rumbo que una promete como salida más corta lo frena la otra** — no que nadie salga.

| Afirmación | Verificación |
|---|---|
| «`porDondeSalirDeAqui` contesta `{de:"tile"}` y ese rumbo lo frena la caja» | **CIERTA.** Con la composición literal de `bridge/sim-collision.ts:244-266`: caja 3×9 en la cara +X → frenado en **912 de 1.106** puntos; carro 2×2 dentro del edificio → **183 de 841** |
| «**2 de 36 rumbos libres**» | **CIERTA y exacta.** 888 de esos 1.106 dan exactamente 2/36; 176 de los 841, también |
| (implícito en el título) **que de ahí no se sale** | **FALSA, medida.** NPC con `stepTowards` y sus 7 deflexiones reales (1,2 m/s, 60 Hz): **357 de 357** arranques dentro de las dos salen del tile, el peor en **6,27 s**, y **ninguno usa el escape de #583**. El watchdog ni se acerca: mínimo **2,55 m** en 3 s y pide 1 m. Jugador con `pasoDelJugador` y el cableado de `nefan-html/src/world/collision.ts:104`: **0 de 1.070** puntos sin rumbo que saque (peor caso: 12 de 36 no sacan, 24 sí) |
| «ojo, celda a celda literal encierra» | **No aplica, y hay prueba viva.** La marcha sobre la unión YA CORRE en producción: `bridge/handlers/scene.ts:128` le pasa `ctx.simCollision` a `sitioParaAparecer`, y `SimCollisionProvider.ocupado` (`sim-collision.ts:275-278`) **es** tile ∪ cajas. 13 de 13 edificios salen, ≤ 3,90 m |

**Lo que el issue no dice y decide la tanda:** unir la fuente **solo** en `porDondeSalirDeAqui` no arregla nada
y puede empeorarlo — medido, el carro 2×2 sigue frenando **los mismos 183** y el granero de la esquina pasa de
**0 a 21**, y esos 21 los frena el **tile**, que es justo el impedimento que **no** abre el escape de #583. El
motivo es de fondo: `cajaBloquea` mide penetración exacta de rectángulo y la marcha la mide por celdas, así que
mientras la regla de paso sea por fuente ningún rumbo está a salvo. **O se unen las dos cosas o no se toca
ninguna.** Y unir la regla de paso **cuesta algo que el issue no nombra**: `PorDondeSalir.de` es casi gratis
(solo alimenta un `warnOnce`, `npc-behavior.ts:680-682`, y un aserto, `test/sim-collision.test.ts:207`), pero
`Impedimento.de` es carga viva — decide el escape del encajonado (`npc-behavior.ts:760`: se atraviesa una caja,
nunca un muro), y una penetración sobre la unión no sabe de quién es.

**El día después.** Para quien juega, nada visible: nadie estaba encerrado y nadie lo estará. Cambia que el NPC
salga por la cara más corta en vez de por deflexión, dentro de un edificio y de espaldas. Se vuelve más difícil
decir de QUÉ se sale y QUÉ frena, que es sobre lo que razona #583. Quedan sin dueño y nadie los borrará:
`cajas-de-runtime.ts:159-164` y el «Lo que NADIE prueba todavía» del `porque`.

**Coste contra valor.** El arreglo bueno toca la geometría de paso de los dos cuerpos para quitar una
lentitud que nadie ve, y paga con la pieza que sujeta #583. **No hacer nada es defendible y va con número:
357/357 salen, 0 escapes, peor caso 6,27 s.** Lo barato y que sí vale hoy es **dejarlo candado**: que el rumbo
de `porDondeSalirDeAqui` no lo frene ninguna fuente sale **rojo en 912 de 1.106** sin tocar producción. Aviso:
un candado que afirme «nadie se queda encerrado dentro de las dos» **nace VERDE** (medido) y sería el cuarto
sin sujeto vivo en tres tandas. Tiene que afirmar **que el rumbo de salida no se frena**; y si va como barrido
en `qa/`, con `probePoint` y no `probeCollide`, o nace con **#651** puesto.

## 2 · #648 — VIGENTE, y la cuenta está mal por uno

**El problema real:** la función que decide dónde aterriza el jugador al viajar admite que le inviertan el paso de salida sin que nada se entere.

- **«uno invierte el paso de salida con la suite en verde»** — **CIERTA, y mayor de lo que dice.** Apliqué el
  mutante (L261, `p.x + …` → `p.x − …`) y corrí **la suite entera**: **2966/0 en verde**. No es que la batería
  del módulo no lo vea: no lo ve nadie en el repositorio.
- **«7 de los 17 en `sitioParaAparecer`, los otros 10»** — **FALSA por uno.**
  `reports/mutation/salida-del-solido.json` dice **8 y 9**: L256 ×1, L261 ×4, L262 ×**3** (dos `NoCoverage` + un
  `Survived`). El issue escribe «las dos formas de neutralizar el corte `siguiente === p`» y son tres; la que
  falta es el `EqualityOperator` sobre `siguiente.z`, `NoCoverage` porque el `&&` corta antes en el único test
  que llega ahí.
- **«los dos cortes en seco de `solidoBloquea` (L227, L229) son optimizaciones»** — **CIERTA de L227, FALSA de
  L229.** L227 es equivalente en veredicto (con el origen libre `penetracionEnSolido(hasta) > 0` ⟺
  `ocupado(hasta)`: la marcha nunca devuelve 0 sobre un punto ocupado) y solo se distingue por coste. L229 deja
  `solidoBloquea` en **«desde dentro no frena nada nunca»**: conducta, se ve andando, y no va en el mismo
  renglón que L227.

**¿Matar o quitar el código que los hospeda? Matar, medido.** El precedente `arch-cierre`/`render-mode` es
para código inobservable y este no lo es: basta un `SueloSolido` **analítico de tres líneas** —sin grid, sin
fixture— con un macizo ASIMÉTRICO (`x ∈ [0,400]`, `z ∈ [0,800]`, cuerpo en (245, 400): la cara +X a 155 m,
alcanzable en cuatro marchas de 40; la −X a 245, no). El original devuelve `{x: 400.5, z: 400}` y el mutante
`null`. Y el control dice por qué sobrevive hoy: el macizo **simétrico** de
`test/salida-del-solido.test.ts:296` devuelve `null` con los dos.

**Día después y coste.** El jugador no nota nada: la conducta ya es la correcta, falta quien la sujete. Se gana que la función del viaje no se pueda invertir en silencio, y el suelo sube. Coste: fakes analíticos en un fichero que ya existe. **Es la mitad barata y sin decisiones pendientes de la tanda.**

## 3 · Conflictos

- **#646**: **no entra**, y no por alcance sino por bloqueo — su propio cuerpo dice que mover el destino solo
  sirve si el NPC sabe rodear, y eso es #618, en `futuro` con #298. #648 endurece `sitioParaAparecer`, la
  función que #646 usaría el día que se desbloquee: **abarata, no choca.** #618 no lo toca ninguna.
- **#651**: solapa solo si el candado de #643 nace en `qa/` con `probeCollide`. No obliga a ordenarlas.
- **`arch-rules.json` / `CLAUDE.md`**: nada. El invariante «no hay una segunda geometría» **lo favorece** la
  unión (una sola cuenta sobre un `ocupado` mayor); el punto 2 de `requisitos.md` teme lo contrario.

## 4 · Qué cambiarle a `requisitos.md`, frase a frase

1. L39-40, «el fichero ha cambiado desde entonces» → **«el fichero NO ha cambiado: el blob que midió la
   corrida 35217880491 (`cf2c13f2`) es `00980f42`, el de HEAD. Lo que hay que re-verificar no es la medida de
   mutación, es la CONSECUENCIA que el issue implica.»**
2. L24, celda de #643 → **«Dentro de DOS geometrías a la vez el rumbo que da una lo frena la otra en hasta 912
   de 1.106 puntos (2 de 36 libres) — pero de ahí SE SALE: 357/357 NPCs, 1.070/1.070 arranques de jugador. El
   defecto es que el rumbo de salida miente, no que encierre.»**
3. L25 y L77-79 → «**7** de los 17» pasa a «**8** (L256 ×1, L261 ×4, L262 ×3)» y «los 10 restantes» a «los **9**».
4. L49-51, «Dos de ellos (L227 y L229) son optimizaciones» → **«L227 es equivalente en veredicto y solo se
   distingue por coste; L229 NO: su mutante deja `solidoBloquea` sin frenar nada desde dentro, que es conducta
   y se mata con un aserto.»**
5. L75-76, criterio de #643 → **«el candado afirma que el rumbo de `porDondeSalirDeAqui` NO lo frena ninguna
   fuente (hoy rojo en 912 de 1.106). Uno que afirme que nadie se queda encerrado NACE VERDE y no vale. Si va
   en `qa/`, con `probePoint` (#651).»**
6. Añadir a «Lo que la tanda NO debe hacer»: **«No unir la fuente SOLO en `porDondeSalirDeAqui`: medido, deja
   los mismos 183 puntos frenados en un caso y sube de 0 a 21 en otro, y esos 21 los frena el TILE, que no abre
   el escape de #583. O se une también la regla de paso —con la atribución de `Impedimento` reconstruida— o no
   se toca la geometría y la tanda entrega el candado y #648.»**
7. Añadir al final: **«Si hay que sacrificar algo, se sacrifica #643.»**
