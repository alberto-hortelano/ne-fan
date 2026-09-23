# Requisitos — tanda AK: ruff entra en el bucle local (#709)

## Petición literal del usuario

> «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

El coordinador eligió este issue para la tanda. Sesión AUTÓNOMA: el usuario no está para dar visto bueno a mitad del ciclo; lo que haya que preguntarle se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## El issue, verbatim (cuerpo + comentarios, descargado hoy de GitHub)

### #709

> ruff solo corre en el job ai-server del CI: tres vueltas de una tanda pasaron el bucle local con ese job en rojo
> 
> Sale de la tanda AB (#426, PR #702, 2026-09-21).
> 
> ## El hecho
> 
> `ruff check ai_server` corre SOLO en el job `ai-server` de `ci.yml` (línea ~166). No está en `npm run verify`, ni en `unittest`, ni en ningún guion local. Un `E741` (variable `l`) en un test de `ai_server/` pasó tres vueltas completas de verificación local (unittest 273 OK, verify verde, guiones verdes) con el job de CI en rojo, y con ruff fallando el `python -m compileall` de la línea siguiente ni llegaba a correr.
> 
> Agravante medido en la misma tanda: GitHub no lanza el workflow `pull_request` de una PR con `mergeable_state: dirty`, así que un push sobre una rama en conflicto no produce «CI rojo» sino «CI ausente», que se confunde con «cola lenta».
> 
> ## Lo que hay que hacer
> 
> Que quien toque `ai_server/` tenga ruff en el bucle local: un paso `lint:py` (ruff + compileall, < 1 s) que `verify` corra cuando el diff toque `ai_server/` o `labs/**/*.py`, o siempre (es barato). Y que el `.venv` lo lleve (`pip install ruff` hoy no está en ninguna receta escrita).
> 
> Relacionado: #426, #697 (otro verde que no podía ponerse rojo).

## Criterios de aceptación

1. `npm run verify` (o el paso que el coordinador de una tanda corre siempre) ejecuta `ruff check` sobre `ai_server/` (y `labs/**/*.py` si el CI lo hace) más `compileall`, y sale ≠ 0 con un `E741` sembrado a propósito (negativo medido).
2. La receta del `.venv` que usa el repo instala ruff (y la MISMA versión/config que CI, o se explica por qué no importa); si ruff no está instalado, el paso FALLA en voz alta diciendo cómo instalarlo — nunca se salta en silencio.
3. Lo que corre local y lo que corre CI salen de UNA definición (no dos listas de rutas que diverjan), o hay candado que las compare.
4. El coste añadido a `verify` medido (el usuario decidió no encarecer `verify` más allá de ~13 s; decir el delta con número).
5. El agravante de `mergeable_state: dirty` (CI ausente) se anota o se trata si es barato; no es obligatorio.

## Contexto del coordinador

- Worktree: `/home/al/code/ne-fan-tanda-ak`, rama `feature/tanda-ak`, nacida de `main` = `83ea6046`. Todo el trabajo va en ese árbol, nunca en `/home/al/code/ne-fan`.
- Hay OTRAS cinco tandas en paralelo en worktrees hermanos (`ne-fan-tanda-{ah,ai,ak,al,am,an}`): #716 detector de saltos, #714 resume con tiles en clay, #709 ruff local, #704 un solo barrido del banco, #700 buscar con veces===1, #697 describe que lanza. Si esta tanda toca un fichero que otra también tocará con probabilidad (p. ej. `nefan-core/test/banco-ficheros.ts`, `package.json`, `ci.yml`), dilo en tu documento.
- Si hay que levantar un stack (qa/run.mjs), NUNCA matar procesos ajenos; `qa/run.mjs` elige bloque libre solo.
- Nada de gasto de créditos de imagen: preset `e2e-sin-creditos` / motor falso.
- Mutación: `npm run mutacion -- local <id>` si cabe en el tope; si no, se pide y no se espera.
- Commits intermedios en la rama (hubo límites de sesión que mataron agentes con trabajo sin commitear).

## Fuera de alcance

- Lo que el propio issue declara fuera.
- Issues vecinos que aparezcan: se ANOTAN (propuesta de issue nuevo en el documento), no se arreglan.

## Reencuadre del crítico, aceptado por el coordinador (2026-09-23, sesión autónoma: no cambia QUÉ se construye)

Los criterios 1, 2 y 5 quedan SUSTITUIDOS por los de abajo. El agravante `dirty` (criterio 5) pasa a obligatorio: se arregla aquí en `.claude/hooks/ci-verde.sh` con su negativo.


> 1. `npm run verify` ejecuta, **siempre** (sin condicionarlo al diff), `ruff check ai_server` + `python -m compileall -q ai_server labs`, y sale ≠ 0 con un `E741` sembrado en `ai_server/` (negativo medido). **ruff NO se amplía a `labs/`**: CI no lo corre ahí y hoy daría 1 `F841` (gate que nace rojo). El paso NO va en `npm test`: el job `nefan-core` de CI no tiene Python.
> 2. ruff entra en la receta del `.venv` (`ai_server/requirements.txt` o equivalente que `start.sh:459` ya cite) con **versión fijada**, y CI instala **esa misma** (hoy `ci.yml:165` no fija ninguna). El paso encuentra el intérprete/ruff **también desde un worktree hermano**, que no tiene `.venv` propio (las tandas usan el de `/home/al/code/ne-fan`). Si no lo encuentra, falla en voz alta con la orden exacta para instalarlo, y nunca se salta. Verificado: `verify` verde desde `/home/al/code/ne-fan-tanda-ak` Y desde el checkout principal.
> 5. Agravante `dirty`: `.claude/hooks/ci-verde.sh:38` trata una PR abierta sin checks (`[]`) como «nada que esperar». O se corrige aquí con su negativo, o se abre un issue propio con esa línea citada. Anotarlo en prosa no basta.
