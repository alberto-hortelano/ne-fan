# Requisitos — tanda BH: Un solo reconocedor de lectores de node:fs y saltos-del-guion troceado (#720 #727)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

## Decisión del usuario (AskUserQuestion, 2026-09-24)

—

## Triaje previo (2026-09-24)

| 720 | HACEDERO | M | T3 | `test/saltos-del-guion.ts` = 861 líneas. Hay tres resolutores de ámbito distintos, uno de ellos en `test/relojes-de-pared.ts`. El bloqueo por #704 ya no aplica (cerrado) |
| 727 | HACEDERO | M | T3 | Tres detectores de lectores de fs, cada uno por su cuenta: `scripts/mutation-plan.ts:944` (`analizaLectura`), `test/afectado.test.ts:~787`, `test/un-solo-barrido-del-banco.test.ts:93` (`LECTORES`) |

## Los issues, verbatim (con comentarios)

### #720

> test/saltos-del-guion.ts pasa de 860 líneas: trocearlo por responsabilidad
> 
> Tras #716, el detector de saltos mezcla tres cosas: la resolución del ctx y de los imports (`modulo`, `aliasDeCtx`, `receptorDeVerbo`, `llamadaLocal`, `funcionDe`), el juicio de valores (`esTautologia`, `esContradiccion`, `esEsperaTautologica`, `afirmante`, `afirmaSiempre`) y las reglas de salto (`saltosDe`, `condicionObservada`, `observadosAntes`). Vive en `test/`, así que ni CRAP ni mutación lo miden, y su única red son los negativos sintéticos de `un-salto-del-guion-se-observa.test.ts`. Propuesta: tres módulos con la misma API pública (`saltosDelGuion`, `condicionNormalizada`). Criterio: `npm test` verde y la foto del banco (226 saltos con `observado` y `porque`) idéntica byte a byte antes y después. Hay que coordinarlo con #704, que reescribe `helpers-del-banco.ts`, de donde este fichero importa.
> 
> Sale de la tanda AH (#716).
> Desde la tanda AO (#711): al trocear, extraer también un helper común de resolución por ámbito. Hoy tres detectores resuelven identificadores cada uno a su manera: el de sondas (alias por punto fijo, sin ámbitos), `funcionesDelFichero` en el de esperas, y `resuelve()` en `test/relojes-de-pared.ts` (este con ámbitos léxicos). Propuesta: `test/ambito-del-guion.ts` común, con la batería de sombreado de `el-reloj-de-pared-tiene-padron.test.ts` como caso.

### #727

> Tres detectores de readdirSync por el árbol: unificar el reconocimiento de lectores de node:fs
> 
> Sale de la tanda AL (#704). Hoy hay tres sitios que leen `readdirSync`/`readdir` por el AST, cada uno con su propia resolución de nombres de `node:fs`:
> 
> - `nefan-core/scripts/mutation-plan.ts` (`analizaLectura`/`directoriosLeidos`, que resuelve la carpeta dentro del paquete);
> - el censo de `nefan-core/test/afectado.test.ts` (alias, línea ~795);
> - `nefan-core/test/un-solo-barrido-del-banco.test.ts` (`nombresDelLector`: alias, espacio de nombres y destructurado de `import()` dinámico; recursión por `{recursive:true}` o autollamada).
> 
> Las tres ven formas distintas: una puede reconocer un alias o un import dinámico que otra no reconoce. Es la misma clase de divergencia que #704 cerró para el barrido del banco, trasladada a los detectores.
> 
> Propuesta: un helper compartido sin `describe`, que reciba un `ts.SourceFile` y devuelva los nombres locales de los lectores de `fs` y sus llamadas. Los tres lo importan, y los `_lo_que_esto_NO_sujeta` se reconcilian.
> 
> Anotado también por la tanda: el guion 163 no distingue un módulo que cae al cargar (p. ej. el zod del padrón lo tumba) de un aserto que no salta; los dos salen como «ningún aserto se entera».

## Criterios de aceptación

Mínimos: lógica en core; negativos en rojo; guion si hay algo observable; cero créditos (motor falso, `e2e-sin-creditos`). El coordinador ACEPTA la crítica (`critica.md`); lo que sigue es su bloque, con el orden que fija el coordinador.

**Orden:** primero #727; después #720 en dos pasos: (a) el falso verde de `aliasDeCtx` —negativo primero, arreglo después—; (b) el corte de la resolución de nombres, con la foto byte a byte.

**#727 (reencuadrada).** Son DOS detectores: `analizaLectura` (`scripts/mutation-plan.ts`) y `recorridos` (`test/un-solo-barrido-del-banco.test.ts`). `test/afectado.test.ts` es la batería del primero, no un tercero. `qa/el-selector-ve-lo-que-la-bateria-abre.mjs` se queda FUERA a propósito: es el oráculo independiente del selector. Un solo reconocedor de lectores de `node:fs`, en `scripts/` (los scripts no importan de `test/`), que usen los dos. La nota del guion 163 está cerrada por #749.

- C1. `descubrimientosDe` sobre `const { readdirSync: r } = await import("node:fs"); r(DIR)` y sobre `const leer = readdirSync; leer(DIR)` da `["data/scenes"]` (hoy `[]`, ciegos 0: negativo que nace rojo).
- C2. Las catorce formas de nombre de `un-solo-barrido…test.ts:424-439` las ven los DOS detectores, en una tabla compartida.
- C3. `import { readdirSync } from "./mio"` no cuenta como lector en ninguno de los dos.
- C4. `npm run afectado` sobre `main` selecciona lo mismo o MÁS, nunca menos; el diff de la selección va en el informe.
- C5. Los `_lo_que_esto_NO_sujeta` de los dos dicen lo mismo sobre nombres.

**#720 (reencuadrada).** El objetivo no son las 861 líneas: es que el detector de saltos resuelve el ctx SIN ÁMBITOS y eso puede EXCUSAR un salto (`saltos-del-guion.ts:340`). No trocear en tres: juicio y reglas son mutuamente recursivos (`afirmante` → `condicionObservada` → `observadosAntes` → `afirmante`). Si se trocea, que sea por el único corte limpio (resolución contra el resto).

- C6. Primero, un negativo que nace ROJO: un guion con un `c` ajeno, sombreado, que hoy excusa un salto.
- C7. La foto de `saltosDelGuion` sobre los 184 guiones (fichero, condición, `observado`, `porque`), guardada antes, idéntica después, salvo los cambios que el negativo explica uno a uno.
- C8. Antes de escribir un resolutor de ámbito compartido, el plan compara el binder de TypeScript contra la mano sobre la batería de sombreado de `el-reloj-de-pared-tiene-padron.test.ts`, y elige con números. El TypeChecker se usa solo donde la medida lo justifique; no se generalizan los cuatro resolvers en esta tanda.
- C9. No hay helper «común» parametrizado para cuatro semánticas: se comparte como mucho la búsqueda de declaración; el flujo de valor sigue siendo de cada detector.
- C10. Tras el corte (paso b), la foto de C7 es idéntica BYTE A BYTE a la del final del paso (a).

## Restricciones

- **Números de guion RESERVADOS: 222-225.** Otras tandas en paralelo: AX (atlas, `politica-de-atlas`/`fps-atlas`), BB (título), y las otras de esta ola (BE mapa/motor, BF CRAP del cliente, BH detectores del banco).
- Lint del banco en main: `no-unused-vars`, `no-useless-assignment`, `preserve-caught-error` con `requireCatchParameter`.
- Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node`.
