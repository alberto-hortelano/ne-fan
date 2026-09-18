## La petición, literal

El usuario, el 2026-09-18 (sesión nueva, `main` = `a25d8c2f`):

> «Mira los issues que hay en github y ve cerrandolos, si tienes alguna duda dejala apuntada para
> mas tarde y trabaja de forma autonoma con la estructura de agentes definida.»

Sigue en pie el mandato del 2026-09-17: «ve cerrando sin parar, si tienes bloqueo en alguno lo
apuntas pero sigue hasta reducir el numero al minimo».

Decisión del coordinador para esta jornada: **ciclo completo con fase de QA** (crítico → arquitecto →
ingeniero → QA), porque QA es quien lleva nueve tandas cazando los candados que cubren menos de lo
que prometen. El usuario no está mirando en tiempo real: las dudas se APUNTAN (en `requisitos.md`,
sección «Preguntas abiertas», con la suposición que se toma) y se sigue.

## Estado medido al abrir

- `main` = `a25d8c2f`, árbol limpio, un solo worktree, máquina en reposo (load 0,2).
- Backlog: **37 abiertos = 25 núcleo + 12 `futuro`**. Esta jornada abre 14 tandas EN PARALELO
  (S…AF) sobre los 19 issues de núcleo no bloqueados; las otras tandas tocan OTROS ficheros, pero
  dos pueden rozarse en `qa/README.md`, en `qa/run.mjs` y en la numeración de guiones (#680: el
  número de guion se elige al fusionar, no al escribir; hasta que la tanda U cande el prefijo
  único, un guion nuevo lleva el número que le toque en `main` EN EL MOMENTO DE FUSIONAR).
- Batería de navegador: NO medida hoy al abrir. Última conocida: 145 verde · 0 rojo · 1 ⊘ de 146
  sobre `900b5b71` (ayer por la mañana); desde entonces entraron los guiones 148 y 149. Quien
  toque `qa/` mide lo que toca, aislado y en par (tres corridas de cada) antes de la completa.
- Las dos últimas corridas de mutación (`35317748262` y `35354800866`) salen COMPLETAS con 0
  nuevos y **dos suelos rotos conocidos** (#675 `npc-director` 75,33 % < 81; #676
  `state-http-dispatch` 99,28 % < 100): el gate de mutación está en rojo por eso y no distingue
  un rojo nuevo. La tanda T los cierra.

## Restricciones de la casa que aplican a TODAS las tandas

- Cero créditos: motor falso, presets `e2e-sin-creditos` y `html-fixtures`. Nada que llame a
  Imagen IA ni al motor real.
- Nunca `--parar-todo`, nunca `pkill`, nunca matar por puerto: hay otros agentes en la máquina.
  Solo `NEFAN_PORT_OFFSET=<n> ./start.sh --parar` desde el propio worktree. **Gotcha vivo (#684)**:
  con offset ≥ 1000 `--parar` MIENTE («nada que parar aquí» con el stack en pie); por eso hoy los
  offsets se reparten entre 100 y 900. Si te toca uno ≥ 1000, para por PID demostrando propiedad
  con `/proc/<pid>/cwd`.
- Ningún umbral se baja, y ninguno se sube para acomodar lo que acaba de crecer.
- Pre-producción: cero compatibilidad hacia atrás. Lo que se retira, se retira entero el mismo
  día (`grep` a cero en prosa, comentarios y docs).
- Un candado nuevo se prueba EN NEGATIVO (se reintroduce el defecto y se ve el rojo) y se declara
  por escrito lo que NO cubre. Un candado headless nuevo entra en `candados-headless` el día que nace.
- El worktree se monta con la receta de `docs/agents/README.md` (los cuatro `npm ci`, el build de
  `nefan-core`, las hojas de sprites). El fichero de salida de una corrida larga lleva el nombre
  del worktree.
- Cada afirmación factual del issue se VERIFICA contra el árbol antes de usarse como requisito:
  los cuerpos citan `fichero:línea` que caducan en horas.
- No se commitea en `main` ni se fusiona nada sin que el coordinador lo pida; el ingeniero trabaja
  en su rama y commitea en ella.

# Tanda T — «Los dos suelos rotos se recuperan sin tocar el contrato» (#675 + #676)

## Los issues

- **#675**: `npc-director` sale a 75,33 % (37 vivos de 150) contra su break 81 porque #598a metió
  `place-target.ts` en su batería (18 vivos de 35, primera medida real). Matar **9** de esos 18
  devuelve el módulo a 81,33 %. Dos corridas independientes dan el MISMO 37/150 mutante a mutante.
- **#676**: `state-http-dispatch` 1 vivo de 139 (99,28 % < 100): el `StringLiteral` del mensaje
  del 404 de `noSession` (`bridge/state-http/dispatch.ts:134`) vaciado sale verde.

Los supervivientes con línea y columna están en `nefan-core/reports/mutation/` si la descarga de
la corrida `35354800866` sigue ahí, y en `nefan-core/data/contract/mutacion-huella.json`.

## Criterios de aceptación

1. Tests que MATAN al menos 9 de los 18 supervivientes de `place-target.ts` y el del 404, escritos
   como REGLA y no como lista de literales (precedente: `style-upload` el 2026-09-10 mató 18 de una
   vez candando una regla). Para el 404: que el cuerpo del error nombre la ruta pedida y dé una
   salida, no la cadena entera copiada.
2. Ningún `break` se baja; `tope_local` no se sube. El módulo `npc-director` (150 mutantes) NO cabe
   en `local`: la verificación local de que un test mata un mutante se hace a mano (aplicar el
   mutante al fuente, ver el test en rojo, revertir) para una muestra representativa, y se PIDE la
   corrida (`npm run mutacion -- pendiente` para saber qué falta) sin esperarla.
   `state-http-dispatch` (139) tampoco cabe: misma técnica.
3. `npm run verify` verde, `npm run ejercicio` verde, cobertura y CRAP sin empeorar.
4. El informe dice con qué mutantes se comprobó a mano el rojo (el «matado» se demuestra, no se afirma).

## Fuera de alcance

- Sacar `place-target.ts` del módulo, o mover cifras del contrato.
- Arreglar la conducta de `resolvePlaceTarget` (#646, bloqueado).

## Preguntas abiertas

- La corrida autorizada la lanza el usuario (Actions → Mutation testing → Run workflow). Se deja
  pedida en el informe y en la PR; el cierre de los issues espera a ESA corrida, no a la tanda.

## Reencuadre del crítico (REENCUADRADA, 2026-09-18), aceptado por el coordinador

El reencuadre no cambia QUÉ se construye (tests que recuperan los dos suelos sin mover cifras) sino DÓNDE está el agujero; por eso el coordinador lo acepta sin consultar al usuario y lo deja apuntado. El criterio 1 original queda SUSTITUIDO por:


1. `place-target.ts`: los 18 «supervivientes» son 4 `Survived` + **14 `NoCoverage`** (dos ramas del contrato
   del docblock `place-target.ts:3-6` que ningún test entra: anchor sin `rect` → centro del tile, línea 28; y
   `realized_scene_id` tile → centro del tile, líneas 31-35). Los tests se escriben sobre ESA regla —las tres
   vías de resolución y los dos `null` (place inexistente, realizado que no es tile)—, con fixtures en un tile
   `tx≠0, ty≠0` para que la aritmética del centro no sobreviva por simetría. Objetivo: los 18, que dejan el
   módulo en 87,33 %; el mínimo que recupera el suelo son 9.
   `dispatch.ts`: el mutante vivo es `134:9-134:97`, el fragmento de las **causas** del 404 («ni start_session
   ni resume_session han corrido, o el save se borró»). La ruta y la salida YA se afirman en
   `test/state-http-dispatch.test.ts:744,766-767` y no lo matan. La regla nueva: **todo `no_session` (404 y
   409) nombra las dos causas**; el 409 (`dispatch.ts:114`) hoy muere solo porque `/No se ha aplicado nada/`
   cruza un salto de línea, así que la misma regla lo sujeta de verdad.

Y en «Fuera de alcance» añadir: «Subir el `break` de `npc-director`: se decide al repartir la corrida, con el
número medido.»

Dato del crítico: los informes de la corrida 35354800866 están en nefan-core/reports/mutation/ (corrida.json sha e8bd1f02, npc-director.json y state-http-dispatch.json con línea:columna); la huella solo guarda hashes.
