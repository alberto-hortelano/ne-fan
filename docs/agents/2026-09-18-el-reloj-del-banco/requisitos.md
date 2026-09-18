# Tanda Q — «El banco mide contra el reloj bueno» (#656 + #609 + #610)

## La petición, literal

Mandato vigente del usuario (2026-09-17, sigue en pie):

> «Hay 48 issues abiertos, ve cerrando sin parar, si tienes bloqueo en alguno lo apuntas pero sigue
> hasta reducir el numero al minimo»

Y hoy, 2026-09-18, al reanudar:

> «Seguimos, ya ha acabado la mutacion»

Decisión del usuario para HOY: **ciclo completo con fase de QA**.

## Estado medido al abrir

- `main` = `900b5b71`, árbol limpio.
- Batería: **145 verde · 0 rojo · 1 ⊘ de 146**. El guion 127 estaba VERDE en esa corrida.
- El disco de la máquina está hoy al **69 %** (139 G libres). Ayer estuvo al 99 % (5,5 G) y esa es una
  variable del problema de #656.
- Corrida de mutación `35317748262` en vuelo; no afecta a esta tanda (`qa/**` no entra en producción).

## Los tres issues

### #656 — el guion 127 mide por 90 s de reloj de PARED

Medido sobre `main` = `e5cdebb5`, corriendo el guion **solo** (`node qa/run.mjs 127`), con el disco al
99 %:

| Vuelta | Resultado | Partidas creadas antes de parar |
|---|---|---|
| 1 | rojo | 6 |
| 2 | rojo | 6 |
| 3 | verde (E4 completo, `[1,1,1]`) | 10 |

**Es intermitente y falla aislado**, así que no lo causa el estado que dejan los guiones anteriores. Los
dos rojos paran en el mismo sitio: E1-E3 enteros en verde y la espera de `tile_-1_-1` agotando sus 90 s
en la **PRIMERA** partida del bloque E4 (`:341`), no en la tercera — el cuerpo original del issue decía
la tercera y **eso ya está corregido con la medida**.

El reloj está en `pedirYEsperar` (`qa/guiones/127-…:134-141`):

```js
await ctx.waitFor(`el tile ${key} llega al mundo del cliente`, (k) => window.__nefan.tiles.includes(k), 90_000, key);
```

**Dato NUEVO de anoche, y cambia el planteamiento**: con 139 G libres el guion salió **0 de 3 rojo**
(verde las tres veces) y en la batería completa de cierre también verde. Con 5,5 G libres fue 2 de 3
rojo. Eso hace del disco un candidato serio, pero **no cierra nada**: una espera correcta no debería
depender del disco, y hoy el banco no puede DECIR si dependió.

Lo que el issue prohíbe explícitamente: **subir los 90 s** sin saber qué distingue la vuelta verde —
convertiría un fallo reproducible en uno raro. Y avisa de que conducirlo a `{sim:N}` **tampoco es
automático**: lo que se espera es que llegue un tile del motor, no que el mundo simule, y el reloj de sim
no avanza mientras el bridge habla con el fake. Si hay una señal del bridge a la que engancharse (la
difusión de la escena), esa es la espera correcta; si no la hay, **decirlo** es un resultado válido.

### #609 — el reproductor bajo carga clasifica por el TEXTO del aserto

`qa/bajo-carga.mjs` clasifica los rojos que aparecen bajo carga por la firma del texto del aserto. Caso
medido, el guion 93:

```
node qa/bajo-carga.mjs 93 --factor 40
  quieto  ✔
  ×40     ✘ 1/1   ·  razón sim/pared 0,262
  velocidades a 0,38 / 0,63 / 0,42 / 0,46 de lo esperado (1,60 frente a 4,18 m/s)
  clasificación: «sin-firma» → NO ATRIBUIBLE a #545
```

Ese rojo **es** de #545 en el sentido que importa —solo existe bajo carga y su causa es el reloj: el
clamp de 0,1 s por frame contra un denominador de segundos de PARED en `medirVelocidad`
(`93:170-199`)—, pero no lleva «ms» en ningún aserto.

Lo que propone: que la clasificación no descanse **solo** en el texto, sino en lo que el reproductor ya
mide (que el rojo no exista en reposo, que la razón sim/pared esté hundida, y que la magnitud caiga en
proporción cuando el aserto lleve números), y que la tercera categoría se llame lo que es: **«compatible
con #545 por comportamiento, sin firma de presupuesto»**, distinta de «no atribuible».

**El veredicto se diseñó para no atribuirse rojos ajenos (lección de #496/#497) y eso no se toca**: lo
que se pide es que la otra dirección deje de mentir también.

### #610 — el detector de esperas conducidas sigue la tecla por anidamiento léxico

`nefan-core/test/esperas-que-conducen.test.ts` ve la tecla y la espera cuando están en la misma función.
No ve «tecla en el llamante, espera en un helper», forma viva en `qa/guiones/133-…` (`veredictoDe`
espera con la tecla puesta desde `:87`, llamado en `:355`). **Está declarado en el fuente y medido con su
caso ejecutable**, así que no es un agujero oculto.

**La medida que decide la vía**: se escribió el detector cruzado y da **9 sitios**, de los cuales **8 son
el mismo helper `frames(ctx, n)`** (guiones 37, 43, 58, 83, 86, 109, 112), que espera por FOTOGRAMAS del
bucle — o sea lo contrario del defecto que #545 persigue. Extender el detector por «hay una tecla
puesta» compraría **ocho exenciones de esperas correctas y ni un defecto**.

El eje bueno que propone el issue: **contra qué reloj mide el predicado**, no quién pulsó la tecla. Una
espera que lee `state().pos` y la compara contra milisegundos de pared es el defecto; una que cuenta
fotogramas o segundos de simulación, no. Censo de partida: los 9 sitios, con los 8 de `frames(ctx, n)`
como el conjunto que **NO** debe marcarse.

## Por qué juntos

Los tres son «el banco mide contra el reloj que no es»: uno lo sufre (127), otro no sabe reconocerlo
(el reproductor) y el tercero lo detecta por el eje equivocado. Comparten la familia de #545 y el
material de `qa/`. **El crítico debe verificar esta premisa** y decir si alguno sale.

## Restricciones de la casa que aplican aquí

- Cero créditos.
- Nunca `--parar-todo` ni `pkill` ni matar por puerto. Solo `NEFAN_PORT_OFFSET=<n> ./start.sh --parar`
  desde el propio worktree.
- **Ningún umbral de tiempo se sube para que algo pase.** Es literalmente lo que #656 viene a impedir.
- Un guion que sale en rojo a propósito es tan inútil como un test que no puede ponerse rojo: lo que se
  entregue tiene que poder ponerse ROJO con el defecto puesto, y verse.
- Un ejecutable headless nuevo entra en `candados-headless` **el día que nace**, con su motivo en
  `data/contract/candados-headless.json`, o no lo corre nadie.
