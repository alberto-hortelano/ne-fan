# QA — Tanda S · «`--parar` no miente con ningún offset» (#684)

Validado el 2026-09-20 sobre `feature/tanda-s-parar-no-miente` = `e9692c9f` (base `a25d8c2f`), en el
worktree `/home/al/code/ne-fan-tanda-s-parar-no-miente`. Máquina compartida: carga 17-24, benches de
otras tandas ciclando en +0, +200, +300, +600 (comprobado con `ss -ltnp` + `/proc/<pid>/cwd` antes de
arrancar nada). Mi stack real fue en **+1300**; los guiones en **+1300** y **+900**; el bloque 10 del
candado eligió solo el **+1000**. Cero créditos (solo `html-fixtures` y señuelos TCP mudos). Nunca
`pkill`, nunca `--parar-todo`, nunca matar por puerto: lo mío lo maté con `--parar` o por PID tras leer
su `cmdline`.

## Criterios → veredicto → evidencia

| Criterio (de `requisitos.md`, con las decisiones del coordinador) | Veredicto | Evidencia |
|---|---|---|
| C1 · `--parar` encuentra y para lo de ESTE árbol con cualquier offset que la subida acepte, incluidos ≥ 1000; sin bucle fijo | ✅ cumple | Flujo real: `NEFAN_PORT_OFFSET=1300 ./start.sh --preset html-fixtures` → vite en `:4300` (pid 263657, cwd `…/ne-fan-tanda-s-parar-no-miente/nefan-html`). `NEFAN_PORT_OFFSET=1300 ./start.sh --parar` → `· :4300 … node /home/al/code/ne-fan-tanda-s-parar-no-m`, `✅ stack cleaned`, 1,30 s; después `:4300 LIBRE`, pid muerto. Repetido una segunda vez (pid 274816): 1,09 s, mismo resultado. Los candidatos salen de la foto de `ss` filtrada por `offset_admisible` (`start.sh` diff, `cmd_stop`): el bucle `0 100 … 900` ya no existe (`grep` a cero) |
| C1 · el sujeto sigue siendo «catálogo de este árbol», no cualquier puerto propio | ✅ cumple (con reserva de documentación, H2) | Retícula calculada: 3.308 puertos = 9 bases × 401 offsets − solape `fake_ai = ai_server + 10000`; `:9899` (game-emulator) queda **fuera** (ninguna diferencia con las 9 bases es múltiplo de 100); `:5173` (vite por defecto) fuera. Pero `:3100`, `:8000` (= html+100 / html+5000) y `:24678` (= state_api+14800) **dentro**: un proceso de este árbol ahí SE PARA. Aceptable —indistinguible del mismo servicio en un bloque legítimo— pero solo está escrito en `implementacion.md` (gitignored) y el comentario de `start.sh` dice lo contrario. Ver H2 |
| C2 · no toca nada ajeno; #393/#424/#428 siguen verdes | ✅ cumple | Adversarial 4: con mi vite propio en `:4300` y DOS ajenos míos desde `/tmp` (`python3 -m http.server 10065` = ai_server+1300, MISMO bloque; y `8000` = html+5000, retícula sin bloque en uso), `--parar` 1300 mató solo `:4300`; los dos ajenos salieron `⏭ … — AJENO, no se toca` y seguían VIVOS y escuchando después. El aviso dijo `Para llevarte también lo ajeno DEL BLOQUE VIGENTE (+1300)` (correcto: el 10065 es del vigente). `node qa/no-mata-lo-ajeno.mjs` con offset 1300: **EXIT=0, 13 verdes**, incl. «aviso si y solo si ajenos DEL BLOQUE (0, no)» y «lo de OTROS bloques se dice (4, sí)». `qa/parar-clasifica…` con 1300 y con 900: **EXIT=0, 21 verdes cada uno**, incl. el ajeno del bloque +200 enumerado y vivo, y el intruso a mitad de barrido que sobrevive |
| C3 · «nada» solo cuando no hay nada; si hay y no puede, falla en voz alta | ✅ cumple la primera mitad; ⚠ la segunda no probada | Con `:4300` propio arriba el informe lo cita y no dice «nada». Sin nada propio: `(nada que parar aquí)` + `✅ stack cleaned` (medido tres veces: tras parar, con offset 0100, y en el paso E del escenario). El `start.sh` de `main` (`a25d8c2f`, copiado al árbol como `start-main-qa.sh` para que `PROJECT_DIR` sea el mismo) con offset 1300 y el `:4300` en pie dijo **`(nada que parar aquí)` / `✅ stack cleaned` / rc=0** con el vite VIVO después: la mentira del issue, reproducida. «Si no puede, FALLA» (`kill_pids` no comprueba la muerte) lo declara el ingeniero como no cubierto y el plan lo dejó fuera: **no probado** |
| C4 · candado: un propio en bloque ≥ 1000 que `--parar` ve y para; probado en negativo; exento de CI con motivo | ✅ cumple el candado; ❌ la abstención sale verde (H1) | Bloque 10 de `qa/parar-clasifica-los-nueve-puertos.mjs`, corrido por mí en verde con offset 1300 y 900 (elige +1000: `:4000 :19765`). **Negativo hecho por mí**: `cp start.sh` de `main` encima (`git diff --stat`: 26+/77−), `NEFAN_PORT_OFFSET=900 node qa/parar-clasifica…` → **EXIT=1, exactamente 3 rojos**, los del bloque 10 («líneas «·» que lo citan: 0», «muerto=false puertos_libres=false», «lo dijo»), 17 verdes; `git checkout -- start.sh`, `cmp` idéntico al de la rama, HEAD intacto. Exención en `candados-headless.json` actualizada con el motivo de su hermano; `candados-headless-totalidad.test.ts` verde. Pero: **con el bucle ≥ 1000 saboteado para no encontrar bloque (`off <= 999`, copia temporal en `qa/`), el guion imprime `⚠ … ningún bloque libre entre +1000 y +40000` y sale EXIT=0 con «✔ `--parar` clasifica bien…»** |
| C5 · «diez bloques» / «90 puertos» a cero en `start.sh`, los dos candados, `CLAUDE.md`, `docs/agents/README.md` | ✅ cumple | `grep -rniE "diez bloques\|90 puertos" start.sh qa CLAUDE.md docs/agents/README.md` → solo `qa/run.mjs:294` (excluido por el plan, y `CLAUDE.md` ahora dice que es «su propio rango»). Las dos líneas `0..900` que quedan en `parar-clasifica…` (41, 349) describen el bug retirado en pasado |
| Decisión · offset = múltiplo de 100 en 0..40000, UN predicado en subida y parada, paridad en TS/mjs/bash | ✅ cumple | `test/port-offset-paridad.test.ts` **15/15** (incl. `1000`, `1400`, `0100` aceptan; `1`, `150` rechazan) y `service-registry.test.ts` 7/7. Subida: `--list` con `150`, `1`, `40001`, `-100` → rc=1 «múltiplo de 100 entre 0 y 40000»; `0100`, `00`, `""` → rc=0. Parada: `--parar` con `150` y `1` → mismo mensaje, rc=1, sin llegar a mirar puertos; con `0100` → se normaliza a **+100** (el aviso dice `(+100)`), rc=0. `offset_admisible` es una sola función usada en `:47-52` y en `cmd_stop` |
| Restricción · nada ajeno tocado, árbol limpio al acabar | ✅ cumple | Al cerrar: 0 puertos de este árbol en `ss -ltnp`, 0 procesos con cwd en el worktree salvo mi shell, `git status` vacío, `start-main-qa.sh` retirado. Los benches ajenos de +0/+200/+300/+600 vivos todo el rato (cada informe de `--parar` los enumeró como AJENO) |
| Herramientas del repo | ✅ cumple | `npm test` (nefan-core) **3122/3122** en 49 s; `architecture.test.ts` (`nadie-inventa-un-puerto` ✔) y `candados-headless-totalidad` ✔ (124/124). No repetí `crap`/`ejercicio`/`coverage`: sin cambio de código desde el informe del ingeniero y el CI los corre |

## Hallazgos

### H1 · importante — el único candado de #684 se abstiene EN VERDE (familia #356/#331)

**Reproducir**: `qa/parar-clasifica-los-nueve-puertos.mjs`, bloque 10; si ningún bloque ≥ 1000 está libre
(o —como hice yo— el bucle no encuentra ninguno), `nota(...)` y se sigue. Final: `code = fallos.length === 0 ? 0 : 1`
→ **EXIT=0** y la línea «✔ `--parar` clasifica bien los nueve puertos…». Medido con una copia saboteada
(`off <= 999`): `⚠ no se pudo medir el propio de un bloque ALTO (#684)` y EXIT=0.

**Por qué es un defecto y no un matiz**: la cabecera del propio guion promete `Salida: 0 todo verde · 1 alguna
comprobación en rojo · 2 no llegó a medir`, y ese 2 solo lo usa el preflight. Su hermano `no-mata-lo-ajeno.mjs`
sale con 2 (`sinVeredicto`) cuando no puede afirmar. `qa/README.md:172,300`: «el ⊘ degrada la corrida MÁS que el
rojo (exit 2 contra 1) … un ⊘ es una declaración, no una amnistía». Un día con la máquina llena, el candado de #684
no mide y quien lo corre ve verde; el ingeniero lo declara en «Qué NO queda cubierto» §4, pero declararlo en un
fichero gitignored no es lo mismo que hacerlo visible en la salida. **Juicio: debe ser ⊘ (exit 2 si no hay rojos),
no 0.** El bloque 8 (#424) tiene el mismo comportamiento desde antes; arreglar uno sin el otro dejaría dos criterios
en el mismo fichero. Es un cambio de cuatro líneas (una bandera como la del hermano) y su negativo es el sabotaje
que acabo de correr.

### H2 · importante — la retícula real de candidatos no está declarada donde se lee, y el comentario de `start.sh` afirma lo contrario

El filtro «catálogo × offset admisible» da **3.308 puertos** (3000..58765). `start.sh` (comentario en `cmd_stop`)
dice: «un puerto de este árbol que no sea de un servicio del catálogo (game-emulator, **un vite suelto**) no
entra, igual que antes». Falso a medias: `:9899` no entra (correcto, comprobado), pero un vite suelto de este árbol
en `:3100` o en `:8000`, o cualquier cosa propia en `:24678`, SÍ entra y se para. La única explicación honesta
(«indistinguible del mismo servicio en un bloque legítimo», con los ejemplos 8000 y 24678) vive en
`implementacion.md`, que el `.gitignore` deja fuera. `grep -rniE "retícula|8000|24678|fuera del catálogo"` en
`start.sh`, `CLAUDE.md`, `docs/agents/README.md`, los dos guiones y `stack.mjs` → nada. **La decisión es
aceptable; la documentación en el sitio donde se decide es la contraria.** Y nada canda que `game_emulator` siga
fuera de la retícula si algún día cambia de puerto: un test de una línea por base (`(9899 − base) % 100 ≠ 0`)
sobre el registro de servicios lo sujetaría sin copiar el predicado.

### H3 · menor — el informe de `--parar` crece con la máquina y enumera ajenos que no son de nadie del proyecto

Con el filtro sobre la foto, cada teardown lista TODO lo ajeno de la retícula: en una corrida salieron **14 líneas
AJENO** (benches de cuatro tandas más mis dos `http.server`). Un `python3 -m http.server` en `:8000` desde `/tmp`
—lo más común de un portátil de desarrollo— aparecerá en el `--parar` de TODOS los worktrees de la máquina, para
siempre, como «AJENO, no se toca / Habla con su dueño». No es incorrecto (es verdad), pero la línea útil (`·` la
propia) queda enterrada. El plan lo tiene en backlog («un resumen por bloque ajeno»); lo confirmo como fricción
real, no teórica.

### H4 · menor, observado y no diagnosticado — el launcher desatendido muere y deja el cliente huérfano

Arrancado con `setsid nohup env NEFAN_PORT_OFFSET=1300 ./start.sh --preset html-fixtures < /dev/null &`, el
launcher (pid 263546, y luego el segundo) estaba muerto a los pocos segundos de imprimir «Press Ctrl+C», con vite
vivo. No es el sujeto de la tanda (`--parar` existe justo para ese huérfano y se lo llevó) y puede ser mi forma de
lanzarlo; lo dejo escrito porque es el estado en que un agente encontrará su stack si arranca así.

### H5 · menor, preexistente — la elección de «bloque libre» del guion compite con los benches

En la corrida con 1300 el bloque 8 plantó su ajeno en `+200` (`:3200 :18965`) y minutos antes `:3200` lo tenía el
vite de la tanda AB. Le salió bien porque el bench había soltado el puerto; si no, el señuelo no arranca y el
guion se cae con «no llegó a escuchar» (rojo por entorno, no por defecto). Con 14 tandas ciclando en +0…+900 es
una carrera abierta. No lo introduce esta tanda.

## Workarounds usados y su veredicto

| Workaround | Por qué | ¿Lo tiene el usuario delante? |
|---|---|---|
| Copiar el `start.sh` de `main` DENTRO del árbol (`start-main-qa.sh`, retirado al final) para el escenario de la mentira | `PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"`: desde `/tmp` habría clasificado todo como ajeno | No: es la forma de ejecutar el código viejo con la misma propiedad. Evidencia, no obstáculo |
| Sustituir `start.sh` por el de `main` durante el negativo del guion y restaurarlo con `git checkout` (`cmp` idéntico, HEAD intacto, `git status` vacío) | El guion llama a `./start.sh` por nombre fijo | No afecta al usuario; el árbol quedó byte a byte como estaba |
| Copia temporal saboteada del guion en `qa/` para medir la abstención (borrada) | No se puede llenar +1000…+40000 de verdad | Es la medida de H1 |
| Arranque desatendido con `setsid nohup` | Un launcher en primer plano bloquearía la sesión | Ver H4: no cambia el veredicto de `--parar`, que encontró y paró el huérfano |
| Un `--parar` con `0100` encadenado a `head -3` que corrió en paralelo con el primer arranque (rc=141, SIGPIPE) | Error mío de método | Lo repetí sin `head` y en solitario (rc=0, +100, 7 ajenos, «nada que parar»). No contaminó: el vite de +1300 aún no escuchaba y ningún proceso propio cayó fuera de los `--parar` previstos |

## No probado

- **`--parar-todo` / tecla `K`**: fuera de alcance por requisitos y prohibido en máquina compartida.
- **La segunda mitad de C3** («si hay y no puede, falla en voz alta»): `kill_pids` no comprueba la muerte; el
  ingeniero lo declara y el plan lo excluyó. Hoy lo tapa el guion desde fuera, el launcher solo no.
- **Offsets ≥ 1400 en flujo real**: la paridad acepta `1400` y `40000`; el flujo real lo hice en +1300 y el
  candado en +1000. No hay razón en el código para que 1400..40000 se comporte distinto (mismo predicado), pero no
  se arrancó nada ahí.
- **Mutación del `% 100`**: `service-registry.ts` está en `sin_mutar`; el ingeniero lo dice y no lo maquilla.
- **`npm run crap` / `ejercicio` / `coverage`**: no repetidos; el ingeniero los reporta verdes y el CI los corre.
- **Nada de esto corre en CI**: los dos guiones siguen exentos (ejecutan `--parar` sobre puertos reales). Lo único
  que entra en cada PR es la paridad del predicado. Heredado y correcto, pero conviene no leerlo como cobertura.

## Veredicto

**Apto con reservas.** El bug de #684 está arreglado y demostrado desde el arranque real (+1300: la rama para, `main`
miente), lo ajeno no se toca ni en el mismo bloque, la subida y la parada comparten un predicado con paridad medida,
y el candado se pone rojo con el código viejo (3 rojos exactos). Las reservas son dos y ninguna toca el arreglo:
**H1**, el candado se abstiene en verde contra el contrato de su propia cabecera y la regla de la casa
(debe salir 2/⊘); y **H2**, el comentario de `start.sh` afirma que «un vite suelto no entra» cuando la retícula de
3.308 puertos sí lo alcanza en `:3100`/`:8000`, y la explicación verdadera solo vive en un fichero que no se
commitea. Las dos vuelven al mismo ingeniero; no hace falta re-verificar el flujo real después, sí correr el
sabotaje de H1 y ver el 2.

---

# Ronda 2 — re-verificación de H1–H3 (2026-09-20, HEAD `39cab23e` sobre `main` = `243fcf9f`, PR #701)

Solo lo afectado por el commit de corrección. Mismo método: bloque **+1300** para el flujo real, +900/+1000
para el guion, árbol limpio al cerrar (`git status` vacío, 0 puertos de este árbol). Los negativos con el
`start.sh` viejo se hicieron con `git show a25d8c2f:start.sh > start.sh` y `git checkout -- start.sh` (no
`stash`: con el trabajo commiteado, `stash` devuelve la versión de HEAD, que es la buena — el gotcha que
describe el ingeniero, y es real).

| Hallazgo | Veredicto | Evidencia |
|---|---|---|
| H1 · la abstención del candado sale ⊘ (2), no verde | ✅ cerrado | `sinVeredicto` se enciende dentro de `nota()` (las tres abstenciones del fichero la heredan) y `code = fallos.length > 0 ? 1 : sinVeredicto ? 2 : 0`. **Medido en tres direcciones**: (a) copia con el bucle del bloque 10 en `off <= 999` y el `start.sh` de la rama → `⚠ … ningún bloque libre entre +1000 y +40000`, `⚠ pero el entorno no dejó comprobarlo todo: sale con 2, no con 0.`, **EXIT=2**, sin rojos; (b) misma copia con el `start.sh` de `a25d8c2f` → **EXIT=2** (la abstención tapa el bug como ⊘, no como verde: correcto); (c) bloque 8 abstenido (`off <= -1`) + `start.sh` de `a25d8c2f` → ⚠ del bloque 8 **y** los 3 rojos del bloque 10, **EXIT=1** (el rojo manda). Guion sin sabotear con offset 1300: **EXIT=0, 21 verdes, ni ✘ ni ⚠** |
| H2 (a) · la retícula dicha donde se decide | ✅ cerrado | El comentario de `cmd_stop` en `start.sh` dice ahora «3.308 puertos distintos entre 3000 y 58765», que lo que se para es «un proceso de ESTE árbol EN LA RETÍCULA», con los ejemplos `:3100`, `:8000`, `:24678` y el porqué; la frase falsa «un vite suelto no entra» ya no existe. El número del emulador no se escribe (lo caza `nadie-inventa-un-puerto`) y remite al test |
| H2 (b) · candado de que el emulador queda fuera de la retícula | ✅ cerrado | `test/service-registry.test.ts`, describe «el emulador de juego queda fuera de la retícula que barre `--parar`»: 1 aserto de las nueve claves + 9 por base, preguntando a `portOffset` (no copia el predicado). En verde: 17/17. **Negativo A** (emulador a `:9900` en `src/config.ts`): rojo **solo** `✖ :9900 no es html (:3000)` (16/17). **Negativo B** (quitar `|| n % 100 !== 0` de `portOffset`): **9 fallos** = las 8 bases con distancia positiva (bridge, state_api, narrative_ws, ai_server, html, asset_store, remote_gen, sprite_forge) + el aserto «LANZA» de `150`/`1`; `fake_ai` (:18765) no cae porque su distancia es negativa. El ingeniero dice «los nueve rojos»: son nueve fallos, ocho de ellos por base — precisión, no defecto. Ambos sabotajes restaurados con `git checkout`, `git status` vacío |
| H3 · lo propio primero en el informe | ✅ cerrado | Flujo real: `NEFAN_PORT_OFFSET=1300 ./start.sh --preset html-fixtures` → vite :4300 (pid 454996, cwd de este árbol); `--parar` 1300 imprime **primero** `· :4300 …`, luego `── 9 proceso(s) de la retícula que NO son de este árbol ──` y las nueve `⏭`, y al final el aviso; :4300 LIBRE y pid muerto después, rc=0. Sin nada propio: línea 2 `(nada que parar aquí)`, línea 3 el rótulo de ajenos. Lo ajeno (tandas W/V/AB en +0/+100/+200) intacto |

Sin hallazgos nuevos. H4 y H5 (menores, no de esta tanda) quedan como estaban.

## Veredicto final

**Apto.** Las dos reservas de la ronda 1 están cerradas con negativo medido por mí en cada una; el arreglo de #684
no cambió y sigue demostrado desde el arranque real en un bloque ≥ 1000. Lo no probado de la ronda 1 sigue
siendo no probado (`--parar-todo`, `kill_pids` sin comprobar la muerte, offsets ≥ 1400 en flujo real, el `% 100`
sin mutación, los guiones fuera de CI), y está declarado.
