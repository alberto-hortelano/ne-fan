# QA — tanda U: «Un número, un guion; y dónde vive el sondeo de una QA» (#680 + #683)

Sobre `feature/tanda-u-un-numero-un-guion` = `a04ef33c` (base `main` = `a25d8c2f`, que NO se ha movido: en `main` el último guion sigue siendo el 149 y no hay `150-` ni `151-`). Máquina compartida: tres runners ajenos en marcha durante la QA (`qa/run.mjs 93`, `qa/run.mjs 63-una-posicion` de la tanda AF, otro `start.sh` más), load average 13–21. Cero créditos: motor falso del runner en las dos corridas de navegador.

Criterios: los del `requisitos.md` con el 2 y el 3 SUSTITUIDOS por la sección final del crítico (aceptada por el coordinador).

## Criterio → veredicto → evidencia

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | El 126 joven (rótulos) cede; su fila del README y la remisión del 136 quedan inequívocas | ✅ cumple | `git show --stat HEAD`: rename `126-dos-rotulos…` → `150-dos-rotulos…` (similarity 99 %, solo cambian los dos `scene_id: "qa126"` → `"qa150"`). `grep -rln "126-dos-rotulos"` fuera de `docs/agents/2026*` y `node_modules` → **0 ficheros**. `ls qa/guiones \| grep 150` → un solo fichero. `qa/README.md:560` «…sigue en el **150** (los rótulos alineados; nació como 126 y cedió el número, #680)». La fila del 150 está al final de la tabla, tras la del 149. **El guion renombrado CORRE en navegador**: `node qa/run.mjs 150` dos veces (bloque +100 elegido por el runner, preset `e2e-sin-creditos`, `fake:true` en cliente y bridge), las dos **12 asertos ✔ · 0 ✘**, `gasto {"/generate_scene":1}` del motor falso. Capturas en `qa/capturas/2026-09-20T10-38-00-197Z-88056/` (01: un solo rótulo «Aldeana del pozo viejo» con los dos cuerpos alineados; 03: los dos rótulos con las cajas disjuntas) |
| 2a | Candado: prefijo numérico único en `qa/guiones/*.mjs`, que CORRE EN CADA PR | ✅ cumple | `nefan-core/test/un-numero-un-guion.test.ts` (4 `it`). Corre en `npm test` de core: `package.json:30` (`test/*.test.ts`), `ci.yml:69` (`npm run coverage`, mismo glob, job `nefan-core` de cada PR) y en `verify`. Baseline aquí: `tests 4 · pass 4`. `npm test` de core con el 151 presente en el árbol: **3121/3121**. Node 24 aquí y en CI (`parentPath` de `Dirent` existe) |
| 2b | Probado en negativo con los dos 126 | ✅ cumple | El informe del ingeniero trae el rojo literal ANTES del `git mv` (`126 → [126-dos-records…, 126-dos-rotulos…]`); eso era una afirmación en prosa. Ahora es **repetible**: el guion `151-el-candado-del-prefijo-puede-ponerse-rojo.mjs` siembra un segundo guion con el número vivo del 126 (`126-zz-…`) y exige que se ponga rojo SOLO «ningún número lo comparten dos guiones…» y que el mensaje nombre `126 → [` → ✔ (salida abajo) |
| 2c | Declara lo que NO cubre: guion sin prefijo, `07` vs `7`, dos ramas paralelas | ✅ cumple, con una omisión menor | Cabecera del test, bloque «LO QUE NO CUBRE». Las dos primeras no son agujeros sino decisiones: **sin prefijo es ROJO** (151: `zz-sin-numero.mjs` → solo «todo guion lleva prefijo numérico», nombrado) y **`07` = `7`** (151: `0126-zz-…` → solo el aserto de unicidad, nombrado). Dos ramas paralelas: declarado y absorbido por la convención (criterio 4). **Omisión**: el SYMLINK `.mjs` en `docs/agents/` no está en la lista de la cabecera (hallazgo H-2) |
| 3a | #683 decidido: NO hay tercera categoría; escrito en `docs/agents/README.md` y en `qa/README.md` §«Lo que corre el CI» | ✅ cumple | `docs/agents/README.md:27-33` («**Y es el único sitio** (#683)…»); `qa/README.md:107-115` («**Dónde vive el material ejecutable de una QA** (#683): NO hay tercera categoría…»), con el molde del 148 y la remisión al test. La cuenta «Hoy son tres…» retirada de `qa/README.md:105` (queda solo el «Hoy son tres» de la fila del 148, que habla de sus AGUJEROS) |
| 3b | En `docs/agents/` no vive nada ejecutable (opcional del crítico, hecho) | ✅ cumple | `find docs/agents -type f \( .mjs .sh .py .ts \)` → 0. Test: «todo fichero de docs/agents/** es prosa» ✔. Negativos repetibles (151): `.mjs`, `.py` y `.sh` en subdirectorio bajo `docs/agents/<carpeta>/` → rojo SOLO ese aserto, nombrando el fichero |
| 3c | El sondeo de #609 se trata según la decisión | ✅ cumple (no existe) | Verificado por el crítico con `git log --all`; aquí `find` a cero. Nada que tratar |
| 4 | «El número lo asigna quien fusiona, mirando `main`» escrito donde lo lee quien numera | ✅ cumple | `qa/README.md:172` (§«Cómo se escribe un guion», primer párrafo, en negrita) y `docs/agents/README.md:33`. Y se cumple en los hechos: 150 y 151 son los primeros libres en `main` HOY; si V/W/AF entran antes, el propio test lo dirá en rojo con los dos ficheros |
| — | El candado del 151 (material de QA) entra en CI el día que nace | ✅ cumple | `node qa/run.mjs --sin-navegador` sin filtro enumera **5** (39, 40, 146, 148, **151**) y los 5 salen ✔ (14,9 s con load 21; el 151 aislado 3,0–3,9 s). El job `candados-headless` hace `npm ci` + `npm run build` en `nefan-core`, así que el `node --import tsx --test` que el 151 spawnea tiene con qué correr |
| — | `verify` / `crap` / mutación | ⚠️ no probado aquí más allá de `npm test` | La tanda no toca `src/`; el ingeniero declara `verify` EXIT=0 3121/3121. Repetí solo `npm test` (3121/3121). `crap` y `mutacion` no aplican (ningún módulo del núcleo puro cambia) |

### El guion 151: qué era, qué le faltaba y por qué se queda

La QA anterior murió con `qa/guiones/151-el-candado-del-prefijo-puede-ponerse-rojo.mjs` sin trackear. Leído entero: es el hermano en negativo del test nuevo con el molde del 148 (SABOTAJES que deben salir rojos por su aserto exacto y nombrando el fichero + AGUJEROS conocidos que deben seguir verdes), `sinMotor` + `sinNavegador`, siembra en el árbol de trabajo, limpia en `finally` y con señales, se niega si ya hay rastro, toma el turno de `turnoDeCandados`. **Es exactamente lo que el criterio 3 acaba de decidir que debe ser el material ejecutable de una QA, y nadie más canda que el candado de U pueda ponerse rojo** (el informe del ingeniero lo afirma; esto lo repite cualquiera). Se queda.

Tal como estaba, salía **ROJO por un defecto propio**, no del candado: la regex que lee los asertos rojos del reporter era perezosa (`/^ {2}✖ (.+?) \(\d/`) y cortaba el nombre en el primer «(» seguido de dígito, que en «…(07 y 7 son el mismo)» es el «(0» del propio nombre; dos sabotajes fallaban con «esperaba SOLO «…(07 y 7 son el mismo)» y se pusieron rojos: ningún número lo comparten dos guiones». Lo terminé: captura codiciosa hasta el `(<ms>)` final de línea, y retirada una línea muerta en `TODO_LO_SEMBRABLE` (`...guionesVivos.length ? [] : []`). Añadida su fila en «Los guiones sembrados» tras la del 150.

Salida del 151 terminado (`node qa/run.mjs --sin-navegador 151`, 3,0 s, EXIT=0, `git status` limpio y sin rastro `zz` después):

```
✔ el candado viene VERDE de partida y con sus cuatro asertos
✔ los cuatro asertos que este guion nombra siguen llamándose así
✔ sabotaje · un segundo guion con el 126 (el choque de #680, con el número vivo)   …y NOMBRA «126 → [»
✔ sabotaje · el mismo número con cero a la izquierda (0126 es el 126)              …y NOMBRA «0126-zz-con-cero-delante.mjs»
✔ sabotaje · un guion sin prefijo numérico                                          …y NOMBRA «zz-sin-numero.mjs»
✔ sabotaje · un número con separador distinto (`_` en vez de `-`) no es prefijo    …y NOMBRA «126_zz-con-guion-bajo.mjs»
✔ sabotaje · un sondeo `.mjs` dejado en docs/agents/ (el caso de #683)             …y NOMBRA «zz-sondeo.mjs»
✔ sabotaje · un `.py` en docs/agents/                                               …y NOMBRA «zz-sondeo.py»
✔ sabotaje · un `.sh` en un SUBDIRECTORIO de docs/agents/<tanda>/                  …y NOMBRA «zz-sondeo.sh»
✔ agujero CONOCIDO, sigue abierto · un `.mjs` en un SUBDIRECTORIO de qa/guiones/ repitiendo un número
✔ agujero CONOCIDO, sigue abierto · un ejecutable SIN extensión en docs/agents/ (shebang y bit x)
✔ agujero CONOCIDO, sigue abierto · un SYMLINK `zz.mjs` en docs/agents/ que apunta a un guion real
✔ agujero CONOCIDO, sigue abierto · extensión fuera de la lista o en MAYÚSCULAS en docs/agents/ (`.MJS`, `.bash`, `.rb`)
✔ no queda ninguna siembra en el árbol
✔ y el candado vuelve a estar verde
```

**El 151 probado en negativo** (cuatro sabotajes al test de core, uno por vez, restaurado por md5 `9f42e556…` idéntico antes y después):

| Sabotaje al candado | El 151 dice |
|---|---|
| A · comparar por TEXTO (`return m[1]` en vez de `Number(m[1])`) | ✘ «sabotaje · el mismo número con cero a la izquierda — SEMBRARLO NO CAMBIA NADA» (EXIT 1) |
| B · quitar `.py` de `EXTENSIONES_EJECUTABLES` | ✘ «sabotaje · un `.py` en docs/agents/ — SEMBRARLO NO CAMBIA NADA» (EXIT 1) |
| C · enumerar `qa/guiones/` con `recursive: true` | ✘ «agujero CONOCIDO · subdirectorio — YA NO ES UN AGUJERO: ahora lo caza «todo guion lleva prefijo numérico»» (EXIT 1) |
| D · renombrar el `it` «todo guion lleva prefijo numérico» | ✘ «los cuatro asertos que este guion nombra siguen llamándose así — renombrados o borrados: …» (EXIT 1) |

Cada uno pone rojo SOLO su fila.

## Pasada adversarial sobre el candado (¿cubre menos de lo que dice?)

| Situación | Resultado | Juicio |
|---|---|---|
| Subdirectorio en `qa/guiones/` con un `.mjs` que repite número | El test NO lo ve (`readdirSync` plano) | **No es agujero hoy**: el runner enumera igual de plano (`qa/run.mjs:1338`), así que ese fichero no corre en ninguna batería ni choca con nadie. Queda como AGUJERO en el 151 para que el día que alguien lo cierre se sepa |
| Prefijo `0150` (o `0126`) | ROJO por unicidad: `Number("0126") = 126` | Cubierto y nombrado (151) |
| `150_algo.mjs` (guion bajo) | ROJO por «sin prefijo» | Cubierto (151); más estricto que el enunciado, y bien: el runner y el README nombran por `<n>-` |
| Ejecutable SIN extensión en `docs/agents/` (shebang + `chmod +x`) | VERDE | **Declarado** en la cabecera del test y como AGUJERO en el 151 |
| `.MJS` / `.bash` / `.rb` | VERDE | Declarado («extensión que no esté en la lista»); `extname` distingue mayúsculas — en el 151 |
| SYMLINK `zz.mjs` en `docs/agents/` → guion real | VERDE (`isFile()` excluye enlaces; git los commitea) | **NO declarado en la cabecera del test** → H-2. Está en el 151 como agujero |
| Un `.mjs` en `docs/agents/` de OTRO worktree | No cuenta: `DOCS_AGENTS` se resuelve desde `import.meta.url` del test | Correcto y es lo esperado; el rojo es del árbol de quien lo tiene |
| Dos ramas paralelas con el mismo número | Las dos verdes hasta fusionar | Declarado; solo lo absorbe la convención del criterio 4. No medible en local |
| Directorio vacío o movido | ROJO por «hay guiones: la totalidad tiene sujeto» (≥ 100) | La totalidad tiene sujeto |

## Hallazgos

**Ninguno bloqueante ni importante.**

- **H-1 · menor · prosa que envejece en `ci.yml:424-425`**: el comentario del paso `node qa/run.mjs --sin-navegador` dice «Hoy son CUATRO: el 39, el 40, el 146 y el 148». Con el 151 son cinco, y el plan §6 retiró justamente esa cuenta del README por mentir a las 24 h; la misma cifra sigue viva en el yml. Para el coordinador (tocar `.github/workflows` exige scope `workflow` en `gh`; y el propio comentario ya dice que nadie persiga el tercer dígito). Medida de hoy para quien lo actualice: clase entera 14,9 s con load 21 y tres runners ajenos; el 151 aislado 3,0–3,9 s (13 subprocesos de `node --test`).
- **H-2 · menor · la cabecera del test no nombra el symlink**: «LO QUE NO CUBRE» lista extensión fuera de lista y sin extensión, pero `withFileTypes` + `isFile()` también deja fuera un enlace simbólico `.mjs`, y git lo commitea. Una línea en la cabecera; el 151 ya lo mide como agujero conocido.
- **H-3 · menor · el subdirectorio de `qa/guiones/`** no lo ve ni el candado ni el runner. Hoy es coherente (un guion en subdirectorio no existe para nadie), pero si alguien decide algún día que el runner recurra, el candado tiene que recurrir en el mismo commit; el 151 se pondrá rojo (sabotaje C lo demuestra) y lo dirá.
- **Observación fuera del alcance, resuelta a favor del launcher**: tras la PRIMERA corrida de `node qa/run.mjs 150` (EXIT=0), cuatro puertos del bloque +100 seguían escuchando y `NEFAN_PORT_OFFSET=100 ./start.sh --parar` dijo «(nada que parar aquí)» ofreciendo `--parar-todo` para «lo ajeno DEL BLOQUE VIGENTE»: los vio y los clasificó como ajenos. Un minuto después no existían; la segunda corrida dejó el bloque vacío a los 2 s de salir el runner; y al final de la QA el bloque +100 volvía a estar ocupado por PIDs nuevos (107555/107766/107861) que también desaparecieron en segundos, con dos runners ajenos rotando en la máquina (`qa/run.mjs 93` y `60-reanudar 63-una-posicion` de la tanda AF). Conclusión: eran stacks efímeros de OTRO runner que tomó el +100 justo después de que el mío lo soltara, y `--parar` hizo lo correcto al no tocarlos. No es #684 ni un rojo de esta tanda; queda anotado por si alguien vuelve a ver un «nada que parar» con puertos arriba: primero mirar qué runner ajeno acaba de coger el bloque.

## Workarounds usados

- Ninguno sobre el flujo del usuario: el 150 corrió desde `qa/run.mjs` con su preset, sin ocultar ni forzar nada.
- Sabotajes temporales al test (A–D) y siembras del 151 en `qa/guiones/` y `docs/agents/`: es el método del negativo; restaurado por md5 y con `git status` que solo muestra `qa/README.md` (fila del 151) y el 151 sin trackear.

## No probado, y por qué

- **El rojo al fusionar la segunda rama con el mismo número**: por construcción no se puede medir en local (el test no ve `main`); la garantía es la convención escrita + el rojo en la PR que entra segunda.
- **CI real**: no hay push ni PR; el hook `ci-verde` lo exigirá al cerrar. Lo que se puede saber desde aquí está mirado: el glob de `npm test`/`coverage` incluye el fichero, `candados-headless` instala `nefan-core` y corre la clase `--sin-navegador`.
- **`verify` completo, `crap`, mutación**: no repetidos; no hay fichero de `src/` en el diff. Solo `npm test` (3121/3121).

## Estado del árbol al entregar

`git status`: ` M qa/README.md` (una línea: la fila del 151) y `?? qa/guiones/151-el-candado-del-prefijo-puede-ponerse-rojo.mjs` (terminado, verde, probado en negativo). Nada de `zz-` en `qa/guiones/` ni en `docs/agents/`. El stack del bloque +100 de este árbol está parado (verificado con `ss` tras la segunda corrida). Numeración del 151 = primer libre en `main` tras el 150 de esta rama; quien fusione mira `main` y renumera si hace falta, como dice el README que esta tanda escribió.

## Veredicto

**APTO.** Los cuatro criterios (con el 2 y el 3 reencuadrados) se cumplen con evidencia medida y no leída; el guion renombrado corre en navegador; el candado se pone rojo por cada defecto y solo por el suyo, y desde hoy eso lo repite cualquiera con el 151. Los tres hallazgos son menores (dos líneas de prosa y una nota de coherencia futura) y no condicionan el cierre de #680 ni de #683.
