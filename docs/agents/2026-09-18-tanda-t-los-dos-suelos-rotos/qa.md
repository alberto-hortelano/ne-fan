# QA — Tanda T: los dos suelos rotos (#675 + #676)

Verificado el 2026-09-20 sobre `feature/tanda-t-los-dos-suelos-rotos` = `cffef462` (worktree
`/home/al/code/ne-fan-tanda-t-los-dos-suelos-rotos`). El árbol estaba LIMPIO al empezar (`git status --short`
vacío): nada que revertir de la QA anterior. Informes de la corrida `35354800866` leídos de
`/home/al/code/ne-fan/nefan-core/reports/mutation/` (solo lectura); sus blobs casan con los fuentes de esta rama
(`place-target.ts` = `02cffcbf`, `dispatch.ts` = `aa1632d2`, comprobado con `git hash-object`).

Criterio 1 = el reencuadre del crítico (sustituye al original). Sin stack ni batería de navegador, por diseño de la
tanda: nada de esto lo ve el jugador. Ningún workaround: no hubo que ocultar, forzar ni stubear nada.

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| 1a. `place-target.ts`: tests sobre las tres vías del docblock y los dos `null`, fixture en tile `tx≠0, ty≠0`; objetivo 18, mínimo 9 | ✅ cumple (17 de 18; el 18.º es equivalente) | Seis `it` en `test/npc-director.test.ts:143-191`, uno por regla del docblock ((a) rect, (b) anchor sin rect, (c) escena realizada tile, null por escena no-tile, null por place inexistente) más precedencia anchor > escena; tile (2,−3), centro (128, −192). **Muestra verificada por mí, los 18** (guion propio: aplicar por línea:columna del informe → `node --import tsx --test test/npc-director.test.ts` → `git checkout --`): 118 122 134 135 136 137 138 140 141 142 143 144 145 146 147 148 149 → **ROJO**; 139 → **verde** (equivalente, ver abajo). Fuentes limpios tras cada paso (`git status --porcelain src bridge` vacío) |
| 1b. `dispatch.ts`: todo `no_session` (404 y 409) nombra las dos causas; mata `134:9-134:97`; el 409 deja de depender del salto de línea | ✅ cumple | `CAUSAS_NO_SESSION` en `test/state-http-dispatch.test.ts:86`, afirmada en el 409 (`:634`), en las 12 `rebotadas` del bucle con censo `declaradas.length === 12` (`:709-711`, aserto en la 710), en el bucle 404 con censo «exactamente CUATRO» (`:776`) y en un `it` propio (`:781`). Mutante **50** (vaciar la 134) → ROJO, 2 tests. **Gemelo de la 114 quitando SOLO el paréntesis de causas** (dejando «No se ha aplicado nada» intacto) → ROJO, 3 tests, primer fallo `did not match /\(ni start_session ni resume_session…/`. Solo hay DOS emisores de `no_session` en `src`+`bridge` (`grep`: `dispatch.ts:113,133`), así que «todo `no_session`» no afirma más de lo que sujeta |
| 1b-adversarial. ¿Sobrevive la regla a un reflow de la frase? | ✅ cumple | Reescritos los literales del 409 (A) y del 404 (C) en UNA línea con la misma cadena en runtime → 51/51 verde. Mismo reflow + sin causas (B, D) → ROJO por la regex de causas. Una sola causa en el 404 (F) → ROJO. 409 con causas pero sin «No se ha aplicado nada» (G) → ROJO por el OTRO aserto: los dos sujetan cosas distintas e independientes |
| 2. Ningún `break` baja, `tope_local` no sube; demostración a mano; corrida pedida sin esperarla | ✅ cumple / ⚠️ la petición en la PR está pendiente | `git diff main --stat`: solo `test/npc-director.test.ts` (+51), `test/state-http-dispatch.test.ts` (+29) y los dos `.md` de la tarea; `mutation-targets.json` intacto (`npc-director` break 81, `state-http-dispatch` break 100, `tope_local` 120). Demostración a mano: la mía, arriba (no reutilicé el guion del ingeniero). `gh pr list --head feature/tanda-t-los-dos-suelos-rotos` → vacío: la corrida está pedida en `implementacion.md` (efímero) y aún no en una PR |
| 3. `verify`, `ejercicio`, cobertura y CRAP sin empeorar | ✅ cumple | Corrido por mí en el árbol limpio: `npm run verify` → `tests 3124 · pass 3124 · fail 0`; `npm run ejercicio -- npc-director state-http-dispatch` → «4 fichero(s) mutado(s) en 2 batería(s)… Todas las baterías EJERCEN»; `npm run ejercicio` → «99 fichero(s) en 65 batería(s)… EJERCEN»; `npm run coverage && npm run crap -- --check` → «cobertura 95.98 % · CRAP ≤ 73 — 0 por encima · ✔ dentro de los umbrales». `place-target.ts` en lcov: `BRH 12/12`, `FNH 1/1`, `LH 31/39` (las 8 sin cubrir son docblock, import y firma). La rama solo AÑADE tests, así que la cobertura no puede haber bajado; no volví a medir `main` |
| 4. El informe dice con qué mutantes se comprobó el rojo | ✅ cumple, con una imprecisión menor | Tabla de 20 pasos en `implementacion.md` con id, sustitución y test en rojo; mi corrida independiente reproduce los 20 veredictos (17 rojos + 1 verde + 50 + gemelo). Imprecisión: dice que 118 y 142 mueren «por lanzamiento»; **122 también** (`TypeError: r is not iterable`), no lo nombra |

## Pasada adversarial

**¿Matan por VALOR o solo por lanzamiento?** Por excepción (`TypeError`), no por aserto de valor: **118**
(`Cannot read properties of undefined (reading 'anchor')`), **122** (`r is not iterable`) y **142** (`Cannot read
properties of null (reading 'tx')`). Los otros 14 mueren por `AssertionError` de `deepEqual` contra el punto exacto.
Consecuencia: si el fuente añadiera un `?.` en la 18 (`place?.anchor`), el 118 pasaría a equivalente sin que ningún
test se pusiera rojo. Hoy es correcto y el docblock lo explica; el plan (§8) decidió a sabiendas no inventar asertos
sobre excepciones. Se declara, no se bloquea.

**¿Alguno muere por accidente de la fixture y no por la regla?** No. Los ocho aritméticos (135-138, 146-149) mueren
porque el tile es (2,−3) y no (0,0): eso no es un accidente, es la condición que el propio criterio impone
(`tx≠0, ty≠0`), y está escrita en el comentario del test con el porqué. Los `{}`/`false` de bloque y retorno mueren
por el valor que la regla predice. Los tres por excepción, arriba.

**¿La regla 404/409 sobrevive a un reflow?** Sí al reflow del FUENTE (misma cadena → verde, A y C). No a un
reword de la FRASE: quitar la coma de «han corrido, o el save» (E) pone 4 tests en rojo. `CAUSAS_NO_SESSION` afirma
la frase literal, no «dos causas» en abstracto; un cambio de redacción deliberado obliga a tocar la constante. El plan
lo eligió (no relajar a `/start_session/`) y lo justifica. Observación, no hallazgo.

**Equivalente 139** (`31:7-31:30` → `if (true)`): verde con mi guion, y el porqué se lee en el fuente:
`parseTileKey` (`src/scene/tile.ts:90-94`) hace `/^tile_…$/.exec(key)` sin comprobar tipo, así que con
`realized_scene_id` `undefined` o `""` devuelve `null` y la función acaba en el mismo `return null` del original.
Ningún test lo distingue sin tocar el fuente (fuera de alcance). Aritmética esperada de la corrida: `npc-director`
130/150 = 86,67 % (≥ 81), `state-http-dispatch` 139/139 = 100 %.

## Hallazgos

- **Menor** (informe): `implementacion.md` § «Qué NO queda cubierto» nombra 118 y 142 como muertos por
  lanzamiento; 122 también lo es. Corregir la frase para que la lista de «frágiles ante una guarda» sea completa.
- **Pendiente para el coordinador** (no del ingeniero): la corrida autorizada solo está pedida en
  `implementacion.md`, que no se commitea. La pregunta abierta de `requisitos.md` dice «en el informe y en la PR»;
  hoy no hay PR de la rama. El cierre de #675/#676 espera a esa corrida.

## Workarounds usados

Ninguno.

## No probado

- El número de la corrida (86,67 % y 100 %): exige la corrida autorizada; si otra tanda del rango toca
  `npc-director.ts` o `http.ts` la cifra se mueve.
- Cobertura de `main` como base: no la medí; la rama solo añade tests.

## Veredicto

**Apto.** Los dos suelos se recuperan con tests sobre la regla (docblock de `place-target.ts`; «todo `no_session`
nombra las dos causas»), sin mover ninguna cifra del contrato, y el rojo de los 17 + 50 + gemelo lo reproduje yo desde
cero. Queda la imprecisión menor del informe y la PR que pida la corrida.
