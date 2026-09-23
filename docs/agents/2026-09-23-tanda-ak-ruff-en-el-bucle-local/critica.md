**REENCUADRADA** (leve): el problema es real y la dirección es buena; cambian el alcance de `labs/`, dónde vive ruff y la versión, y el agravante tiene un sitio concreto.

## El problema real, en una frase

Lo que el job `ai-server` exige (ruff + compileall) no se puede reproducir con el comando que el ingeniero corre siempre, así que un rojo de Python se ve con una PR ya abierta y no en el bucle local. La solución que propone el issue (un paso barato dentro de `verify`) ataca justo eso.

## La premisa, afirmación por afirmación

| Afirmación | Verificación |
|---|---|
| ruff corre SOLO en el job `ai-server` | Cierto: `.github/workflows/ci.yml:165-166` (`pip install ruff …`, `ruff check ai_server`) es el único sitio donde se ejecuta. |
| No está en `verify` | Cierto: `nefan-core/package.json:51` = build + typecheck×3 + eslint + `npm test`. |
| compileall va justo después, así que ruff lo tapa | Cierto: `ci.yml:170` `python -m compileall -q ai_server labs`. |
| «`pip install ruff` no está en ninguna receta escrita» | Cierto: `ai_server/requirements.txt` no lo trae y la receta de `start.sh:459` es `pip install -r ai_server/requirements.txt`. El `.venv` de `/home/al/code/ne-fan` SÍ tiene ruff (0.15.20), pero se instaló a mano. |
| Coste < 1 s | Cierto, y de sobra: `ruff check --no-cache ai_server` 0,01 s; `compileall -q ai_server labs` 0,075 s (medido hoy en este árbol). El criterio 4 se cumple midiéndolo, sin decisión que tomar. |
| ¿`ruff` sobre `labs/**/*.py` «si el CI lo hace»? | **CI no lo hace** (`ci.yml:167-170`: en labs solo compileall) y **hoy daría rojo**: `ruff check labs` → 1 `F841`. Meterlo convierte la tanda en «limpiar labs» y crea un gate que nace rojo. Hay que dejarlo fuera. |
| ¿Misma versión que CI? | CI **no fija versión** (`pip install ruff` = la última del día). Hoy no hay versión de CI con la que casar: «la misma versión» solo es posible fijándola en los DOS lados. |

Dos hechos que el issue no ve y que cambian lo que se construye:

1. **Ningún worktree tiene `.venv`** (`ls /home/al/code/ne-fan-*/.venv` → nada; `which ruff` → nada). Las tandas trabajan en worktrees y usan el `.venv` compartido de `/home/al/code/ne-fan` (lo dice `docs/agents/2026-09-18-tanda-ab-…/qa.md:5`). El criterio 2 («si ruff no está instalado, fallar en voz alta») aplicado en ingenuo deja `verify` **en rojo en todos los worktrees hermanos** desde el día del merge. Encontrar el `.venv` desde un worktree es parte del problema, no un detalle.
2. **CI no corre `verify`**: el job `nefan-core` corre sus pasos sueltos (`ci.yml:24-83`) y no tiene Python. Un paso en `verify` no le afecta. **Meterlo en `npm test`** (como test de node) sí rompería CI: ese camino no vale.

## El día después

- Quien juega: nada. Es deuda del bucle declarada (etiqueta `deuda`). Es legítimo.
- Lo que se vuelve más difícil: `verify` pasa a depender de Python + ruff en la máquina; quien solo toca TS lo paga (0,1 s) y además necesita el `.venv` localizable. Esa dependencia nueva es el coste real, no los segundos.
- Lo arbitrario dentro de un mes: dos listas de rutas (`ai_server` en CI, otra en el script) o dos versiones de ruff. El criterio 3 lo previene si se cumple de verdad: que el job `ai-server` llame a la misma definición, no que un comentario diga que son iguales.
- Condicionar el paso a «el diff toca `ai_server/`» (una de las dos opciones del issue) **no debería hacerse**: con un coste de 0,1 s, la condición solo añade una rama que se puede saltar en silencio (una rama sin upstream, un diff contra una base equivocada). Mejor siempre.

## Conflictos

- **Agravante `mergeable_state: dirty`**: tiene un sitio concreto. `.claude/hooks/ci-verde.sh:38` sale con 0 cuando `statusCheckRollup` está vacío. Una PR en conflicto sin workflow lanzado da `[]`, así que el guardia la trata igual que «no hay CI que esperar». Es el mismo «verde que no puede ponerse rojo» de #697, en el hook `Stop`. Se puede tocar sin chocar con nadie y en pocas líneas, pero es otro fichero y otra prueba en negativo: tratarlo aquí o abrir un issue es decisión del coordinador. Si no se trata, se abre el issue (no basta con «anotarlo»).
- **Tandas hermanas**: `nefan-core/package.json` (el script `verify`) lo pueden tocar #697/#700/#704/#716 si añaden scripts. El conflicto sería de merge, trivial. `ci.yml`: esta tanda solo debería tocar el job `ai-server` (l.142-175), y las otras, si tocan algo, será `candados-headless`. No hay solapamiento ni contradicción con ningún issue abierto (`gh issue list`, 30 abiertos).
- La prosa que dice «el job `ai-server` solo corre ruff, compileall y unittest» (`nefan-core/test/contract-*.test.ts:5`, `scripts/dump-*.ts`) sigue siendo cierta. No hay que barrer nada.

## Coste contra valor

Barato: un paso de 0,1 s, un pin y una línea de receta. El valor es modesto pero medido: tres vueltas de una tanda perdidas contra un `E741`. Si no se hiciera nunca, el hook `Stop` seguiría cazando el rojo, pero tarde, con la PR abierta y contexto gastado, y no lo caza en absoluto cuando la PR está `dirty`. Merece la pena, siempre que no se convierta en limpiar `labs/` ni en montar un gestor de entornos.

## Qué le cambiaría a `requisitos.md` (para pegar sobre los criterios 1, 2 y 5)

> 1. `npm run verify` ejecuta, **siempre** (sin condicionarlo al diff), `ruff check ai_server` + `python -m compileall -q ai_server labs`, y sale ≠ 0 con un `E741` sembrado en `ai_server/` (negativo medido). **ruff NO se amplía a `labs/`**: CI no lo corre ahí y hoy daría 1 `F841` (gate que nace rojo). El paso NO va en `npm test`: el job `nefan-core` de CI no tiene Python.
> 2. ruff entra en la receta del `.venv` (`ai_server/requirements.txt` o equivalente que `start.sh:459` ya cite) con **versión fijada**, y CI instala **esa misma** (hoy `ci.yml:165` no fija ninguna). El paso encuentra el intérprete/ruff **también desde un worktree hermano**, que no tiene `.venv` propio (las tandas usan el de `/home/al/code/ne-fan`). Si no lo encuentra, falla en voz alta con la orden exacta para instalarlo, y nunca se salta. Verificado: `verify` verde desde `/home/al/code/ne-fan-tanda-ak` Y desde el checkout principal.
> 5. Agravante `dirty`: `.claude/hooks/ci-verde.sh:38` trata una PR abierta sin checks (`[]`) como «nada que esperar». O se corrige aquí con su negativo, o se abre un issue propio con esa línea citada. Anotarlo en prosa no basta.
