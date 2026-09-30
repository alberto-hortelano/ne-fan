# Tanda BV — Las cercas finas no se atraviesan (#788)

## Petición literal del usuario (2026-09-30)

> «sigue con #788 y prepara una demo para que la pruebe yo. Como si presentaras el estado del producto, con que funciona y que no. Pruebalo tu primero y luego me dices exactamente que hacer y que probar»

Esta tanda cubre la parte de #788. El coordinador prepara la demo por separado.

## El issue

#788: `markBand` (`nefan-core/src/scene/blueprint/collision.ts`) marca una celda como sólida solo si su CENTRO cae dentro de la banda del muro. Un muro de `width` < 1 celda puede dejar huecos. El issue pedía comprobar primero si el jugador cruza de verdad el hueco, porque solo se había medido con un relleno 4-conexo de la rejilla.

## Lo que midió el coordinador (hoy, sobre `main` 3d0b30b3)

Script: `medir-788.ts`, en esta misma carpeta. No se commitea: es material de la tanda.

Método:
- Anillos cerrados (cuadrados de 10–16 celdas de lado, rotados al azar o alineados a los ejes) pasan por `volumeCollisionGrid` → `createTerrainCollider`.
- BFS en una rejilla fina de 0,05 m sobre posiciones donde `blocksCircle(x, z, r)` es falso: el mismo predicado que usa el cliente.
- La pregunta es si el cuerpo sale desde el centro hasta fuera del anillo.

| width (celdas) | orientación | escapa el jugador (r 0,4) | escapa el NPC (r 0,5) |
|---|---|---|---|
| 0.2 | eje / diag | 29/29 · 57/57 | 29/29 · 56/57 (11 y 2 anillos no marcan NI UNA celda) |
| 0.5 | eje / diag | 26/28 · 45/58 | 26/28 · 26/58 |
| 0.8 | eje / diag | 14/29 · 15/57 | 14/29 · 4/57 |
| 0.9 | eje / diag | 6/29 · 4/57 | 6/29 · 2/57 |
| 0.95 | eje / diag | 2/28 · 1/58 | 2/28 · 0/58 |
| 1.0 | eje / diag | 0/28 · 0/57 | 0 · 0 |
| 1.2 | eje / diag | 0 · 0 | 0 · 0 |

Conclusiones:
- **El jugador CRUZA de verdad.** Lo que falla es la colisión, no el validador.
- **Es más ancho que el issue.** No hace falta la diagonal: un muro fino alineado a un eje, con el eje sobre una frontera de celdas, no marca ninguna fila, porque ningún centro cae dentro de la banda. Con `width` 0.2 hay anillos que no marcan ni una celda.
- El contrato (`src/scene/blueprint/volumes.ts`, tipo `wall`) admite `width: z.number().positive()`: cualquier grosor mayor que 0.
- En los datos commiteados y en los runs de labs, el motor usa hoy `width` 1 (126 veces), 2 (33) y 5 (23). Ninguno está por debajo de 1, así que no lo ha disparado aún. Pero el contrato lo permite, y una cerca o una empalizada fina es justo lo que el motor declararía.

## Qué se pide

1. Que un muro de cualquier `width` válido bloquee al jugador y al NPC en cualquier orientación. El criterio es el cuerpo andando con `blocksCircle`, no un relleno de la rejilla.
2. Render ≠ colisión (memoria del usuario): se puede engordar la COLISIÓN sin tocar lo que se pinta. La relación entre las dos se escribe en un test; no se fuerza la igualdad.
3. Nada de lo que hoy bloquea deja de bloquear (monotonía: el conjunto de celdas sólidas solo crece). Que cambien muros de `width` ≥ 1 en diagonal o con coordenadas fraccionarias está ACEPTADO (crítica, punto 3): se mide el cambio sobre las escenas reales (fixtures + runs de labs) y se reporta, sin inventar una regla para finos y otra para gruesos que haga el cambio cero.
4. Hay que respetar #787: el muro acaba donde se ve acabar. Nada de tapas más allá de las puntas libres.
5. Un test que ande: el mismo criterio que el script, reducido y determinista, y que se ponga rojo contra el `markBand` de hoy.
6. Las puertas (`gate`) y `clearGatePassage` siguen abriendo su vano en un muro fino.
7. (Crítica, punto 4) `markRotRect`, `markPolygon` y `markDisc` tienen el mismo agujero —marcan por centro de celda y el contrato admite lados/radios < 0,5 celda—. Se arreglan con el MISMO criterio en esta tanda (el coordinador lo decide: es la misma función de muestreo), con su test de paso cada uno.

## Fuera de alcance

- La demo del producto la hace el coordinador.
- Los plugins #361, #362 y #363 siguen aparcados.

## Restricciones de la sesión

- NUNCA `git stash`.
- No matar servidores ajenos.
- No tocar el tag `mutacion-ultima` ni `reports/mutation/` del árbol principal.
- `bateria-n.log` en la raíz del árbol principal es de otra sesión.
- Se trabaja en el worktree `/home/al/code/ne-fan-tanda-bv` (rama `tanda-bv-cercas-finas`).
