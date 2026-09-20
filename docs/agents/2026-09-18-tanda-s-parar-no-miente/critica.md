# VIGENTE — el bug es exactamente el que dice el issue, y hoy sigue en el fichero; el alcance crece en prosa y el criterio 4 promete un CI que sus hermanos no tienen

## El problema real, en una frase

El único comando de parada que la casa autoriza (`--parar`) afirma «nada que parar» para cualquier stack arrancado con un offset que el propio launcher ACEPTA (1000..40000), porque el conjunto de puertos CANDIDATOS se calcula con una aritmética que anula el offset; la solución propuesta (que la parada por árbol no dependa del bloque) ataca ese dial y no otro.

## La premisa, afirmación por afirmación

| Afirmación del issue / requisitos | Verificación en `main` = `a25d8c2f` |
|---|---|
| El bucle está en `start.sh:1405-1407` | **Cierto hoy, mismas líneas**: `for off in 0 100 … 900` (1405) y `puertos+=("$(( base - PORT_OFFSET + off ))")` (1407) |
| `ALL_PORTS` ya viene desplazado | Cierto: `ALL_PORTS` (1346) se compone de `PORT_*`, y `read_ports` (46-62) emite `base + off` con `off = PORT_OFFSET` |
| El conjunto barrido es 0..900 pase lo que pase | Cierto; simulado sobre la aritmética literal del fichero con el puerto del bridge: offset 0/900 → lo encuentra; **1000 → barre 9877..10777 y el real es 10877; 1400 → real 11277**. Ninguno de los dos entra |
| «Dice “nada que parar aquí”» | Cierto: `alguno` solo se enciende al matar (1470); sin candidatos en la foto imprime 1472 y luego `✅ stack cleaned` (1493). Además el guardia de ajenos no puede salvarlo: `grupo_en_bloque_vigente` (1352) solo se evalúa sobre líneas ya enumeradas |
| `--parar` «ya resuelve el dueño por `/proc/<pid>/cwd` y por argumentos» | Cierto y es el punto clave: la propiedad la decide `foto_del_puerto` (272) → `worktree_de_pids` (235-243: `readlink /proc/$pid/cwd` y `/proc/$pid/cmdline` contra `$PROJECT_DIR/`). **El offset NO interviene en la propiedad; interviene solo en QUÉ puertos se preguntan.** El arreglo «no depender del offset» tiene sujeto, y es el filtro de candidatos de 1404-1408, no la prueba de propiedad |
| Requisitos: «no hay tope de offset escrito» | **Falso**: `start.sh:35` acepta `0..40000`. El tope existe; lo que no casa es que la subida admite 401 bloques y la parada mira 10 |
| «Hoy el comando se prueba solo con offset 0» | Casi: `qa/parar-clasifica-los-nueve-puertos.mjs:56` documenta `NEFAN_PORT_OFFSET=300`; ninguno ≥ 1000 |
| Los candados #393/#424/#428 «siguen verdes» es comprobable | Sí, pero **en local**: los dos guiones (`qa/no-mata-lo-ajeno.mjs`, `qa/parar-clasifica-los-nueve-puertos.mjs`) están EXENTOS de `candados-headless` (`nefan-core/data/contract/candados-headless.json:25-31`) porque ejecutan `./start.sh --parar` contra los puertos reales de la máquina |

## El día después

- **Para quien juega: nada.** Es infraestructura de desarrollo y el issue lo declara `bug`; no hace falta disfrazarlo.
- **Lo que se desbloquea de verdad**: hoy el coordinador ha capado los offsets a 100..900 por este bug (requisitos §restricciones), o sea **diez stacks por máquina** con catorce tandas en marcha. El arreglo levanta ese techo, que es más valor que el falso negativo en sí.
- **Una puerta que hay que decidir a la vista, no cerrar por accidente.** El criterio 1 dice «mejor, la parada por árbol no depende del offset… puede encontrar sus procesos sin adivinar en qué bloque están». Leído literal, cambia el SUJETO de `--parar` de «puertos del catálogo de este árbol» a «todo lo que escuche de este árbol»: se llevaría también a `game-emulator.mjs` (:9899), al replay-server o a cualquier `vite` suelto que no estén en el catálogo, y las dos candados de hoy afirman «los NUEVE puertos del catálogo». Que la propiedad la decida `/proc` no obliga a abandonar el catálogo como filtro: la foto `ss` (181-188) ya trae TODOS los puertos a la escucha de una vez, así que el filtro puede ser «del catálogo, en cualquier bloque» sin adivinar nada. Lo que **no** debe pasar es que el sujeto cambie sin que lo diga `requisitos.md`.
- **Lo que hay que borrar y nadie borrará**: la premisa «diez bloques» no vive solo en las dos líneas de docs del criterio 5. Está en la prosa de `start.sh` (164, 266, 1396, 1400-1403, 1475, 1481) y en la de los dos candados (`parar-clasifica…:29,241,257,295`; `no-mata-lo-ajeno:136,265`). Con «grep a cero» de la casa, la tarea es más grande que el issue.
- **Lo que NO es lo mismo y no hay que tocar**: `qa/run.mjs:274-295` también recorre `0..900`, pero eso es la POLÍTICA del banco para elegir bloque libre, no una afirmación sobre `--parar`; su mensaje «los diez bloques… están ocupados» sigue siendo cierto de sí mismo. Y `parar-clasifica…:270` recorre `0..900` para PLANTAR un ajeno, no para medir el barrido: tampoco es el bug.
- **Lo arbitrario dentro de un mes**: si el arreglo deriva los candidatos de `0..40000`, alguien preguntará de dónde sale ese 40000; hoy no está justificado ni en `start.sh:35` ni en `runtime_config`. No es de esta tarea justificarlo, pero el ingeniero no debe copiarlo a un segundo sitio.

## Conflictos

- **#683** (dónde vive el material ejecutable de una QA): roza el criterio 4. La forma natural del candado —levantar un señuelo en un bloque alto y correr `--parar`— es EXACTAMENTE la de los dos guiones ya exentos, y por el mismo motivo escrito quedaría fuera de CI. El criterio 4 dice «si es headless, entra en `candados-headless`», que aquí no se puede cumplir tal cual: o se declara exento con el motivo de sus hermanos, o se inventa un sujeto sin puertos reales (extraer la aritmética de candidatos a algo medible sin `ss`). No es contradicción, es una decisión que el criterio da por hecha.
- **Solapamiento barato con el candado existente**: `parar-clasifica-los-nueve-puertos.mjs` planta sus señuelos en `base + offsetActual()` (`qa/lib/stack.mjs:75`) y comprueba que `--parar` los mata. Corrido con `NEFAN_PORT_OFFSET=1000` **debería salir rojo hoy** (los señuelos quedan fuera del conjunto 0..900 y ni se enumeran). Si eso se confirma, el «candado nuevo» puede ser ese guion corrido en un bloque alto, y la prueba en negativo la da el fichero de hoy sin escribir nada. No lo he corrido (prohibido arrancar `--parar` en este checkout con otros trece críticos en paralelo): queda como hipótesis para el ingeniero, con esas dos líneas de evidencia.
- **Tandas del día**: toca `CLAUDE.md:123` y `docs/agents/README.md:65`; ninguna otra tanda tiene motivo para tocar esas dos líneas. `git log -- start.sh`: último cambio de `cmd_stop` en `846abce0` (#424/#428) y `8aa3f9f2` (#393); nadie más lo tiene abierto.
- Ninguna decisión de `CLAUDE.md` ni candado de `arch-rules.json` se opone; «arrancar no mata a nadie» y «matar por PID» se conservan porque la propiedad no cambia.

## Coste contra valor

Coste: unas líneas de bash en un sitio ya candado dos veces, más barrido de prosa en cinco ficheros. Valor: el techo de diez stacks por máquina desaparece y el comando autorizado deja de afirmar en falso. «No hacer nada» = seguir repartiendo offsets ≤ 900 a mano y parar por PID cuando se acaben; es lo que hizo la QA de #656 y lo que hace hoy el coordinador: funciona, pero es el workaround que la casa cuenta como hallazgo. Se hace.

## Qué le cambiaría a `requisitos.md` (para pegar)

- En «Preguntas abiertas», sustituir la suposición: «El tope SÍ está escrito: `start.sh:35` acepta `NEFAN_PORT_OFFSET` de 0 a 40000. El arreglo no puede mirar menos bloques de los que la subida acepta arrancar, y no copia el 40000 a un segundo sitio».
- Criterio 1, añadir: «El SUJETO de `--parar` sigue siendo “puertos del catálogo de este árbol”. Si el arreglo lo amplía a cualquier puerto de este árbol (game-emulator :9899, replay-server, un vite suelto), lo declara aquí y en CLAUDE.md; no cambia en silencio».
- Criterio 4, reescribir: «Candado: se demuestra que `--parar` para un stack propio en un bloque ≥ 1000. Primero se comprueba si `qa/parar-clasifica-los-nueve-puertos.mjs` con `NEFAN_PORT_OFFSET=1000` ya sale rojo sobre el `start.sh` de hoy: si es así, el candado es ese guion en bloque alto (y su cabecera deja de decir “diez bloques”), no un fichero nuevo. Sea cual sea la forma, si ejecuta `./start.sh --parar` sobre puertos reales queda EXENTO de `candados-headless` con el motivo de sus hermanos (`candados-headless.json:25-31`) y se dice; solo entra en CI una parte cuyo sujeto no sean los puertos de la máquina».
- Criterio 5, ampliar: «“diez bloques” / “90 puertos” a cero también en la prosa de `start.sh` (164, 266, 1396, 1400-1403, 1475, 1481) y de los dos candados de `qa/`. NO se toca el `0..900` de `qa/run.mjs:274-295` (política de elección de bloque del banco) ni el de `parar-clasifica…:270` (dónde plantar un ajeno): no son el bug».
