# Crítica — Tanda Y · #643 **EN CONFLICTO** (con la decisión del usuario del 2026-09-17), y reencuadrada si se levanta

Medido hoy sobre `main` = `a25d8c2f`, `dist` reconstruido a las 18:51 (posterior a las dos fuentes). Sonda en el
scratchpad (`sonda-643.mjs`), producción sin tocar. Cero créditos.

## Qué se hizo YA y por qué el issue sigue abierto

La tanda I (17-09) **no lo cerró a medias: lo dejó abierto a propósito.** `requisitos.md` de I, sección «DECISIÓN DEL
USUARIO»: servidas tres opciones, el usuario eligió **«Candado, sin tocar geometría»** — #643 NO se arregla y NO se cierra.
La PR #666 (`8e978205`) entregó #648 entero y el candado `qa/el-rumbo-de-salida-no-lo-frena-la-otra-fuente.mjs`, que
congela el tamaño del defecto (`TECHO_643 = 212`, L153) y corre en `candados-headless`. Desde entonces solo tocó el
fichero #658 (`78b01dcf`, fail-loud de `marchaPorEje`): geometría intacta, `sim-collision.ts` sin commits desde el 17.
**El issue no tiene ni un comentario**: la medida que lo reencuadra vive en el cuerpo de la PR #666, no en él.

## El problema real, en una frase

El NPC metido en el tile Y en una caja recibe un rumbo de salida que el paso siguiente le frena, así que sale por deflexión
y más despacio — **nadie se queda dentro** (357/357 NPCs, 1.070/1.070 arranques de jugador, medido en I y no desmentido).

## La premisa, afirmación por afirmación

| Afirmación de `requisitos.md` | Verificación hoy |
|---|---|
| «2 de 36 rumbos libres» | **CIERTA, y es el peor cajón, no la norma**: de los 724 puntos en las dos, 166 tienen exactamente 2/36; 178 tienen 10, 67 tienen 11, 286 tienen 19, 27 tienen 20. Mínimo 2, ninguno 0 |
| «`porDondeSalirDeAqui` contesta `{de:"tile"}` y lo frena la caja» | **CIERTA**: 212 de 724, todos `salida:tile → frena:caja` (guion, 0,44 s, exit 0). El orden tile-primero es deliberado: `sim-collision.ts:241-243` y `:258-260` |
| «penetración sobre la UNIÓN» arregla | **CIERTA si se une en las DOS cuentas**: `salidaDelSolido` y `solidoBloquea` sobre `provider.ocupado` (que ya ES tile ∪ cajas, `sim-collision.ts:275-278`) dan **0 de 724** frenados y el mínimo de rumbos libres sube de 2 a **19**. Unirla solo en el rumbo empeora (crítica de I: 0 → 21 frenados por el TILE) |
| «el docblock de `cajaBloquea` lo admite» | **FALSA de sitio**: `cajaBloquea` (`obstaculos-del-jugador.ts:186-211`) promete que «deja salir SIEMPRE». Quien admite «dos cajas encajadas pueden empujar en sentidos contrarios» es `salidaDeLasCajas`, `cajas-de-runtime.ts:160-164` — y es el caso caja–caja, que el guion no puebla |
| «`salida-del-solido` no tiene base» (criterio 3) | **CADUCADA**: la huella trae la corrida `35354800866` sobre el blob `0fd9726b`, **el de HEAD** — 100 mutantes, 13 vivos, 2 `Timeout`, 1 sin ejercer, `break` 87 justo al límite. 100 < `tope_local` 120: `local` lo acepta. Pero **el arreglo no vive ahí**: vive en `bridge/sim-collision.ts`, que no se muta, así que esa medida no mide el cambio |
| Criterio 1: «≥ 1 rumbo libre… medido con el censo de puntos sin salida (3.117 → 0)» | **NACE VERDE tal como está escrito, dos veces**: hoy ya hay ≥ 2 rumbos libres en todos los puntos, y el censo de `nadie-se-queda-encerrado.mjs` ya está en 0 CON el defecto puesto. El instrumento del issue es `TECHO_643`, y el criterio es **212 → 0** |

**Lo que la unión cuesta y el issue no nombra, medido sobre 26.064 pasos (724 puntos × 36 rumbos):**
- **178 pasos los frena la unión y no los frena ninguna fuente por separado** → `Impedimento.de` no sabe de quién son, y
  `de` es carga viva: decide el escape del encajonado (`npc-behavior.ts:760`, atraviesa cajas y nunca un muro). Hace falta
  una regla de atribución; cuál, es del arquitecto.
- **6.002 pasos los frena alguna fuente y la unión NO**: la unión es más permisiva, no encierra (el miedo de la tanda E
  va en la dirección contraria). Pero el jugador sigue con la regla por fuente (`nefan-html/src/world/collision.ts:104-105`),
  así que en esos 724 puntos **jugador y NPC dejarían de colisionar idéntico**, que es lo que promete el docblock de
  `sim-collision.ts:3-10`. `plan-collision.test.ts` no lo cazaría: no monta cajas de runtime (0 apariciones).
- `queImpideElPaso` en el punto doble: **19 → 28 µs** (×1,5), transitorio. La tabla de coste de `sim-collision.ts:33-45`
  es una medida documentada y hay que re-medirla, no dejarla.
- Tests que fijan el orden actual y habría que reescribir, no borrar: `test/sim-collision.test.ts:189` y `:206-217`.

## El día después

Para quien juega: **nada visible** — el NPC sale por la cara más corta en vez de deflectar, uno o dos segundos menos dentro de
un edificio. Se gana que la regla sea una y que `TECHO_643` baje a 0 y el guion pase de congelar a exigir. Se cierra la puerta
de «tile primero, caja después» como forma de saber QUÉ frena; a cambio hay que inventar la atribución de 178 pasos. Se borra
o se reescribe: la prosa del orden en `sim-collision.ts:241-243/258-260`, «sentidos contrarios» en `cajas-de-runtime.ts:160-164`,
la cabecera del guion (dice «sigue abierto por decisión del usuario»), el `porque` de `salida-del-solido` (cita el candado como
defecto vivo). Dentro de un mes lo arbitrario será la regla de atribución si no lleva su número escrito.

## Conflictos

- **Con la decisión del usuario del 17-09 («Candado, sin tocar geometría»)**: es de hace 24 h, tomada sobre estos mismos números,
  y «ve cerrándolos» no la nombra. Lo que sí ha cambiado es UNA cosa: hoy está medido que la unión en las dos cuentas del bridge
  da 0/724 sin tocar al jugador, cuando la crítica de I estimaba que el arreglo bueno «toca la geometría de paso de los dos
  cuerpos». **Resuelve**: apuntarlo en «Preguntas abiertas» con la suposición tomada. Las dos suposiciones cierran el issue:
  (a) mantener la decisión y cerrar #643 en **«no se adopta, con el número»** (precedente #443) — coste: prosa de la cabecera del
  guion, `TECHO_643` se queda como congelador; (b) levantarla y arreglar con el encuadre de abajo. Si el coordinador no quiere
  revocar al usuario sin preguntar, (a) es la que respeta lo dicho; (b) es la que deja el repositorio coherente.
- **#618 / #646** (NPC no rodea; destino en el centro del `anchor.rect`): fuera, y no chocan — el rumbo de salida es previo al steering.
- **#583 (cerrado)**: su escape depende de `Impedimento.de`; la atribución nueva no puede dejar de distinguir muro de caja.
- Otras tandas de hoy: ninguna toca `sim-collision.ts`, `salida-del-solido.ts`, `cajas-de-runtime.ts` ni `collision.ts` del
  cliente (tanda X toca el padrón de sondas, que no censa `queImpideElPaso`). Roce solo en `qa/README.md`.

## Coste contra valor

Valor: coherencia interna (una regla, un `ocupado`) y un NPC uno o dos segundos más ágil dentro de un edificio; cero para el
jugador en pantalla. Coste: bridge + atribución + tests reescritos + re-medir la tabla de coste + guion a 0; si se quiere que
«idéntico» siga siendo verdad, también el cliente. **No hacer nada es defendible y va con número** (nadie encerrado, peor caso
6,27 s) — es lo que el usuario eligió ayer. El único motivo para no elegirlo hoy es el mandato de cerrar y que el arreglo está
medido más pequeño de lo que se creyó.

## Qué cambiarle a `requisitos.md` (para pegar tal cual, si se levanta el conflicto)

- Añadir «Preguntas abiertas»: **«El 17-09 el usuario decidió “candado, sin tocar geometría” para #643. Hoy se levanta esa
  decisión porque está medido que la unión en las DOS cuentas del bridge da 0/724 sin tocar al jugador. Suposición tomada: (b).
  Si el usuario la mantiene, #643 se cierra en “no se adopta, con el número” y se revierte la geometría.»**
- Criterio 1 → **«`qa/el-rumbo-de-salida-no-lo-frena-la-otra-fuente.mjs` pasa de congelar a exigir: `TECHO_643` 212 → 0, y el
  guion deja de aceptar “bajó” como verde. El censo de `nadie-se-queda-encerrado.mjs` NO es el instrumento: ya está en 0 con el
  defecto puesto.»**
- Criterio 2 → **«Una sola regla (penetración no creciente) sobre un solo `ocupado` (tile ∪ cajas) en las DOS consultas del
  bridge, `porDondeSalirDeAqui` y `queImpideElPaso`. `Impedimento.de` sigue distinguiendo muro de caja: los 178 pasos que la
  unión frena sin que lo haga ninguna fuente sola llevan regla de atribución escrita y medida, y el escape de #583 no cambia de
  conducta. El docblock que se corrige es el de `salidaDeLasCajas` (`cajas-de-runtime.ts:160-164`), no el de `cajaBloquea`.»**
- Añadir criterio de ALCANCE: **«Decidir y escribir si el jugador entra. Si NO entra, el docblock de `sim-collision.ts:3-10` deja
  de decir “idéntico” y declara los 6.002 pasos de 26.064 en que divergen; si entra, `collision.ts:104-105` compone el mismo
  `ocupado` y hay guion de jugador en la configuración doble.»**
- Criterio 3 → **«`salida-del-solido` TIENE base (corrida `35354800866`, blob de HEAD, 100 mutantes, 13 vivos, `break` 87 al
  límite): `local` lo acepta, pero solo mide lo que se mueva a core. Si la regla nueva vive en el bridge, la medida es el
  guion, y se dice.»** Añadir: **«La tabla de coste de `sim-collision.ts:33-45` se re-mide con el cambio puesto.»**
- Fuera de alcance, añadir: **«El caso caja–caja (dos cajas encajadas) no se puebla ni se afirma: el guion pone una caja por
  edificio.»**
