# Tanda BJ — El medidor se mide (#769)

## Petición del usuario (literal)

> «Sigue cerrando todos los issues que puedas de forma autónoma. El objetivo es reducirlos al mínimo»
> (2026-09-24), retomada el 2026-09-29 con «seguimos con los 9 que quedan».

## El issue

> Sale de la tanda BF (#664). Esa tanda metió el cliente en CRAP con el árbol entero como universo, un tope de 73 por función y una foto de 45 funciones congeladas en `data/contract/client-crap.json`. Quedaron fuera tres cosas que la misma herramienta ya sabe medir:
> 
> 1. **El core también mide solo lo cargado.** `MEDIDA_CORE` usa `universo: "lo-cargado"`, así que un `.ts` de `src/`, `bridge/` o `services/` que ningún test carga no existe ni para `crap` ni para `deuda`.
>    - Con un lcov obsoleto salían unos 16 ficheros así. Primero hay que re-medir, con `Medicion.sinCargar`.
>    - Pasar el core a `"el-arbol"` puede mover el suelo del 95 % y el tope de 73. Se decide con el número delante y en una tanda propia.
> 2. **Nadie aprieta la foto del cliente.** Hoy una congelada que baja solo avisa, y bajarla obliga a editar el JSON a mano. Falta `npm run crap -- --apretar`, que reescriba las congeladas a su valor de hoy y quite las que ya caben en el tope. `--foto` ya imprime la foto que tocaría. Sin `--apretar`, el trinquete no baja: solo deja de subir.
> 3. **`scripts/` no entra en ningún universo.** `crap-score.ts`, `deuda.ts` y el resto de `nefan-core/scripts/` no están ni en `MEDIDA_CORE` ni en el perímetro de mutación: el medidor no se mide a sí mismo.
> 
> Relacionado: #664.

## Qué se pide a la tanda

Cerrar #769 en sus tres puntos, o decir con el número delante por qué alguno no debe hacerse
(y entonces reencuadrarlo). El punto 1 pide explícitamente «re-medir primero» y decidir con el
número delante: el crítico mide hoy (`Medicion.sinCargar`), no copia el «~16» del issue.

## Restricciones del coordinador

- Rango de guiones reservado: 230–239 (si hace falta alguno; esto es tooling, probablemente no).
- Todos los agentes en Opus.
- Los hallazgos de QA se resuelven dentro de la tanda, sin abrir issues nuevos.
- Si pasar el core a `"el-arbol"` mueve el suelo del 95 % o el tope de 73, NO se baja el
  listón para que quepa: lo que no quepa se congela con foto (como hizo BF en el cliente) o
  se decide con el usuario.
- Worktree: `/home/al/code/ne-fan-tanda-bj`, rama `feature/tanda-bj`.

## Decisiones del usuario tras la crítica (2026-09-29, literales de AskUserQuestion)

- Punto 1 → **«Hacerlo testeable (Recomendado)»**: la lógica de `register()` de `bridge/ws-server.ts` pasa a algo que un test carga y ejerce, y el core pasa a medirse con `"el-arbol"` **sin bajar el 95**.
- Punto 2 → vigente según la crítica: `--apretar` solo BAJA cifras o QUITA entradas; nunca congela una roja nueva.
- Punto 3 → **«Medida propia con trinquete (Recomendado)»**: `scripts/` tiene su propia `Medida`, contando solo lo cargado, con el suelo en el número de hoy y una foto de las funciones que pasan del tope, como el cliente. La mutación de `scripts/` queda fuera.
