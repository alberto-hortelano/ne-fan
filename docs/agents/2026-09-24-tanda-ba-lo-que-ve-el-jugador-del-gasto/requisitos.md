# Requisitos — tanda BA: Lo que ve el jugador del gasto de skins y el muro de fallo en tema claro (#755 #756 #748)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye. Si un issue resulta obsoleto o ya resuelto, se dice con evidencia y se cierra: también cuenta.

## Los issues, verbatim

### #755

> La línea de balance de skins cuenta animaciones y el jugador cuenta personajes («15 sin arte pagado» con 5 NPC)
> 
> Sale de la QA de la tanda AS (2026-09-24).
> 
> En desarrollo, el registro dice «Skins: 0 anim(s) restaurada(s) de la librería ($0), 15 sin arte pagado (base y_bot)» con 5 personajes en escena. En el guion 179 dice «9 sin arte» con 3. «anim(s)» es jerga del gestor de skins.
> 
> **Propuesta:** contar PERSONAJES (restaurados, parciales y sin arte) en `nefan-html/src/renderer/cadena-de-skins.ts`, y dejar el recuento por animación para la traza de desarrollo.
> 
> **Aparte, y anterior a esta tanda:** el registro se pinta en gris claro sobre el suelo verde y cuesta leerlo (captura del bloque 1 del 179).
> 
> **Criterio:** la línea nombra personajes, y un guion la comprueba contra el número de NPC en escena.

### #756

> Forzar un skin desde el menú dev paga también sus animaciones lazy sin avisar
> 
> Sale de la QA de la tanda AS (2026-09-24).
> 
> Al pulsar «Generar» sobre un personaje en el menú dev, queda `state.forzado = true` (`nefan-html/src/renderer/character-sprites.ts`). Desde ese momento, sus animaciones lazy (ataques, muerte…, que encola `modelFor`) se generan cuando aparecen, sin nueva confirmación y mientras dure la pestaña. El botón solo avisa «¿Confirmar? Gastará créditos», sin decir que el gasto sigue después del set inicial.
> 
> Hay dos salidas:
> - **(a)** Anunciarlo en el botón y en la fila del menú: «este personaje y las animaciones que use».
> - **(b)** Que el forzado cubra solo el set automático, y que las lazy vuelvan a restaurar solo lo pagado.
> 
> **Criterio:** un guion en desarrollo fuerza un skin, lleva al personaje a una animación lazy y comprueba el desenlace elegido en los contadores del motor falso.

### #748

> Muro de fallo en tema claro: hueco doble antes de «Cerrar» y botón con poco contraste en acuarela_luminosa
> 
> La QA de la tanda AT (#737) lo vio en las capturas, y ya existía antes del cambio.
> 
> - En el muro de fallo con tema claro, el espacio entre el detalle y «Cerrar» es el doble que el que hay entre el título y el detalle. La causa es que `.elapsed`, aunque esté vacío, sigue ocupando su hueco del `gap`.
> - El botón «Cerrar» tiene poco contraste en `acuarela_luminosa`.
> 
> Captura: guion 174, paso 02.

## Criterios de aceptación

Los fija el crítico en critica.md a partir de los issues. Mínimos: lógica en nefan-core (el cliente solo pinta); negativos probados en rojo; guion de QA ejecutable si hay algo observable; cero créditos (motor falso, `e2e-sin-creditos`).

Decisiones del coordinador (2026-09-24): #756 va por la salida **(b)** (decisión del usuario del mismo día: en desarrollo lo automático solo restaura). La legibilidad del registro sobre la escena **entra en esta tanda** (criterio 5) porque es barata y se canda con el mismo test de tema que #748. Criterios del crítico, con los ajustes del arquitecto marcados «(arq)»:

1. **#755**: la línea de balance cuenta PERSONAJES (skins distintos por prompt, jugador incluido), separando restaurados, a medias y sin arte, sin la palabra «anim». Una anim lazy que vuelve (sin arte o restaurada) de un personaje ya contado en ESTA partida NO produce otra línea que lo cuente de nuevo (arq: el recuerdo de «ya contado» se olvida al entrar o reanudar una partida, no con el `force` del menú dev). El guion lo comprueba contra `__nefan.skins` (prompts distintos), no contra el número de NPC. El texto sale de una función pura con test. En negativo: devolver el recuento por anim pone rojo el guion.
2. **#756, salida (b)**: `force` paga el set automático (idle/walk/run) del personaje. Sus anims lazy, con permiso `restaurar`, piden `resolve_only` igual que las de cualquier otro. Con permiso `generar` (producción) nada cambia. La regla es un predicado de core junto a `gatesDeImagen` (arq). Guion en desarrollo, contra el motor falso: forzar un skin da Δ pagos `/skin_sprite_sheet` = 3; llevar a ese personaje a una anim lazy (el jugador atacando) da Δ pagos 0 y un POST de esa anim con `resolve_only`. En negativo: con `forzado` de vuelta en `resolveOnly`, el guion se pone rojo.
3. **#748** (arq: reencuadrado sobre la medida de los cinco packs; el `fade` falla también para el título de fallo en cuatro packs y para el borde en los cinco, así que el muro pasa a pintarse sobre un PANEL `surface`, que es el par que ya mide el test de tema):
   - el hueco entre el detalle y el primer botón visible del muro de fallo es igual (±1 px) al que hay entre el título y el detalle, medido en el DOM del guion;
   - el contenido del muro va sobre `surface`, y los botones del muro son la acción principal RELLENA (`accent` de fondo, `accent_ink` de texto). `ui-theme.test.ts` mide en los cinco packs, contra la pila real del muro (`surface` sobre `fade` al 82 %): título de fallo `danger` ≥ 3, título de espera/oferta `accent` ≥ 3, detalle `ink_dim` ≥ 3, silueta del botón `accent` ≥ 3 y su texto `accent_ink/accent` ≥ 4,5. Hoy es rojo (`danger` en `medievo_crudo` 2,66 y `sombra_de_cuento` 2,56);
   - el guion comprueba en el DOM, pack a pack, que el muro y su botón usan esos tokens (estilo calculado), y captura el muro en `anime` y `acuarela_luminosa`.
4. #755 y #756 van en el mismo cambio (misma cadena). No se tocan `fps-atlas.ts` ni `dev-menu.ts` (tanda AX).
5. **Registro legible** (arq, sale del «aparte» de #755): cada línea de `#combat-log` se pinta sobre `surface` con texto `ink` (par ya medido ≥ 4,5 en los cinco packs). El guion lo comprueba por estilo calculado y captura el registro sobre el suelo del tile en `acuarela_luminosa`. En negativo: quitar el fondo de la línea pone rojo el guion.

## Restricciones

- **Números de guion RESERVADOS para esta tanda: 194-197.** Hay otras tandas en paralelo; no uses otro número.
- Contexto de hoy: `NEFAN_ENTORNO` (#757) decide si lo automático paga arte (desarrollo: solo restaura; el banco mide en producción contra el motor falso).
- Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node` (v26).
