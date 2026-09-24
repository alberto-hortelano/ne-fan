# Requisitos — tanda BB: El clic del título no cae sobre un botón que se repinta (#731 #673)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye. Si un issue resulta obsoleto o ya resuelto, se dice con evidencia.

## Triaje previo (2026-09-24)

| 673 | HACEDERO | M | T1 | Probablemente el mismo mecanismo que #731: el rojo cae en `page.click("#ts-new")` después de la pre-generación. `home.ts:103` vuelve a crear el botón en cada repintado, y `esperarTituloListo` (`qa/lib/sesion.mjs:177-183`) solo espera a que haya texto, no a que el título se quede quieto |
| 731 | HACEDERO | M | T1 | `abrirSelectorDeMundos` hace `esperarTituloListo` y luego `click("#ts-new")` (`sesion.mjs:300-303`), mientras `home.ts` repinta con innerHTML. Puede que también le pase al jugador de verdad: un clic durante el repintado se pierde |

## Los issues, verbatim

### #731

> abrirSelectorDeMundos tras regenerarMundo pulsa #ts-new mientras el home se repinta: element was detached (≈1 de 9)
> 
> **«`abrirSelectorDeMundos` tras `regenerarMundo` pulsa `#ts-new` mientras el home se repinta»**: `page.click: … element was detached from the DOM`, 1 vez en unas 9 corridas del 160. El helper es compartido con el 07 y el 123.
> 
> QA de la tanda AI lo leyó así: el home se repinta dentro de un `paso()` async debajo del click; no apareció en 6 corridas de la misma secuencia. No es del cambio de #714 (`sesion.mjs` y el título no cambian).
> 
> Sale de la tanda AI (#714).

### #673

> El guion 15 se pone rojo 4 de 21 si su espera por fotogramas se conduce, y el rojo cae en un sitio que el cambio no toca
> 
> Sale de la tanda N (PR #672), y **está medido con el cambio puesto y quitado, sobre el mismo commit**.
> 
> ## El hecho
> 
> `qa/guiones/15-guardia-se-ve-y-se-comporta.mjs` tiene una **17ª** espera por fotogramas, escrita **inline** (fuera del alcance de #606, que censó los helpers con nombre). Migrarla al helper con dueño —`esperaDeFotogramas(...)` contra `reloj()` en vez de `fps()`— pone el guion:
> 
> | Versión | Resultado |
> |---|---|
> | Con la 17ª migrada | **rojo 4 de 21** |
> | La de siempre | **0 de 11** |
> 
> Alternando sobre el mismo commit y repetido tras un rebase.
> 
> ## Lo que lo hace un issue y no un arreglo
> 
> **El rojo cae siempre en `page.click("#ts-new")`, en el TÍTULO, tras la pre-generación de las 9 escenas.** El cambio vive en `encarar()`, mucho después. **No se encontró la vía causal.**
> 
> Se deshizo por el criterio del propio #634: **un rojo que va y viene enseña a ignorar la batería**, y eso cuesta más que la deuda que cierra. La espera entra como **séptima exención** en `data/contract/esperas-por-fotogramas.json` con este número escrito, así que el censo de #606 no la da por olvidada: la da por **conocida y aparcada**.
> 
> ## Por dónde tirar
> 
> - La firma —rojo en el título, después de una pre-generación, con el cambio en otra parte del guion— se parece a la familia de #496/#659: **una página que recibe algo de una sesión que no es la suya**. Conviene descartarlo antes que nada, y hay instrumento: **#659** tiene el sujeto (`state_update` sin `sessionId`) y el protocolo (guion aislado y en par, tres corridas de cada, **nunca la batería completa**).
> - Si no es eso, la pregunta siguiente es **qué cambia para el título que el guion mida contra `reloj()` en vez de contra `fps()`** en un punto posterior. Con el título delante `relojDeSim.avanza()` no se llama (`main.ts:665`), que es lo que ya obligó a mandar `79:153` a `"loop"` en la misma tanda.
> 
> ## Lo que NO hay que hacer
> 
> Migrarla otra vez «a ver si ahora va». Es la clase de rojo que se aprende a ignorar en dos semanas, y por eso está aparcado **con su número** en vez de con una intención.

## Criterios de aceptación

(Pegados del crítico, `critica.md`, aceptados por el coordinador: el arreglo va en el producto y no en el banco.)

**Encuadre (crítico, medido 2026-09-24).** #731 y #673 son UN defecto del producto,
no del banco. Cuando la pre-generación termina (`game_gen` `ready`/`error`), el título
pinta otra vez el selector (`title-screen.ts:148-156` → `selector-de-mundo.ts:174,193`)
tras un `await listGames()`, sin comprobar que el jugador siga en él. Si en esa
ventana el jugador ha salido («Volver», «Continuar»…), el selector pinta encima de la
pantalla nueva. Repro forzado: 3/3 en f25da654.

1. El refresco que sigue a una pre-generación no pinta nunca encima de una pantalla
   que el jugador ya ha dejado. Vale para cualquier salida del selector, no solo
   para «Volver».
2. Guion nuevo (número 198) que pulse «Volver» **en la misma tarea en que se publica
   `ready`** y afirme que la pantalla final es el home con `#ts-new` operativo. Ese
   aserto **no puede salir verde por ir rápido**: antes de afirmar, el guion tiene que
   observar que el refresco se resolvió, no esperar un tiempo. Negativo probado: rojo
   en f25da654 sin el arreglo.
3. En el banco no se añade ninguna espera de «título quieto» y
   `abrirSelectorDeMundos` y `regenerarMundo` no cambian.
4. #673: la 17ª espera del guion 15 vuelve a `esperaDeFotogramas(...)`, se borra su
   exención de `esperas-por-fotogramas.json` y el guion 15 corre aislado **21 veces
   con 0 rojos**, que son las mismas corridas del número que la aparcó. Se hace
   después del criterio 1, nunca antes.
5. Cero créditos (`e2e-sin-creditos`). Se cierran #731 y #673 desde la PR.

Añadido por el coordinador: la regla «¿sigue siendo esta pantalla la que está delante?»
vive en UN sitio que sirva para el selector, «Continuar» y «Subir estilo», y se mide si
esas dos salidas también fallan sin el arreglo.

## Restricciones

- **Números de guion RESERVADOS: 198-201.** Hay otras tandas en paralelo (AX atlas, AY lint de qa/labs, AZ clientes WS del banco y `qa/lib/cable.mjs`/`sesion.mjs`, BA skins y tema de UI).
- Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node`.
