# Requisitos — Tanda K «El cliente se puede probar»

## La petición

Cita literal del usuario (2026-09-17):

> «Hay 48 issues abiertos, ve cerrando sin parar, si tienes bloqueo en alguno lo apuntas pero sigue
> hasta reducir el numero al minimo»

## Los cuatro issues, y por qué van juntos

**#543 NO bloquea el banco, y esa premisa mía se cae con número**: importados en Node los 72 `.ts` de
`nefan-html/src`, **59 ya cargan hoy**. Lo que #543 bloquea son los **11 del título** (las nueve hojas,
`atomos.ts` y el enrutador), más `main.ts` y `world/fixtures-del-selector.ts`, que quedan fuera por
`import.meta.glob` de Vite y son otro problema. O sea: **se puede empezar hoy; la razón medida es por
dónde NO empezar.**

`nefan-html` sigue sin banco de tests unitarios —0 ficheros y ni script `test`, contra 156 en core—, y
sigue siendo cierto que importar `ui/titulo/atomos.ts` en Node revienta con `location is not defined`
(`:144` y `:148` llaman a `serviceUrl` AL CARGAR).

| Issue | Qué | Estado medido hoy (`main` = `81735f13`) |
|---|---|---|
| **#636** | `nefan-html` sin banco de tests unitarios | La regla «lógica en core» está sostenida **en parte por una CARENCIA** |
| **#543** | `atomos.ts` llama a `serviceUrl` al cargar | **VIVO, y su bloqueo tiene mecanismo desde el 2026-09-10**: #496 midió el mismo contador `4 → 5` sobre código SIN TOCAR |
| **#555** | 12 parejas de acoplamiento por id de DOM entre módulos del título, **6 sin red** | Reserva de la QA que dictaminó que #346 REPARTIÓ |
| **#654** | `const size = 0.5; // TILE_MPC` en `main.ts:514` | **VIVO**. `fps-gl.ts:35` ya importa `TILE_MPC` de core, así que el arreglo suelto son dos líneas |

## El bloqueo YA NO es un misterio, y eso lo cambia todo

`serviceUrl` es **puro** (`resolveServiceUrl`, `src/contracts/service-registry.ts:113-122`), `envFromQuery`
solo lee `location.search`, y en todo `nefan-html/src` hay **0** `pushState` / `replaceState` /
`location.href =`. O sea: **la URL de la página no muta nunca**, así que perezoso y ansioso devuelven el
mismo string y el cambio **no puede** alterar el valor.

El rojo que lo congeló —`errores 4 → 5` en el guion 80— es la **firma documentada de #496**, medida el
2026-09-10 (un día después de escribirse #543) **sobre código sin tocar**:

```
batería completa       4 → 5   ✘
qa/run.mjs 79 80       5 → 5   ✔
qa/run.mjs 80 aislado  1 → 1   ✔
```

El 79 deja cuatro entradas heredadas a una página sin sesión, y el aserto del bloque 3 mide en ventana de
dos frames. La evidencia que congeló el cambio era **N=2 rojo contra N=1 verde**, sobre un guion con tasa
base de rojo medida.

**La causa raíz sigue viva en `main`**: `StateUpdateMessage` no lleva `sessionId`
(`src/protocol/messages.ts:296-341`) y el cliente no lo filtra (`net/game-client.ts:116`) mientras sí
filtra los otros dos canales desde #282; la entrada extra la emite `world/lo-que-manda-el-bridge.ts:53`.
**#496 se cerró el 2026-09-16 sin arreglarla**, y su sitio vivo hoy es **#634** (tanda N).

**Lo que esta tanda tiene que hacer**: re-medir con el protocolo de #496 —`node qa/run.mjs 80` aislado y
`node qa/run.mjs 79 80`, **tres corridas de cada**— y meter el cambio si el rojo aparece igual **sin** él.
Sigue prohibido meterlo a ciegas: **prohibido es sin medir, no sin explicar.**

## Lo que el crítico tiene que decidir

1. **¿#636 cabe en una tanda?** RESUELTO POR LA CRÍTICA: **cabe, no es programa.** Banco mínimo **fuera
   de `src/`** —y esto es una restricción dura que el issue no veía: el candado
   `el-cliente-no-alcanza-node-ni-a-traves-del-core` cubre `nefan-html/src/**/*.ts` **con `cierre`**, así
   que un `*.test.ts` bajo `src/` que importe `node:test` **viola el candado**—, `npm test` en el job
   `nefan-html` de `ci.yml:96-114` (que ya existe y ya instala las deps del core: es una línea), y **un
   primer sujeto**. Core corre `node --import tsx --test`: no hace falta vitest ni jsdom.
2. **¿#543 se arregla en esta tanda o es su primer paso?** Es el bloqueo medido de #636.
3. **¿#555 entra?** RESUELTO: **no como issue propio — entra como el PRIMER SUJETO del banco**, después
   de #543. Así se cobra gratis en vez de pagarse dos veces, y el candado que pide («ids escritos contra
   ids leídos») es un test unitario en Node de dos módulos, en milisegundos; hacerlo antes obligaría a
   inventar una regla de arquitectura sobre cadenas. Cifras corregidas por el censo de hoy: **12 de 12
   parejas vivas, ninguna muerta y ninguna nueva**; `#ts-gen-progress` **cambió de dueño** (selector →
   `ui/titulo/panel-de-generacion.ts`, 2026-09-14) y esa fila del issue está obsoleta; el «6 sin red» son
   hoy **2 de 12** sin ningún guion que las nombre (`#ts-columns`, `#ts-actions`) y **1 de 12** con la
   costura atada de verdad (guion 101). El argumento de urgencia ha caducado: #513, #536, #425 y #537
   están **los cuatro cerrados**.
4. **#654**: RESUELTO — **el arreglo sí, el candado no.** No se amplía la regla: en TODO el repo hay
   **exactamente un** comentario delator con esa forma (`main.ts:514`), así que un candado sobre él
   **nace sin sujeto vivo el día del arreglo** (N = 0), y `dev/nefan-hook.ts:214-217` enseña el suelo de
   falsos positivos — cuatro `0.5` que son media celda de sondeo. Se importa `TILE_MPC` y se añade al
   `why` de `la-fisica-no-se-copia-a-mano` **esta instancia con su fecha**, diciendo que el cliente SÍ
   está en `files` y la regla aun así no la cazó.

## Lo que la tanda NO debe hacer

- **No meter el cambio de `atomos.ts` sin MEDIRLO** con el protocolo de #496. El mecanismo ya está
  explicado; lo que falta es la medida.
- **No medir #543 con la batería completa.** Mezcla su rojo con el de #634 y devuelve el mismo callejón
  del 2026-09-09.
- **No mover lógica a core solo para poder probarla.** #241 ya movió lo que tenía que moverse (8 PR,
  cliente 14.466 → 14.116); lo que queda en el cliente es presentación derivada y está ahí a propósito.
- **No bajar ningún umbral** y no tocar la cifra de `main.ts` (hoy **1.378**, clavada desde la tanda G)
  sin anotarla con motivo en `client-file-size.json`.

## Restricciones

- **Cero créditos**: motor falso, `html-fixtures`, `e2e-sin-creditos`.
- **Bloque de puertos 900**: `NEFAN_PORT_OFFSET=900 ./start.sh --preset <slug>` desde el árbol
  `/home/al/code/ne-fan-k-cliente`, y `--parar` con el mismo offset desde el mismo árbol. **Nunca
  `--parar-todo`, nunca `pkill`, nunca matar por puerto.** Hay otros agentes trabajando.
- Log de corrida larga: `bateria-k.log`.
- Una retirada incluye prosa, comentarios y docs: `grep` a cero.
- Solo se commitean `requisitos.md`, `critica.md` y `qa*.md`.

## La espina dorsal aprobada (crítica + coordinador)

**#543** (re-medir con el protocolo de #496 y meter) → el título pasa a ser importable → **#636** (banco
fuera de `src/` + `npm test` en el job `nefan-html`) → **primer sujeto = el censo de ids de #555** →
**#654** aparte, dos líneas y una frase en el `why`.

Cuatro issues, y **#555 se cobra gratis**.
