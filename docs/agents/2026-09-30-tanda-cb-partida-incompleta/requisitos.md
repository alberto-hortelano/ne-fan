# Tanda CB — «Tu partida vuelve incompleta» al reanudar

## Petición literal del usuario (2026-09-30)

> «sigue con lo que falta»

Viene tras la demo. Esta tanda nace de un hallazgo del ingeniero de la tanda BX (terminar conversación).

## El hallazgo

- En el banco (`qa/run.mjs`, motor falso `labs/narrative/fake-ai-server.ts`), los spawns «cerca del jugador» de los turnos 3 y 4 caen a veces FUERA del tile, junto al tabernero.
- Al reanudar la partida, el juego muestra a pantalla completa **«Tu partida vuelve incompleta»**. Pasó en 1 de 3 corridas del guion 351.
- El guion 351 lo cierra con su botón y lo deja en el log. Según la regla del workaround (`docs/arquitectura/arranque.md`), eso es un hallazgo, no un paso de receta.

## Lo que hay que averiguar

1. **¿Es solo del banco o le puede pasar al jugador con el motor real?**
   - ¿Quién decide la posición de un spawn «cerca del jugador»?
     - Si es el motor, falso o real, ¿qué lo acota al tile?
     - Si es core (`reparto-de-spawns.ts`, `materializar-spawn.ts`), ¿por qué sale del tile?
   - Si el motor real puede producirlo, es un bug de producto.
2. **¿Qué significa «incompleta» y por qué ocupa toda la pantalla?**
   - ¿El save pierde entities al reanudar (descartadas por fuera de tile)?
   - ¿La pantalla es proporcionada, o un aviso de ese tamaño por un NPC mal colocado es excesivo? Fail-loud no es lo mismo que bloquear la partida.
3. **Arreglo en la causa.** Un spawn nunca cae fuera del tile donde se genera: se reparte dentro, o va al tile vecino de forma explícita. Tocar el mensaje no basta.
4. **Test que lo pruebe en negativo**, y el guion 351 (o uno nuevo) sin el workaround.

## Restricciones de la sesión

- NUNCA `git stash`.
- No matar servidores ajenos. **El usuario juega con un stack `play` en los puertos por defecto**: no se toca. `qa/run.mjs` elige su propio bloque.
- NO hacer `git pull` en el árbol principal `/home/al/code/ne-fan`.
- No tocar el tag `mutacion-ultima` ni `reports/mutation/`.
- Tandas en paralelo: BX (en QA), BY (saltar) y BZ (`available_assets`, `fake-ai-server.ts`).

## Ajustes tras la crítica (decisión del coordinador)

Se acepta el reencuadre entero: arreglo en core (acotar la posición resuelta al tile de la escena activa, en las tres llamadas), sin tocar el motor falso, el rótulo ni entidadesFueraDelMundo; «al tile vecino» fuera; el workaround del guion 351 se retira cuando BX esté en main (lo hace el coordinador o la tanda que venga). «Forward siempre norte» y «se ignora el texto del hint» NO entran aquí: van a la tanda siguiente (el coordinador la abre), no a un issue.


> **Premisa corregida (crítica):** no es del banco. La posición la decide core (`resolvePositionHint`, `consequence-handler.ts`): jugador + forward×5 (`near_player`) o ×10 (cualquier hint libre, que es lo que el prompt enseña al motor real). El forward vale el norte fijo en `dialogue.ts:82`, `context.ts:650` y `despertar.ts:236`. No hay recorte al tile. El motor real lo produce hablando a menos de ~10 m del borde norte.
>
> 3. **Arreglo en la causa (core):** ningún spawn de `dispatchConsequences` cae fuera del rect del tile activo, sea cual sea el hint, en las tres llamadas. Queda descartado mandarlo al tile vecino, porque choca con #382. No se toca el motor falso, ni el rótulo, ni `entidadesFueraDelMundo`: el aviso sigue siendo pantalla completa para un save corrupto.
> 4. **Test en negativo** en core, con el jugador junto a cada borde y los tres tipos de hint (`near_player`, texto libre, `distant_*`), que se ponga rojo sin el arreglo. Quitar el workaround del guion 351 **solo si BX ya está en main**. Si no, se deja apuntado para después.
> **Fuera de alcance:** el forward fijo al norte y que se ignore el texto del hint. Si hacen falta, van a un issue aparte.
