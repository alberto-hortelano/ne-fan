# QA — Tanda BQ: la decisión fuera de tres `main` de herramientas

Rama `feature/tanda-bq` @ f1d1f8a9, sobre `origin/main` 0afb76c3. Lo que manda es la sección reencuadrada de `requisitos.md` más la decisión del coordinador: un `--top` inválido o un posicional suelto es error con salida 2.

Quien usa esto es **el coordinador** (`npm run deuda`, `npm run afectado`, la purga del índice a mano) y **CI** (`crap -- --scripts --check`, `ejercicio`, `run.mjs --sin-navegador`). No hay jugador ni preset de `start.sh`, así que la QA visual no aplica.

**Cómo medí.** Monté dos worktrees propios en el scratchpad, sin usar `git stash`:
- `qa-base`, sobre 0afb76c3, con `npm ci`, `build` y `coverage` propios: 3873/3873.
- `qa-rama`, sobre f1d1f8a9, con `coverage` propio: 3891/3891. Los sabotajes los hice aquí.

No toqué el tag, `reports/mutation/`, el árbol principal ni procesos ajenos. El único proceso que maté fue mi asset-store de prueba, y antes comprobé que era mío por su `cwd` y su `NEFAN_MANIFEST_DB`.

## Criterios

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | `npm run deuda` dice lo mismo que antes | ✅ | **Con la misma entrada:** pasé el `--json` de la BASE por `cabeceraDe` + `planDeImpresion` + `redactarCola` de la RAMA. `cmp` da idéntico con texto y md a `--top` 12, 3 y 100 (texto 122/56/300 líneas, md 85/55/171, con 2/4/0 «…y N más» y los 4 avisos «⚠️»). **De punta a punta** (base contra rama, cada una con su cobertura): el `.rc` y el `.err` son idénticos en 8 combinaciones de argv. El `--json` solo cambia en el bloque Scripts, que pasa de 42 a 41 items, y los demás bloques tienen los mismos items, `fuente` y `aviso`. En los dos lados `--json --md` da lo mismo que `--json`. Única diferencia fuera de Scripts: `formatDToWorld` sale con cobertura 99 % en la base y 100 % en la rama. Es ruido de cobertura: la rama no toca `scene-normalize.ts` |
| 2 | `--top` inválido o posicional suelto → salida 2 | ✅ | Probé `--top 0`, `5`, `--top=5`, `--top` sin valor, `--top 1e2` y `--top 012`. Todas salen con **rc=2**, con `deuda: …` y la línea de uso por stderr y nada por stdout. `npm run deuda -- --top 0` → rc 2. Guion 300 (g) |
| 3 | La purga respeta el orden de guardias (blobs > store > DB) de punta a punta | ✅ | Corrí el CLI real en 11 escenarios, en base y en rama. Para (b), (c) y (h) levanté un **asset-store REAL** en el offset 2300 (:11067) con `NEFAN_MANIFEST_DB` temporal. Salvo el escenario K (hallazgo M1), stdout, stderr y rc son **idénticos** entre base y rama, y la DB queda byte a byte igual en todos menos en el `--ejecutar` feliz. Blobs+store+DB → `mv` y rc 1, sin mencionar el store. Store+DB → «hay un asset-store respondiendo en http://127.0.0.1:11067», rc 1. Store sin DB → manda el store. Store parado sin DB → «no existe», y la DB no se crea |
| 4 | Sondear siempre el store no tiene efecto | ✅ | Con blobs sobrantes, el store arriba y `--ejecutar`, el stderr sale idéntico al de la base y la DB intacta. El sondeo es un GET a `/health` de 1 s como mucho, y el veredicto no cambia (8 combinaciones en unitario y los casos a/e del guion) |
| 5 | `npm run ejercicio` conserva su defensa contra el falso negativo | ✅ | En la rama: «111 fichero(s) mutado(s) en 71 batería(s)… Todas las baterías EJERCEN». Sabotajes de `coberturaDe`: con **solo el último volcado**, el gate se pone ROJO (`src/contracts/asset-store.ts … SOLO CARGADO`), así que la fusión sigue cableada y lo que decide es el `>`. Con cero volcados → ROJO («SIN CARGAR»). Con **solo el primer volcado** sale verde, porque en esta máquina el primer volcado ya basta. Eso lo tapa el unitario «gana el de más llamadas en los dos órdenes», no el gate |
| 6 | CI quedará verde | ✅ (local) / ⚠️ (CI) | En `qa-rama` con cobertura fresca: `crap -- --check` ✔ (95,86 %), `crap -- --scripts --check` ✔ (2 congeladas, 0 por encima; 82,91 % ≥ 80,7), `--apretar` sin nada que apretar, `typecheck:scripts`/`:tests` y `lint` a 0. En el worktree de la tanda con el guion 300 dentro, `npm test` da 3891/3891 y `lint` sale 0. El CI real no lo he visto, porque la rama no tiene PR |
| 7 | Ningún fichero tocado es instrumento de mutación | ✅ | Según `instrumentoDeMedida()`, el instrumento son 15 ficheros (`afectado`, `crap-score`, `mutacion-*`, `mutate`, …) y no incluye `deuda.ts`, `ejercicio-de-bateria.ts` ni `manifest-kinds-con-productor.ts`. `npm run afectado`: «HABRÍA QUE MEDIR 1 de 71 módulos: asset-store-contrato», sin `todos`. Ese módulo muta `src/contracts/asset-store.ts`, que no cambia: lo único que crece es su batería |
| 8 | Las dos congeladas salen con `--apretar` y quedan dos | ✅ | Diff de `scripts-crap.json`: quedan `afectado.ts imprime` (110) y `salud-sprite-forge.ts main` (90). En la cola, `manifest main` cae a la línea 314 y `deuda main` a la 695, los dos con CRAP ≤ 20 |
| 9 | Suelo de cobertura re-medido con la cifra de CI | ⚠️ no probado | Sigue en 80,7 porque falta la cifra de CI de la PR. Tiene 2,21 puntos de margen, así que no es riesgo de rojo; es trabajo pendiente del coordinador |

## Pasada adversarial sobre los negativos del ingeniero

Repetí sus sabotajes y añadí los míos en `qa-rama`, uno por vez y restaurando después, sobre los tres ficheros de test:

| Sabotaje | `npm test` |
|---|---|
| store solo si hay DB · `mv`→`rm -rf` · un solo `mv` · dry-run con filas sale 1 · md manda sobre json · `resto` mal · fusión «gana el último» · `--top` acepta 0 | ROJO |
| **S1** abrir `new ManifestDb` ANTES del veredicto (el constructor CREA la DB) | **verde** |
| **S2** `medirHechos` con `storeArriba: false` fijo | **verde** |
| **S3** `medirHechos` con `sobrantes: []` fijo | **verde** |
| **S7** `deuda` con un argv malo sale 0 | **verde** |
| S8 texto sin «(--top N)» | verde (esperado: la redacción no se afirma, por decisión) |
| S12 `coberturaDe` lee solo el primer volcado | verde (ver criterio 5) |

Los negativos del ingeniero son ciertos, pero **solo cubren la función pura**. Lo que de verdad protege el material pagado es el CABLEADO que mide los hechos y abre la DB después del veredicto, y eso no lo veía nadie: S1–S3 salían verdes. Por eso dejo el **guion 300**.

## Guion

`qa/guiones/300-la-purga-del-indice-no-toca-la-db-sin-veredicto-verde.mjs` (`sinNavegador`, así que lo corre CI en `node qa/run.mjs --sin-navegador`; tarda unos 8 s).

- **Qué hace:** conduce el CLI de purga por subproceso sobre un temporal. El «store» es un `/health` de juguete en un puerto efímero, que el script encuentra por `NEFAN_URL_ASSET_STORE`, así que no pisa el catálogo de puertos.
- **Qué afirma:** en 6 casos, el rc, qué guardia habló (y cuál no) y que la DB no cambia o no se crea. También afirma `deuda --top 0` / `deuda 5` → 2.
- **Salida real en la rama:** `✔ 300-… · 1 en verde · 0 en rojo`, con las 8 afirmaciones en ✔.
- **En negativo** (`qa-rama` saboteada):
  - S1 → ROJO en c y d.
  - S2 → ROJO en b y c.
  - S3 → ROJO en a y e.
  - Blobs cediendo ante el store → ROJO en a.
  - S7 → ROJO en las dos g.
  - Sin sabotaje → verde.
- **Contra la base** 0afb76c3: a–f verdes, porque la conducta de la purga se conserva, y las g rojas, porque salir con 2 es conducta nueva.
- **Tropiezo propio, corregido:** con `spawnSync`, el `/health` de juguete no contestaba porque vive en el mismo proceso, y el caso (b) veía un store parado. Ahora es asíncrono y la cabecera lo explica.
- **Falta su fila en `qa/README.md`**: no la escribí.

## Hallazgos

- **M1 (menor).** Con un `NEFAN_PORT_OFFSET` inválido, la purga cambia de mensaje.
  - Reproducción: `NEFAN_PORT_OFFSET=150 npx tsx scripts/manifest-kinds-con-productor.ts --cache <dir con textures/> …`.
  - Base: rc 1 con las líneas `mv …`.
  - Rama: rc 1 con la **traza de pila** de `service-registry.ts:101` («NEFAN_PORT_OFFSET inválido»).
  - Causa: `resolveServiceUrl` se llama ahora antes que la guardia de blobs, en `rutasDeCli(…)`.
  - Qué no cambia: la DB queda intacta y el código de salida es el mismo. Solo cambia qué error se ve primero, y ahora es una traza en vez de un mensaje. La implementación no lo declara.
- **M2 (menor).** `deuda --top 012` dice «necesita un entero positivo (llegó «012»)». Es un entero positivo con cero a la izquierda; el mensaje es algo inexacto, pero el rechazo es coherente con el fail-loud.
- **M3 (menor, ya declarado).** Los `main` y `medirHechos` siguen a cobertura 0, como asume la opción B. El guion 300 cierra la parte de ese hueco que protege material pagado.

No hay hallazgos bloqueantes ni importantes.

## Workarounds usados

- **Store de juguete en el guion** (http en puerto efímero con `NEFAN_URL_ASSET_STORE`) en vez del asset-store real. Es un override que el propio script admite. A mano lo contrasté con un asset-store REAL en el offset 2300 con DB temporal y el veredicto fue el mismo.
- **`--db`/`--cache`/`--archivo` a un temporal.** Son las flags del CLI, así que no hay estado sintético oculto.
- **`qa-rama` enlaza `node_modules` y `narrative-mcp/{dist,node_modules}` del worktree de la tanda.** Solo afecta a dónde se instala, no a la conducta.

## No probado

- El CI real de la PR (no hay PR) y, con él, la cifra con la que apretar `suelo_cobertura.min`.
- La purga `--ejecutar` sobre el índice REAL del checkout: a propósito, porque es material pagado.

## Veredicto

**Apto con reservas.** Las reservas son tres: M1, añadir el guion 300 a la PR con su fila en el README, y apretar el suelo con la cifra de CI.
