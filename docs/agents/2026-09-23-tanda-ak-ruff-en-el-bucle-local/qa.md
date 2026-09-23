# QA — tanda AK (#709): ruff en el bucle local + hook sin checks

Rama `feature/tanda-ak` en `4a3eaba6` (worktree `/home/al/code/ne-fan-tanda-ak`), contra `main` = `83ea6046`.
Criterios: los de `requisitos.md` con el reencuadre del crítico (1, 2 y 5 sustituidos). El checkout principal
`/home/al/code/ne-fan` no se tocó (`git status` limpio antes y después). Guion ejecutable: **162**
(`qa/guiones/162-el-lint-de-python-corre-en-el-bucle-local-y-se-pone-rojo.mjs`, `sinNavegador`), probado en negativo
con cinco sabotajes. Con el guion y la fila del README en el árbol, `npm run verify` sigue verde (rc=0, 3273/3273,
61 s): pasa `un-numero-un-guion`, el detector de saltos (#356), `banco-ficheros` y eslint.

Corrida del 162 en positivo (`node qa/run.mjs --sin-navegador 162`): 22 asertos ✔, 1 en verde de 1. Sabotajes, uno por
vez y restaurados con `git checkout`: N1 `|| true` tras el `ruff check` → rojo SOLO «E741 en ai_server»; N2 ruff
ampliada a `labs` → rojo el positivo del árbol (labs trae un `F841`) y «no lo ve»; N3 sin comparación de versión →
rojo SOLO «otra versión»; N4 `verify` sin `lint:py` delante → rojo SOLO ese; N5 un `ruff check` suelto en `ci.yml` →
rojo SOLO «segunda lista».

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| C1a · `npm run verify` corre SIEMPRE `ruff check ai_server` + `compileall -q ai_server labs`, sin condicionarlo al diff | ✅ cumple | `package.json`: `verify = npm run lint:py && npm run build && …`, `lint:py = bash ../ai_server/lint.sh`; `lint.sh` no mira el diff. `npm run verify -s` en el worktree: rc=0, `ℹ tests 3273 · pass 3273 · fail 0`, con `lint.sh: ruff 0.15.20 + compileall OK (/home/al/code/ne-fan/.venv/bin/python)` en el log (62,7 s, máquina cargada). Guion 162, asertos «`verify` EMPIEZA por `npm run lint:py`» y «`lint:py` es `bash ../ai_server/lint.sh`» |
| C1b · sale ≠ 0 con un `E741` sembrado en `ai_server/` (negativo medido) | ✅ cumple | Sembré `l = 1` en `ai_server/tests/test_archivar_sheets_varados.py` y corrí `npm run verify`: **rc=1 en 0,26 s** (`E741 Ambiguous variable name: l` + `F841`, «Found 2 errors»); revertido, árbol limpio. También con `SyntaxError` (`def (:`) en `labs/serve.py`: `lint:py` rc=1 (`*** Error compiling 'labs/serve.py'`). Guion 162 reproduce ambos sobre una copia (siembras 1 y 2) |
| C1c · ruff NO se amplía a `labs/`; el paso NO va en `npm test` | ✅ cumple | Guion 162: «un E741 sembrado en labs/ NO lo ve» ✔ (rc 0); «`npm test` NO corre el lint de Python» ✔ (`test = node --import tsx --test …`). Sabotaje N2 (ruff sobre `ai_server labs`) pone rojo el positivo del árbol: `labs/` trae hoy un `F841`, tal como dijo el crítico |
| C2a · ruff en la receta del `.venv` con versión FIJADA, y CI instala ESA misma | ✅ cumple | `ai_server/requirements-dev.txt` = `ruff==0.15.20`; `ci.yml:167` `pip install -r ai_server/requirements-dev.txt pillow httpx fastapi numpy`; `start.sh:459` cita `-r ai_server/requirements-dev.txt`. `lint.sh` compara `python -m ruff --version` con el pin: intérprete falso que dice `ruff 0.9.0` → rc=1 «ruff 0.9.0 en …, pero el pin (el que instala CI) es 0.15.20. Instálalo: "…" -m pip install -r ai_server/requirements-dev.txt». Guion 162, bloque B y «ruff de OTRA versión» |
| C2b · encuentra el intérprete desde un worktree hermano sin `.venv` propio | ✅ cumple | Este worktree no tiene `.venv` (`ls /home/al/code/ne-fan-*/.venv` → nada; `which ruff` → nada). `lint.sh` acaba en `/home/al/code/ne-fan/.venv/bin/python` por `git rev-parse --path-format=absolute --git-common-dir` (git 2.34.1 aquí). Medido 4 veces en `npm run lint:py` (0,16–0,27 s) y en los dos `verify` |
| C2c · si no lo encuentra, falla EN VOZ ALTA con la orden exacta; nunca se salta | ✅ cumple | Copia `git archive` sin `.git` ni `.venv`: (1) `PATH=/usr/bin:/bin` → rc=1 «ruff no está instalado en python3. Instálalo: "python3" -m pip install -r ai_server/requirements-dev.txt»; (2) `NEFAN_PYTHON=` → rc=1 «puesta pero vacía»; (3) `NEFAN_PYTHON=/no/existe` → rc=1; (4) `NEFAN_PYTHON=/usr/bin/python3` (sin ruff) → rc=1 con la orden; (8) pin borrado del `requirements-dev.txt` → rc=1 «no fija la versión»; (9) PATH sin `python3` (solo dirname/sed/awk/git) → rc=1 «no hay intérprete de Python … Crea uno: python3 -m venv .venv && …»; (10) intérprete falso que dice `0.15.20` pero cuyo `-m ruff check` sale 3 → rc=3 (el binario que se comprueba es el que se ejecuta). Los siete están en el guion 162, bloque D |
| C2d · `verify` verde desde el worktree Y desde el checkout principal | ⚠️ no probado del todo | Worktree: verde (arriba). Principal: **no se puede correr sin tocarlo** (está en `main`, sin `lint.sh`). Simulé su rama de resolución (`<raíz>/.venv`, la primera que se mira) con una copia `git archive` + `.venv` enlazado al del principal: rc=0, `… OK (…/principal/.venv/bin/python)`. Queda por ver el `verify` real del principal el día que se fusione; el riesgo es bajo (es la rama más simple del resolvedor) |
| C3 · local y CI salen de UNA definición | ✅ cumple | `grep -nE 'ruff\|compileall' ci.yml package.json` → solo comentarios y la línea `pip install -r …requirements-dev.txt`; ambos lados invocan `bash ai_server/lint.sh`. Guion 162: «ci.yml lanza `bash ai_server/lint.sh` exactamente una vez» ✔ y «no corre `ruff check` ni `compileall` fuera del script» ✔; sabotaje N5 (un `ruff check` suelto en `ci.yml`) → rojo SOLO ese aserto |
| C4 · coste añadido a `verify`, con número | ✅ cumple | `npm run lint:py` (incluye el arranque de npm): **0,16 / 0,16 / 0,22 s en caliente; 0,27 s en frío** (sin `__pycache__` ni `.ruff_cache`). `verify` completo 62,7 s con la máquina cargada (el ingeniero midió 57,1→57,0 s): el delta es el de `lint:py`, ~0,2 s, y va PRIMERO, así que un rojo de Python cuesta 0,26 s, no 60. Los ~13 s del usuario ya no se cumplían antes de esta tanda en este árbol; no es de aquí |
| C5 · `ci-verde.sh`: una PR ABIERTA sin checks BLOQUEA, con su negativo | ✅ cumple | `nefan-core/test/hook-ci-verde.test.ts` (9 casos, `gh` falso en PATH + repo git temporal con upstream): en la rama `pass 9 / fail 0`. **En negativo**: puse el `ci-verde.sh` de `main` (`git show 83ea6046:…`) y corrí el mismo test → `pass 7 / fail 2`: rojos EXACTAMENTE «PR ABIERTA sin ningún check → BLOQUEA» y el backstop (que usa `[]` como caso). Restaurado (`git diff` 0). Con el `gh` 2.4 real: `gh pr view 715 --json state,mergeable,statusCheckRollup` devuelve los tres campos. Hook real en este worktree (sin upstream): rc=0 y salida vacía, como debe |

## Hallazgos

**Importante**

1. **El guion 162 será ROJO en el job `candados-headless` hasta que ese job instale ruff.** El job tiene
   `setup-python 3.11` + `pip install fastapi uvicorn anthropic httpx pillow numpy` (`ci.yml:241-248`) pero NO
   `requirements-dev.txt`, y corre `node qa/run.mjs --sin-navegador` (`ci.yml:455`), que ahora incluye el 162. Sin
   ruff, `lint.sh` falla «ruff no está instalado en python3» y el primer aserto del guion sale rojo — que es el
   comportamiento correcto de `lint.sh`, y por eso el guion no lo convierte en ⊘. **Corrección para el ingeniero**:
   una línea en ese job, `pip install -r ai_server/requirements-dev.txt` (misma definición que el job `ai-server`).
   Reproducción: `env -u NEFAN_PYTHON PATH=/usr/bin:/bin bash ai_server/lint.sh` → rc=1. No lo hice yo (no arreglo).

**Menor**

2. **La orden de instalación es relativa a la raíz y no lo dice.** `lint.sh` hace `cd` a la raíz, pero el mensaje
   `"python3" -m pip install -r ai_server/requirements-dev.txt` lo lee alguien en `nefan-core/` (donde corre
   `npm run verify`) y le falla con «No such file». Bastaría `"$raiz/ai_server/requirements-dev.txt"` o decir
   «desde la raíz del repo».
3. **El hook deja pasar una PR `CONFLICTING` que SÍ tiene checks.** El caso de #709 (push sobre rama en conflicto →
   `[]`) queda cerrado. Pero si `main` avanza después del último push, la PR pasa a `mergeable: CONFLICTING` con el
   rollup del sha viejo en verde, y el hook sale 0: lee `mergeable` y solo lo usa en el mensaje. No es lo que pide
   el criterio 5 (que habla de `[]`), lo anoto como agujero conocido; una línea `[ "$mergeable" != CONFLICTING ] ||
   bloquear` lo cerraría, con su caso en el test.
4. **`labs/fps/sprites` es un enlace simbólico commiteado a arte generado que un worktree no tiene** (colgante en
   todos los `ne-fan-tanda-*`). No es de esta tanda; me costó una vuelta del guion (copiar dos veces sobre el mismo
   destino revienta en `stat`). Candidato a issue de backlog si molesta a más guiones.
5. **UX del hook**: una PR recién subida tiene `[]` unos segundos y bloqueará una vez con «si acabas de subir,
   espera». Aceptable (el backstop de 6 lo acota), pero conviene saberlo para no leerlo como «rama en conflicto».

## Workarounds usados

- **Copia por `git archive` + `NEFAN_PYTHON`** para las siembras y los fallos en voz alta (también en el guion): la
  copia no tiene `.git` ni `.venv`, así que el resolvedor no encontraría ruff. No afecta al usuario: en el árbol real
  `lint.sh` sí lo encuentra solo (medido, C2b); lo que se prueba en la copia es lo que pasa DESPUÉS de resolver.
- **Simulación del checkout principal** con `.venv` enlazado (C2d): el requisito de no tocar `/home/al/code/ne-fan`
  obliga. Declarado como parcialmente no probado, no como aprobado.
- **Intérpretes falsos** (scripts bash que contestan a `-m ruff --version`) en lugar del `python3` del sistema para
  «sin ruff» y «otra versión»: si un día el `python3` de la máquina tiene la ruff del pin, el caso real saldría
  verde por accidente. No es un obstáculo para el usuario, es aislamiento de la prueba.
- Para el negativo del hook, **sustituí temporalmente** `.claude/hooks/ci-verde.sh` por el de `main` y lo restauré
  (`git diff` vacío). Es la única forma de demostrar que el test se pone rojo sin el arreglo.

## No probado

- `verify` real en el checkout principal (C2d): solo simulado. Y el job `ai-server` de CI con el script nuevo (no hay
  PR aún; el ingeniero tampoco lo vio).
- El hook contra una PR real con `mergeable_state: dirty`: no hay ninguna abierta y no se puede fabricar sin subir
  una rama en conflicto. La prueba es con `gh` falso; el `gh` 2.4 real devuelve el campo `mergeable` (verificado en
  la #715, `UNKNOWN` por estar mergeada).
- ruff `0.15.20` bajo Python 3.11 (el de CI; el `.venv` local es 3.10): la señal será el `pip install` del job.

## Veredicto

**APTO con reservas**: los cinco criterios reencuadrados se cumplen con negativos medidos y el guion 162 se pone rojo
con cada sabotaje. La reserva es el hallazgo 1: en cuanto el guion entre en `main`, el job `candados-headless` estará
rojo hasta que instale `requirements-dev.txt` (una línea); si el coordinador prefiere no tocar ese job en esta tanda,
la alternativa es no commitear el guion, y entonces todo lo mecánico de arriba vuelve a ser prosa.
