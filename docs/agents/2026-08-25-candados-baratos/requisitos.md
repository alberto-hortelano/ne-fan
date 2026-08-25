# Los dos candados baratos (#248 · #231a)

## Petición del usuario (literal)

> Mergea y sigue con el backlog, elige y prioriza proximas tareas y continua de forma
> autonoma, yo voy a estar fuera unas horas, haz cosas que no necesiten de mi feedback y lo
> que surja lo dejas apuntado para que lo vea al final. Ten en cuenta que unas horas mias
> equivalen a varios dias de trabajo de agentes

Instrucción de gobierno vigente de la cola:

> si se modifica uno lo modificas y si se descarta simplemente pasa al siguiente y al final
> revisamos los descartados pero no pares la ejecución de los demás a no ser que tengan
> dependencias y yo tenga que hacer una elección de dirección del producto

## Por qué esta tanda existe y por qué no lleva arquitecto

Salen partidos de la tanda «Los candados que no pueden ponerse rojos», cuya crítica está en
`docs/agents/2026-08-25-tipos-y-candados/critica.md` (léela entera: es tu plan). El crítico
midió los tres y **los separó por coste**:

- **#248 y #231(a) son baratos y van ya.** Están medidos hasta el número: no queda nada que
  diseñar, solo ejecutar. Por eso no llevan arquitecto.
- **#231(b) (los tipos de `test/`) va DETRÁS de la tanda del bosque** (#243 #233 #232), porque
  19 de sus 59 errores viven en `volume-metrics.test.ts` y `fps-ambience.test.ts`, cuyo sujeto
  reescribe esa tanda. Arreglar esos literales ahora es arreglarlos dos veces. **No entra aquí.**
- **#247 va el último** y además está bloqueado de hecho por **#262**: no se puede elegir su
  aserto sin saber si el mercader que avanza 1 m en 30 s es un bug de steering. **No entra aquí.**

Esta tanda va **primera de la cola** por una razón concreta: con `no-floating-promises` activo,
cualquier promesa suelta que añadan las tandas siguientes —que tocan `nefan-html/src/main.ts`—
**nace roja**. Es para lo que existe.

## #248 — `no-floating-promises` en `nefan-html`

Todo medido por el crítico, con el fork del issue ya cerrado:

- **2 violaciones**, no un baseline. Lint **1,25 s → 2,03 s** (×1,6, no ×10). **No hay `max` que
  congelar: van de golpe.**
- `src/main.ts:1332` — **`loadSceneFile(value)` en el `change` del selector «Room»**: `async
  function` llamada sin `void`, sin `.catch`, sin `paso()`. Si el módulo de la fixture falla, el
  selector es un **no-op mudo**: el modo de fallo exacto de #181, en el selector que el preset
  `html-fixtures` existe para conducir. **Este es el bug vivo de la tanda.**
- `src/main.ts:1277` — `requestPointerLock()`, rechazo perdido (el cliente no tiene handler de
  `unhandledrejection`).
- **`recommendedTypeChecked` entero NO entra**: daría 40 violaciones. Es #260, ya abierto.
- **Gotcha que te ahorra media hora**: el bloque type-checked hay que acotarlo con
  `files: ["src/**/*.ts"]`. `vite.config.ts` y `eslint.config.js` están fuera del `include` del
  tsconfig y un `projectService` global los pone rojos.
- **NFP no sustituye a `html-sin-promesa-muda`** y hay que decirlo **en el `why` de la regla**:
  con `ignoreVoid: true` acepta `void p()` sin catch, y los otros dos puntos ciegos que declara
  #248 (un comentario al final de la línea; una línea que acaba en `)`) **sobreviven a las dos
  reglas**, porque llevan `void` y NFP no los mira. Que el `why` mienta menos es parte del
  trabajo.

## #231(a) — tipos en `scripts/`

- `scripts/` da **0 errores**. Es config, no deuda.
- **NO se amplía el `include` del `tsconfig.json` de build.** Ese lo consume `tsc -b` desde
  narrative-mcp con project reference, y ampliarlo emitiría `dist/scripts/*.js` + `.d.ts`.
  **La salida es un `tsconfig` APARTE** con `noEmit`, sin `composite`/`declaration`/`rootDir`,
  y un paso más en el job de CI.
- **`test/` NO entra** (es #231(b)) — y si lo intentaras, romperías el job de narrative-mcp:
  `test/contract-fixtures.test.ts:18` importa `../../narrative-mcp/validators.ts`, fuera del
  `rootDir` (TS6059), y falla de BUILD, no solo de `--noEmit`.
- **El testigo, si cabe sin arrastrar `test/` al tsconfig**: `test/service-registry.test.ts:22`
  recorre hoy dos servicios (`gpu-worker` murió con #199); sus dos aserciones **no se ejecutan
  nunca** y, si se ejecutaran, fallarían (8767/8768 contra `CONFIG.ai_server.port` = 8765). Las
  líneas 17-18 del mismo test ya afirman lo correcto: **el bucle sobra entero**. Bórralo aquí
  aunque el gate de tipos de `test/` no entre — es una aserción muerta que ya sabemos muerta, y
  dejarla es dejar el testigo del problema en su sitio.

## Freno explícito

**No se acepta `as any` ni un baseline de errores tolerados.** Si algo no cabe, se declara por
escrito qué queda fuera y se queda en la cola. Lo que no vale es apagar un gate para que pase.

## Criterio de terminado

**Los dos candados probados en negativo**: se rompe algo a propósito, el candado se pone rojo,
se revierte y se cuenta en `implementacion.md`. Un candado que nadie ha visto rojo no cuenta
como candado — que es literalmente el tema de esta tanda.

Y el bug vivo arreglado: si el módulo de una fixture del selector «Room» falla, **se entera
quien lo está usando**.
