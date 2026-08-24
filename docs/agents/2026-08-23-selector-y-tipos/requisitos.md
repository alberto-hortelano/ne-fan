# El selector ante los datos, y los tipos que el CI no mira (#230 + #231)

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo que
> puedas con el flujo de agentes»

Y al reanudar la cola:

> «He reiniciado la sesion, ponte con los siguientes issues, si se modifica uno lo modificas y
> si se descarta simplemente pasa al siguiente y al final revisamos los descartados pero no
> pares la ejecucion de los demas a no ser que tengan dependencias y yo tenga que hacer una
> eleccion de direccion del producto.»

Tu veredicto no necesita permiso: REENCUADRADA reescribe el issue y sigue, OBSOLETA lo cierra y
pasa al siguiente. Solo se para si obliga a elegir dirección de producto.

## Por qué los dos van al mismo crítico

Los dos nacieron de la misma tanda (`docs/agents/2026-08-23-mutacion-por-modulo/`, #176 + #168), los
dos son herramienta de verificación, y los dos son **exactamente la clase de tarea cuyo valor hay
que medir antes de aceptar**: uno dice «mide antes de decidir» en su propio cuerpo.

## Reencuadre del crítico (2026-08-23)

Veredicto: **REENCUADRADA los dos.** Ver `critica.md`.

### #230 — la premisa que yo escribí en el issue es falsa

Escribí que `arch-rules.json` fuerza la corrida completa porque «ninguna batería lo importa, un
fichero de datos no está en el grafo». **No es eso.** `nefan-core/scripts/mutation-plan.ts:183` lo
lee para derivar el **perímetro de mutación** de la regla `core-puro-sin-node`, y por eso está a
mano en la lista `TOOLING` de `scripts/afectado.ts:61`. **Esa clasificación es correcta**: el
crítico probó la hipótesis «está mal clasificado» y la **falsó**.

Lo que falla es la **granularidad**: la dependencia es por **regla**, y la evaluación es por
**fichero**. Los dos commits que van a completa por este fichero añadieron **reglas nuevas**;
ninguno tocó `core-puro-sin-node`. Uno de ellos añadió una regla cuyo `files` es
`qa/guiones/**/*.mjs`, que **no puede alterar el perímetro de nefan-core ni en teoría**.

**Y mis números estaban mal.** Medido sobre los 11 últimos commits de `main`: **5 van a completa, no
7**; y `arch-rules.json` es causa **única en 2, no en 5**.

El número que decide el alcance, por contrafactual (mismo diff sin el fichero que fuerza todo):

| Caso | Hoy | Sin él |
|---|---|---|
| los dos de `arch-rules` | 17/17 | **6/17** |
| `7f7e417` (`tile_instructions.md`, dato genuino) | 17/17 | **13/17** |

La mitad **cara** del issue —trazar `fs`, que yo mismo describí como «una tanda con su propia
verificación»— compra **1 commit de 11 y 4 módulos de 17**, porque ese diff ya arrastra 13 por sus
fuentes. Y su fallo es **mudo**, que es justo lo que la PR #229 se dedicó a cerrar. La mitad
**barata** —granularidad por regla, decidible **leyendo** el fichero— compra **2 de 11 y 11 de 17
cada vez**, y el peaje que encontraron los otros agentes cae **entero** ahí.

**Alcance acotado a la granularidad por regla. El trazado de `fs` queda fuera.**

### #231 — son dos tareas, no una

Ejecutado el criterio del propio issue. `tsc --noEmit` sobre `main`, con línea base sana
(`src`+`bridge`+`services` = 0 errores):

- **`scripts/`: 0 errores.** El árbol donde vivía `r.rule.message` es hoy **una línea de config**.
- **`test/`: 59 errores en 21 ficheros.** Seis se van con `lib: ES2023`, dos son el `rootDir` de
  `narrative-mcp/validators.ts`; quedan **~51 reales**.

El criterio «cero → una línea; cuarenta → una tanda» **parte el issue en dos**: (a) va ya; (b) es
una tanda propia, que además estaba bloqueada por el ingeniero que modificaba `test/`.

**El hallazgo que sube el valor de la tarea** — `nefan-core/test/service-registry.test.ts:22`:

```ts
if (SERVICES[name].extractionPhase !== undefined) {
```

para `gpu-worker`, `asset-store` y `remote-gen`. **Ninguna de las tres declara `extractionPhase`**,
así que la condición es **siempre falsa** y sus tres aserciones **no se ejecutan nunca**. Y si se
ejecutaran, **fallarían**: comparan `currentPort` (8766/8767/8768) contra el puerto de ai_server
(8765). Es un test verde que no comprueba nada, **protegiendo una creencia caducada**.

Es la **segunda aparición** del modo de fallo de `r.rule.message`, ahora dentro de `test/`. Eso saca
a #231 de «higiene de tipos» y lo mete en «el gate encuentra tests muertos». De propina,
`player.inventory` se infiere `never[]`.

**Aviso para quien implemente (b)**: se arreglan los tests, **no se silencian con `as any`**, y no
se acepta un baseline de errores tolerados — eso reproduciría el mismo problema con otro nombre.

## Criterios de aceptación de la tanda (para después de tu veredicto)

- El selector nunca hace una selección **corta y silenciosa**: ante la duda, ejecutar de más y
  decirlo. Ese criterio de la PR #229 no se negocia.
- Un error de tipos en `scripts/` o en `test/` pone el CI rojo.

## Fuera de alcance

Reescribir el selector entero. Cambiar el `outDir` o el build de producción.

## Veredicto del crítico

**REENCUADRADA los dos.** Ver `critica.md`. Sin decisiones de producto pendientes.

---

# Priorización del usuario (2026-08-24)

> «Prioriza el #230 para que arch-rules no dispare la ejecucion completa»

**Se ejecuta SOLO #230, y solo su mitad barata.** #231 se queda donde estaba: su (a) es una
línea de config y su (b) sigue bloqueada. No se amplía el alcance por estar cerca.

## Lo que se hace, con el encuadre del crítico

Llevar la evaluación de `nefan-core/data/contract/arch-rules.json` de **por fichero** a
**por regla**.

La dependencia real es **una sola regla**: `core-puro-sin-node`, de la que
`scripts/mutation-plan.ts:183,204` (`REGLA_PERIMETRO`) deriva el perímetro de mutación.
Ninguna otra regla del fichero puede cambiar qué se muta — `qa-guiones-sin-espera-por-reloj`
tiene `files: qa/guiones/**/*.mjs` y no puede alterar el perímetro de nefan-core **ni en
teoría**. Hoy se evalúa el fichero entero, así que añadir cualquier regla paga los ~7000
mutantes.

**El fichero está bien clasificado y eso NO se toca.** El crítico probó la hipótesis «está mal
puesto en `TOOLING`» (`scripts/afectado.ts:61`) y **la falsó**: como el perímetro sale de ahí,
tratarlo como instrumento de medida es acertado. Lo que falla es la **granularidad**.

## Fuera de alcance, dicho para que no vuelva por la puerta de atrás

**Trazar lecturas de `fs` y persistir un mapa de dependencias.** Es la mitad cara del issue y
**no compra lo que cuesta**: de los 11 commits medidos, el único con causa única de dato
genuino (`7f7e417`) solo bajaría de 17/17 a **13/17**, porque su diff ya arrastra 13 módulos
por sus fuentes. Y el mecanismo **falla mudo**, que es justo el modo de fallo que cerró la
PR #229.

## El criterio que no se negocia (#229)

**Ante la duda, ejecutar de más y decirlo.** Por-regla es compatible con esto: si la regla del
perímetro cambió, **o el fichero no se parsea**, se corre todo y se dice por qué. Una selección
corta y silenciosa es peor que una larga.

## Cómo se demuestra que funciona

El contrafactual ya está medido por el crítico sobre `main` y es la prueba de aceptación:

| Commit | Hoy | Con por-regla |
|---|---|---|
| `146cc7f` (añade `cadena-de-migracion-unica`) | 17/17 | **6/17** |
| `cf7b446` (añade `qa-guiones-sin-espera-por-reloj`) | 17/17 | **6/17** |

Y el negativo, que es igual de obligatorio: **un cambio en `core-puro-sin-node` tiene que
seguir dando 17/17**. Si no puede ponerse rojo, el candado no vale.

**Se verifica con el selector (`npm run afectado`), no corriendo la mutación**: lo que hay que
demostrar es qué módulos se eligen, no qué mutantes sobreviven. Hay otro trabajo en vuelo en
el árbol y una corrida completa son ~34 min de máquina.
