# Tanda BL — #618

## Petición del usuario (literal)

> «Sigue cerrando todos los issues que puedas de forma autónoma. El objetivo es reducirlos al mínimo» (2026-09-24). El 2026-09-29, preguntado por los paraguas #613 y #618, eligió «Crítico primero»: el crítico dice qué parte se puede hacer ya y cuánto cuesta, y el usuario decide con eso delante.

## El issue #618

> Sale de la QA de la PR 2 de la tanda E (#583) y de la investigación que pidió el coordinador antes de dárselo al usuario como decisión. 2026-09-16.
> 
> ## El hecho
> 
> `stepTowards` sondea **siete rumbos hacia su meta** (deflexión, con `TODO(A*)` declarado en el código) y, si ninguno pasa, cae a `idle`. No hay búsqueda de camino: un obstáculo que exija apartarse del rumbo más de esos siete ángulos **no se rodea nunca**. Un aldeano con `goto_place` al otro lado de un granero se planta delante y se queda.
> 
> ## Lo que NO es, y se midió para poder descartarlo
> 
> La primera medida parecía una **asimetría entre fuentes**: el mismo obstáculo de 6 m se rodeaba a los ~296 s puesto por el **tile** y nunca puesto por **runtime**. Habría sido el defecto de #583 en espejo, así que se midió antes de escribirlo:
> 
> 1. Los siete rumbos sondeados a mano en el punto de parada dan **el mismo veredicto contra las dos fuentes**: 0/±45 bloquea, ±90/±135 libres.
> 2. La diferencia estaba en **dónde estaba el obstáculo**, no en de quién era: `cell` es la **esquina** de la huella, así que `footprint [12,12]` en `cell [64,64]` tiene su centro en **(3, 3)** y no en (0.25, 0.25). El NPC esquivaba ese cajón rozando su esquina sur, a 25 cm de su camino.
> 3. Experimento cruzado {fuente} × {posición}, 300 s: centro (3,3) → **tile 8.30 · runtime 8.30**; centro (0.25,0.25) → **tile −3.00 · runtime −3.25** (la diferencia son los 0,5 m de la rejilla).
> 
> **Conclusión: las dos fuentes se comportan igual.** Es el `TODO(A*)` genérico, y ya afectaba al terreno sólido desde #232 — un NPC lleva plantándose delante de los edificios del pueblo desde entonces.
> 
> ## Por qué ahora
> 
> #583 no lo introduce: lo hace **visible en un sitio más**. Antes el NPC cruzaba el carro del motor —eso era el defecto— y ahora se planta delante, como hace con las casas. El mundo pasa a ser sólido para él, y con eso el hueco del steering deja de estar tapado por un fallo de colisión.
> 
> Para quien juega, un NPC clavado delante de un carro se lee como un NPC roto. Es el precio conocido de la decisión «el NPC atraviesa solo cuando no puede rodear» (tanda E, decisión 3): el escape existe para el **cercado de verdad** y no se abre cuando quedan rumbos legales, que es justo este caso.
> 
> ## Lo que sí se resolvió en #583, para no confundirlo con esto
> 
> Al NPC al que le **cae una caja encima** ahora se le saca: el adapter contesta **por dónde** se sale (`porDondeSalirDeAqui`), compartiendo cuenta con `penetracionEnCaja`. Medido: de «290 s de 300 dentro» a **salir en 2,5 s**; con la huella máxima del contrato (64 m), 27,3 s. Eso era un estado sin salida y está cerrado. Lo de este issue es otra cosa: el NPC que **puede** moverse pero no sabe por dónde ir.
> 
> ## Dónde vive
> 
> `nefan-core/src/simulation/npc-behavior.ts` (`stepTowards`, los siete ángulos, `giveUpMove`), hoy en `sin_mutar`: **la mutación no mide nada de esto**.
> 
> Relacionado: #583, #232, #616 (el jugador tiene su propia versión del problema: dentro de un edificio del plan no sale).
> 
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
> 
> https://claude.ai/code/session_01XKRRYRsJWigoMEY4CL27ew

## Comentarios del issue

> Nota medida de la QA de la PR 2 de #583 (2026-09-16), hermana de lo que este issue describe pero por otro camino — **y no es regresión**.
> 
> **Al NPC que no va a ningún sitio la salida no le alcanza si la caja es más ancha que su paseo.** `porDondeSalirDeAqui` vive dentro de `stepTowards`, y el que solo hace micro-wander depende antes de `randomWaypoint`, que descarta sus 8 candidatos por `blocksCircle` — y desde #583 una caja de runtime los ocupa.
> 
> Umbral medido: **media huella + radio > `wander_radius`**.
> 
> | rol | `wander_radius` | sale | atrapado |
> |---|---|---|---|
> | campesino | 5 m | granero de 8 m | granero de 10 m |
> | villager | — | 10 m | 20 m |
> 
> El caso corriente no llega: el defecto de clase `building` son 4 m, muy por debajo del umbral.
> 
> **Por qué es menor y no bloquea**: medido el contrafactual, antes de #583 tampoco salía en esos casos — paseaba 4,5 m **dentro** de una huella de 5,5. El cambio es «se mueve dentro» → «se queda quieto dentro». Los dos casos hermanos (un NPC en `hold` y uno que ya llegó a su meta) tampoco salen, e **idénticos antes de #583**.
> 
> Queda registrado como `⚠ HALLAZGO` con su número en `qa/el-mundo-solido-tambien-para-el-npc.mjs`, que ya corre en el job `candados-headless`.
> **Aparcado como `futuro` el 2026-09-17**, con la decisión del usuario y por argumento, no por la etiqueta.
> 
> **Es el gemelo de #298**: mismo fichero (`npc-behavior.ts`), misma forma (ciclo límite del steering), la
> misma frase en el cuerpo («se lee como que el juego está roto») y etiquetas opuestas hasta hoy. #298 se
> aparcó el 2026-09-02 porque termina en una pregunta de diseño —qué pathfinding tiene el juego— y este
> termina en la misma. Se retoman juntos, con #364, cuando el movimiento sea plugin.
> 
> **Lo que se midió antes de aparcarlo, para que al retomarlo no se empiece de cero** (sonda con el cableado
> de producción, `createSimCollisionProvider` + `createSessionNpcBehavior`, sobre `54c7a70c`):
> 
> - **No hay umbral de tamaño.** Cajón de **1, 2, 3, 4, 6, 10, 14 y 20 m → 0 llegadas** en 120 s. Un cajón de
>   1 m es un `prop` de `footprint [2,2]`: un pozo, un yunque, un roble.
> - **No es falta de alcance del abanico, y esto descarta la solución barata.** Con el NPC desviado 0 · 0,25 ·
>   0,5 · 1 · 2 · 3 · 4 · 5 m del eje de un cajón de 6 m → **0 llegadas**. Los siete rumbos ya cubren ±135°.
>   Ampliarlos es trabajo inútil: se dice aquí para que nadie lo intente.
> - **El observable que escribe este issue es falso.** El NPC **no «se planta»** ni cae a `idle`: en 60 s anda
>   **68 m de camino** para acabar a **1,5 m**, oscilando ±0,8 m, con el watchdog rindiéndose **14-16 veces**.
>   Lo que ve quien juega es un NPC **pisando en el sitio con la animación de andar puesta** — 113 s de 120
>   pegado a la cara del cajón, 135 m andados. El título de arriba se queda como está por trazabilidad, pero
>   el síntoma real es este.
> - **Frecuencia acotada**: solo le pasa al que tiene **directiva persistente**. `goto_place` se queda pegado;
>   **`wander` se cura solo** (0 s pegado, 51 m de paseo real); `hold` no se mueve.
> 
> **Lo que NO es**, y se midió para poder descartarlo: no es la pieza que le falta a #616. `salidaDeCaja` /
> `porDondeSalirDeAqui` contestan «por dónde salgo de DENTRO», y este NPC **no está dentro de nada** —
> `npc-behavior.ts:670` lo llama en cada tick y devuelve `null` siempre. Extender la consulta de PUNTO al
> terreno (que es lo que hace la tanda G) no le da a este issue ni un metro.
> 
> Detalle completo en `docs/agents/2026-09-17-nadie-se-queda-encerrado/critica.md`.
> 
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
> 
> https://claude.ai/code/session_01XKRRYRsJWigoMEY4CL27ew
> 
> Se fusiona aquí #298 («El NPC que huye vuelve a la pelea cada 10 s: la huida no actualiza su 'home'»), por triaje del 2026-09-24. Su cuerpo sigue en #298 como referencia, y la evidencia de hoy está en el triaje: #298 sigue vigente como parte de este paraguas.
> Se fusiona aquí #646 («Al NPC se le sigue mandando al centro del anchor.rect: llega al macizo y empuja la pared (el jugador ya no)»), por triaje del 2026-09-24. Su cuerpo sigue en #646 como referencia, y la evidencia de hoy está en el triaje: #646 sigue vigente como parte de este paraguas.

## Restricciones del coordinador

- Es un paraguas (fusiona issues anteriores): el crítico lo parte en piezas y da un veredicto por pieza, con su coste estimado (ficheros y módulos, y si es observable por el jugador).
- Todos los agentes en Opus. Worktree /home/al/code/ne-fan-tanda-bl, rama feature/tanda-bl.
- Rango de guiones reservado: 250–259.

## Alcance decidido por el coordinador tras la crítica (2026-09-29)

Solo la pieza **B** de critica.md, más la mitad de **D** que la alimenta:
- Un NPC que está dentro de un sólido sale también cuando no camina (quieto, en `hold` o recién llegado).
- `npc_arrive` no deja al NPC dentro de un sólido.

La PR cita #618 sin cerrarlo. A (pathfinding) y C (#298, la huida) están pendientes de decisión del usuario y quedan fuera.

### Ampliación del 2026-09-29: entra la pieza C (#298)

El usuario decidió C, textual: «Se queda donde paró (Recomendado)». Criterio:
- Al terminar la huida, el `home` del NPC pasa a ser el punto donde se detuvo, y deja de volver a la pelea cada 10 s (con una pelea que sigue en el mismo sitio, huye UNA vez y no vuelve a entrar en su radio de percepción).

La pieza A (A\*) va en otra tanda (BO), que se hará DESPUÉS de BL sobre `npc-behavior.ts`: BL no la diseña, pero no le cierra caminos.
