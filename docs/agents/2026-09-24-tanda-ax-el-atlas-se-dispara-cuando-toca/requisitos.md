# Requisitos — tanda AX: El atlas se dispara cuando toca: estilo tardío, menú dev y la carrera del 106 (#730 #729 #754)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye. Si un issue resulta obsoleto o ya resuelto, se dice con evidencia y se cierra: también cuenta.

## Los issues, verbatim

### #730

> Nadie vuelve a disparar el atlas del activo (ni la restauración de los vecinos) si el estilo llega después que la escena
> 
> **«Nadie vuelve a disparar el atlas del activo si el estilo llega después que la escena»**: el comentario citaba `applySessionReady()`, que no existe (`grep` a cero). Falta comprobarlo en partida nueva. Lo mismo pasa con la restauración de los vecinos (H4 de QA): si un tile no activo se restaura sin `styleId`, `ejecutarRestauracion` devuelve «nada» y nadie vuelve a encolarlo cuando llega el estilo, así que se queda en clay hasta que alguien lo reinstale o el jugador lo pise.
> 
> Sale de la tanda AI (#714).

### #729

> Generar desde el menú dev un tile que no es el activo desecha el atlas del jugador (#390 por otra puerta)
> 
> **«Generar desde el menú dev un tile que no es el activo desecha el atlas del jugador»**: `pendientes().generar` llama a `runFor(key)` → `nuevoRun` y supera la corrida del activo en vuelo. Es #390 por otra puerta.
> 
> Sale de la tanda AI (#714).

### #754

> Guion 106 intermitente (≈2 de 12): el atlas pintado del caso anterior se restaura de localStorage y el caso «Imagen IA + personajes en maqueta» no manda POST
> 
> Lo midió la tanda AS el 2026-09-24: 2 rojos de 12 en `main` (2d411d11) y 3 de 12 en la rama, con el mismo script. Todos los rojos caen en el mismo caso, «Imagen IA en escenarios + personajes de vuelta a maqueta».
> 
> **Causa, medida instrumentando el HUD:**
> - El caso anterior pinta el atlas y lo guarda en `localStorage` (`fps_atlas:*`) de forma asíncrona.
> - Esa escritura compite con el reload del caso siguiente.
> - El caso 3 restaura el atlas de ahí (`Atlas fps de tile_0_0 restaurado (mapping local, $0)`) sin mandar ningún POST, así que la puerta que espera el guion no se abre.
> - No es #730: el estilo ya está puesto.
> 
> **Arreglo probado, 12 de 12 en verde:** borrar las claves `fps_atlas:*` **después** de `recargarAlTitulo` en `partidaCon` del 106. Borrarlas antes del reload no basta, porque el pintado que sigue en vuelo las vuelve a escribir.
> 
> Hay una pregunta de fondo: ¿debería un reload esperar o cancelar la escritura en vuelo del atlas? Un jugador que recarga a mitad de pintado podría encontrarse un mapping a medias.

## Criterios de aceptación

Los fija el crítico en critica.md a partir de los issues. Mínimos: lógica en nefan-core (el cliente solo pinta); negativos probados en rojo; guion de QA ejecutable si hay algo observable; cero créditos (motor falso, `e2e-sin-creditos`).

**Aceptados por el coordinador (texto de `critica.md`, tal cual):**

> **#730 — se cierra, no se construye re-disparo.** El orden `session_started` → escena lo garantiza el bridge (`handlers/session.ts:492-567`) y el cliente aplica el estilo en el microtask de la respuesta, antes de cualquier escena; resume igual. Entregable: (a) un test que se ponga ROJO si el bridge difunde una escena de la sesión antes de su `session_started` (probado en negativo), y (b) fuera el comentario «no está verificado» de `fps-atlas.ts:161-167` y el rótulo «en espera del estilo», que promete una espera que nadie cumple. Texto para el issue: «Inalcanzable: el bridge manda session_started antes de difundir escena y el cliente fija el estilo en esa continuación; candado del orden en la PR X.»
>
> **#729 — reencuadrado:** una corrida de un tile no puede dejar sin aplicar la de OTRO tile. Criterios, con test en core rojo antes del arreglo: (1) una generación manual de X en vuelo cuando se activa Y → al terminar, X tiene su arte aplicado y Y el suyo; (2) una manual de X lanzada durante la fase memoria/mapping del activo Y → ídem; (3) la MISMA clave sigue sin pagarse dos veces (regla de 2026-08-14 intacta); (4) el tile activo nuevo sigue superando al activo viejo (#390 intacta). Guion de QA 182 en `produccion`, motor falso: menú dev sobre un vecino + cruce de tile, y se afirman los dos tiles con textura. La decisión vive en `PoliticaDeAtlas`; el menú no cambia.
>
> **#754 — vigente, solo guion:** en `partidaCon` del 106, borrar `fps_atlas:*` DESPUÉS de `recargarAlTitulo`, con un comentario que diga por qué después. Criterio: 12 de 12 en verde en dos tandas, y el caso 3 sigue abriendo la puerta del atlas (el aserto positivo no se relaja). La pregunta de fondo se contesta en el issue: no hay mapping a medias posible (escritura única del atlas completo) y un reload no pierde arte pagado; no se toca producción.

**Lectura del criterio (4) de #729, decidida por el coordinador (2026-09-24):** «el tile activo nuevo sigue superando al activo viejo» describe el MECANISMO de antes (token global). Con la vigencia por clave, la corrida del activo viejo ya no se descarta: termina y aplica a SU tile. El criterio se lee como **«el activo nuevo nunca espera ni se descarta por una corrida de otro tile»** — descartar arte de otro tile es justo el bug de #729.

**Estilo antes del siguiente mensaje (decisión del coordinador):** que el cliente fije el estilo antes de procesar el siguiente mensaje del bridge lo cubre el guion 183, para no abrir issue.

Guiones reservados: 182-185. La tanda BA (en paralelo) toca `character-sprites.ts` y el tema de UI: no se tocan.

## Restricciones

- **Números de guion RESERVADOS para esta tanda: 182-185.** Hay otras tandas en paralelo; no uses otro número.
- Contexto de hoy: `NEFAN_ENTORNO` (#757) decide si lo automático paga arte (desarrollo: solo restaura; el banco mide en producción contra el motor falso).
- Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node` (v26).
