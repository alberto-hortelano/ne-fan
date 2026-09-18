# Tanda P — «La simulación pregunta bien y no se cuelga» (#658 + #662)

## La petición, literal

Mandato vigente del usuario (2026-09-17, sigue en pie):

> «Hay 48 issues abiertos, ve cerrando sin parar, si tienes bloqueo en alguno lo apuntas pero sigue
> hasta reducir el numero al minimo»

Y hoy, 2026-09-18, al reanudar:

> «Seguimos, ya ha acabado la mutacion»

Decisión del usuario para HOY: **ciclo completo con fase de QA** (ayer se saltó por velocidad y quedó
declarado como desviación).

## Estado medido al abrir

- `main` = `900b5b71`, árbol limpio.
- Batería: **145 verde · 0 rojo · 1 ⊘ de 146** (el ⊘ es el 97, sano por diseño).
- `salida-del-solido.ts` tiene suelo de mutación **87** desde la corrida `35253899611` (11 vivos de 90,
  87,78 %). De sus supervivientes, **3 son equivalentes por estructura** (0 de 379.080 fallbacks con
  `dir.z ≠ 0`), medido en la tanda I.
- Corrida `35317748262` EN VUELO sobre `900b5b71`. **Toca `nefan-core/src/simulation/` con cuidado**:
  fusionar un cambio en un fichero que la corrida está midiendo lo devuelve «base de otro código» al
  repartir. No bloquea el trabajo; bloquea la FUSIÓN hasta que el coordinador reparta. El coordinador
  avisará.

## Los dos issues

### #658 — `marchaPorEje` puede dejar de avanzar y colgar el tick del bridge

Del plan de arquitectura de la tanda I (2026-09-17) y **medido**:

- `marchaPorEje` (`nefan-core/src/simulation/salida-del-solido.ts`) avanza con un `for(;;)` que solo sale
  por punto libre o por tope, con pasos `f += signo * TILE_MPC`. En coordenadas grandes la suma **deja de
  avanzar** (el incremento se pierde en la precisión del flotante) y el bucle no termina. Corre en el
  tick del bridge, así que **el tick se cuelga**.
- El fail-loud de «dejó de haber progreso» está **una capa más arriba**, en `sitioParaAparecer` (`:262`),
  que corta cuando `siguiente === p`: medido, se dispara **0 de 138.048 veces**. El guardia está donde no
  pasa nunca.
- Hoy lo único que delata el problema es un mutante que sale `Timeout` en la corrida de mutación: una
  señal **prestada**, no un candado.

Lo que pide el issue: el guardia **en el bucle**, no encima — si un paso no cambia `f`, no hay progreso y
se sale fail-loud. Misma forma que el épsilon de desempate de #616, donde 467 puntos elegían el eje
contrario por medio ulp.

De propina, del mismo análisis: **9 de los 11 mutantes equivalentes del módulo los hospedan tres piezas
degeneradas** — el ternario muerto de `fronteraSiguiente`/`fronteraAnterior` (`Math.floor(v/0.5)*0.5 ≤ v`
es exacto, una rama no se alcanza) y el `punto: {x,z} | null` de `SalidaMedida`, que pide unión
discriminada. **Verificar esa cuenta antes de usarla**: el número sale del plan de otra tanda.

### #662 — quedan 29 consultas de movimiento usadas como consultas de punto

Medido tras la PR #661: **29 sitios de llamada a `window.__nefan.probeCollide` en 16 guiones**.
`probeCollide` es consulta de MOVIMIENTO («¿puedo ir de donde estoy a ahí?») y depende de dónde esté el
jugador vivo; desde #644 existe `probePoint` para preguntar por el punto.

El caso que mejor lo enseña, porque lo admite por escrito —
`qa/guiones/134-la-esquina-del-edificio-no-se-corta.mjs:89`:

```js
const MIRADOR = { x: 28, z: 28 };  // Dónde se aparca al jugador para que
                                   // `probeCollide` conteste como consulta de PUNTO
```

**No todos los 29 son defectos, y confundirlos sería el error en espejo.** Los que el issue declara
legítimos y NO se tocan: `qa/guiones/119-…:342` (`caminoALaBolsa`, donde el origen vivo ES el sujeto),
`state().blocked` del hook (`nefan-hook.ts:213`, los cuatro rumbos a 0,5 m desde el jugador), y los
guiones **14** y **73**, que miden movimiento a propósito.

Criterio de cierre: cada uno de los 29 clasificado como **punto** (migrado a `probePoint`) o
**movimiento** (declarado, con el motivo escrito en el guion), y el mirador del 134 retirado si sus
sondas pasan a ser consultas de punto. **Sin clasificar «por mayoría»**: la lección de #644 es que los
dos tipos de consulta coinciden cuando el origen está libre, así que un barrido que solo mire orígenes
libres **no distingue una de otra**.

## Por qué juntos

Los dos son «la simulación pregunta bien»: uno es el bucle que responde y el otro son los sitios que
preguntan. Comparten el módulo `salida-del-solido.ts` y la familia de #644/#616. **El crítico debe
verificar esta premisa**: la última vez que junté dos issues por «comparten la pieza que falta» (#616 +
#618, tanda G) la premisa era falsa y la tumbó la crítica con medida.

## Restricciones de la casa que aplican aquí

- Cero créditos.
- Nunca `--parar-todo` ni `pkill` ni matar por puerto. Solo `NEFAN_PORT_OFFSET=<n> ./start.sh --parar`
  desde el propio worktree.
- Ningún umbral se baja ni se sube para acomodar lo que creció.
- Cada candidato de #662 **cuesta una corrida del guion** para comprobar que sigue verde tras migrarlo:
  los tres de #651 se re-corrieron dos veces cada uno. Presupuestar eso.
- El cliente NUNCA porta la conversión celdas→metros ni copia física a mano: lo que sea política va a
  core (`aabbOcupa`, `algunaCajaAplicable`), como se hizo en #644.
