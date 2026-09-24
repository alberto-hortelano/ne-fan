# Requisitos — tanda BD: narrative-state y session-storage entran en la mutación (#430)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

## Decisión del usuario (AskUserQuestion, 2026-09-24)

«#430: … ¿Qué hacemos?» → **«Entran sin medir (Recomendado)»**: entran con break «sin medir»; el suelo se fija con la próxima corrida que el usuario autorice. Cierra el issue.

## Triaje previo (2026-09-24)

| 430 | DECISIÓN | M | — | `mutation-targets.json:981-982` sigue excluyendo `!narrative-state.ts` y `!session-storage.ts`. Con tap-runner (#597) el coste bajó un 64 %. Pregunta: «¿(a) entran con `break:"sin medir"` y se pide la corrida, o (b) se cierra con el número?». Recomiendo (a) |

## El issue, verbatim

> narrative-state y session-storage estan fuera de la mutacion por el coste de su bateria, no por sus mutantes
> 
> > **Cuerpo remedido el 2026-09-15.** Las tres cifras del original habían caducado o eran falsas; están sustituidas, no anotadas al pie, porque un agente lee el cuerpo y no los comentarios.
> 
> Sale de T10 (#340). `src/narrative/narrative-state.ts` y `src/narrative/session-storage.ts` quedaron **excluidos** de la totalidad de mutación de `src/narrative` con `!ruta` y motivo escrito; este issue es ese motivo, con dueño.
> 
> ## Por qué están fuera
> 
> No es por sus mutantes: es por el **coste de su batería**. Con `coverageAnalysis: "off"`, cada mutante paga la suite entera de su módulo.
> 
> | fichero | ficheros de test en su batería (`testsQueImportan`, medido el 2026-09-15) |
> |---|---|
> | `src/narrative/narrative-state.ts` | **19** (eran 18 el 2026-09-04: sube ~1 por semana) |
> | `src/narrative/session-storage.ts` | **16** |
> 
> Y no es un rincón frío: `narrative-state.ts` tiene dentro **la carga y la escritura del save**, con los gates de contrato que metió #338 — lógica de la que depende que un save corrupto no reviva a ciegas.
> 
> ## Las tres cifras que este cuerpo publicaba y eran falsas
> 
> 1. **«~900 mutantes»** — nadie los ha contado. El plan del mismo día decía ~675. **Sigue sin medirse**, y medirlo es justo lo que compra la decisión: `permisoLocal` rechaza el coste desconocido, así que la primera medida no se puede hacer en local.
> 2. **«18 ficheros de test»** — hoy son **19**.
> 3. **«arriesga el `timeout-minutes: 180`»** — **ya no tiene sujeto**: desde #438 la corrida va partida en matriz y el techo es de **60 min por lote** (#571), no 180 por corrida.
> 
> ## Las dos vías del original, revisadas
> 
> - **Reducir la batería por sujeto** — sigue viva, pero **medida y cara en rigor**: en `npc-director` bajó el reloj un 85 % **y perdió un mutante** cuyo único verdugo vivía en otro fichero.
> - **`coverageAnalysis` distinto de `off`** — contestado y **muerto por ahora**: `perTest` es no-op con el runner actual (#446) y el cambio de runner se midió y se rechazó (#443), porque `tap-runner` deja 26 muertes fuera del denominador (#597).
> 
> ## Lo que queda por decidir, y es del usuario
> 
> Con el runner sin cambiar, meter estos dos ficheros cuesta lo que cuesta su batería, una vez por mutante:
> 
> - **(a)** entran y se paga lo que cueste;
> - **(b)** se declara aparcado **por escrito y con el número**, reescribiendo el motivo de la exclusión con la cifra que lo justifique — que es lo que exige la totalidad del reparto;
> - (c) recortar la batería a mano queda **descartado** por lo de `npc-director`.
> 
> **Aviso que cambia el cálculo**: si se arreglan los 26 de #597, el runner nuevo vuelve a la mesa y con él un **−63,4 % de reloj de CPU medido** (12.492 s → 4.566 s en la corrida completa, con `scene-validate` a la mitad y el score idéntico). Con esa rebaja, esta pregunta se responde sola. **Mirar #597 antes de pagar por (a) o resignarse a (b).**
> 
> ## Criterio de cierre
> 
> Los dos ficheros salen de las exclusiones `!ruta` de su módulo y entran en uno medible, con su primera medida en la huella y su `break` puesto. O, si se decide que no compensa, el motivo se reescribe **con el número** y este issue se cierra diciendo cuál es.
> 
> Relacionado: #597, #443, #340 (la totalidad), #429, #431.
> 

## Restricciones

- Números de guion RESERVADOS: 206-209. Otras tandas en paralelo: AX atlas, AY lint qa/labs, AZ clientes WS del banco, BA skins/tema UI, BB título, BC bases de mutación y anclas (`qa/mutacion-*`).
- Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node`. Cero créditos.
