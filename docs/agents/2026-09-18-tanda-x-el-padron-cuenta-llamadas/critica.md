# Crítica — tanda X (#686): el padrón cuenta llamadas

**Veredicto: VIGENTE** — con tres retoques a `requisitos.md` (una premisa mal cifrada, el alcance del criterio 2 y el del 4). El trabajo es pequeño y no exige análisis de flujo.

## El problema real, en una frase

El padrón promete que «toda consulta de movimiento tiene dueño», pero cuenta cuántas veces se **escribe** el nombre, así que en los tres ficheros con alias se pueden añadir sondas nuevas sin que nada se ponga rojo. La solución propuesta (contar sitios de uso alcanzables desde el alias) ataca exactamente eso.

## La premisa, afirmación por afirmación

| Afirmación | Verificación |
|---|---|
| El detector cuenta nodos `Identifier`/`StringLiteralLike` con texto `probeCollide` | Cierto: `nefan-core/test/la-consulta-de-movimiento-tiene-dueno.test.ts:141-152` (`apariciones`) |
| Un alias es 1 nodo y alimenta N llamadas sin rojo | **Reproducido en seco** (prototipo en scratchpad, sin tocar el árbol): el 119 con `const extra = [pc(0,0)…pc(6,6)]` sigue dando `apariciones = 1`. Hoy el test pasa 11/11 (QA midió «10» sobre `5d7858c4`; desde entonces hay un `it` más) |
| «El `pc` declarado del 119 se llama 7 veces» (`_lo_que_esto_NO_sujeta` (3)) | **Falso como descripción del árbol**: `qa/guiones/119-…mjs:380-385` tiene UN sitio de llamada dentro de un bucle. Los 7 fueron los que QA AÑADIÓ en su experimento. El agujero es real; la cifra que lo describe en el contrato no |
| Los tres legítimos con alias son 93, 119, 133 | Cierto: `93:163`+`171`, `119:380`+`385`, `133:131`+`137`. Cada alias tiene **exactamente un** sitio de llamada; el 93 suma dos directas (`:463`, `:466`) |
| Solo mira `qa/**/*.mjs`; un `.ts` escapa también a `qa-lib-tiene-quien-lo-mire` | Cierto: `:171` (`endsWith(".mjs")`) y `qa-lib-tiene-quien-lo-mire.test.ts:127`. Hoy `find qa -name '*.ts'` = 0. Y **el agujero es ejecutable**: Node es `v24.11.1`, que corre `.ts` sin tsx, así que un `qa/lib/x.ts` importado desde un guion `.mjs` corre de verdad. Un guion `.ts` no: `qa/run.mjs:1339` descubre solo `.mjs` |
| Una indirección por `qa/lib/` abre la misma puerta | Hoy **sin sujeto**: `grep probeCollide qa/lib/` = 0. El alias `pc` vive dentro de `page.evaluate` (función del navegador) y no puede cruzar a Node; lo único que cruza es el string de `ctx.nefan("probeCollide", …)`, que se escribe en el sitio que lo usa y por tanto se cuenta allí |

## ¿Es posible con el AST que ya usa el test, o exige flujo?

**Con el mismo parser, una pasada sintáctica por fichero, sin type-checker ni flujo.** El prototipo (scratchpad, ~40 líneas sobre `ts.createSourceFile`) trata como alias un `VariableDeclaration` cuyo inicializador es `….probeCollide` / `[…"probeCollide"]` o un `BindingElement` con ese nombre, y cuenta las referencias al identificador ligado en vez del nodo de la declaración. Resultado sobre `qa/**` hoy: **los nueve ficheros dan la misma cifra que el padrón** (10:1, 14:1, 15:1, 73:1, 93:3, 119:1, 133:1, 144:1, 145:2) — el criterio 3 se cumple sin tocar un guion — y el experimento de QA da **8** (rojo). Lo que ese enfoque NO ve y hay que escribir en `_lo_que_esto_NO_sujeta` o cerrar de paso (barato, mismo mecanismo):
- **re-alias** `const q = pc; q(…)` → cuenta 1 salvo que la resolución sea transitiva (un `while` más);
- **string como dato** `const S = "probeCollide"; ctx.nefan(S, …)` → cuenta 1 salvo tratar el `const` con literal como alias (misma rama);
- **sombreado** (`const pc = () => 0` en otra función del mismo fichero) → **sobrecuenta** (2 en vez de 1): dirección segura, rojo que alguien mira;
- **alias pasado como valor** (`rumbos.map(pc)`) → cuenta 1 referencia, no las llamadas de dentro de `map`; es el límite honesto de «sitio de uso» y basta declararlo;
- **cruce de fichero** (`export const S`) → exige resolver imports; hoy no tiene sujeto y no debe cerrarse.

## El día después

- Para quien juega: nada; es deuda declarada del banco, y lo dice el issue.
- Cambia el **significado** de `apariciones`: de «nodos con el nombre» a «sitios de uso». Hay que reescribir la cabecera del test («El alias cuenta UNA vez […] y las seis llamadas van con él»), el `it` «cuenta las TRES grafías» (hoy afirma 6 sobre un texto con `pc` ×3, pasaría a 8), el `_comment` y el punto (3) de `_lo_que_esto_NO_sujeta`. Si no se barre, el contrato describe el detector anterior: rastro que confunde.
- Se cierra la puerta de «copio el `pc` de la línea de arriba»: es justo el gesto más probable en los tres ficheros que quedan con alias.
- Contar **por línea** (que el issue menciona y `requisitos.md` no pide): **no**. Los números de línea caducan con cada edición del fichero y el padrón churnearía en cada PR; la casa ya decidió que `fichero:línea` no es un ancla.

## Conflictos

- Ninguna otra tanda de hoy toca el test ni el padrón (grep sobre los 14 `requisitos.md`: solo esta y la de #662, ya cerrada en `47b53d11`). Tanda U (#680) no renumera ninguno de los nueve ficheros declarados.
- #673 (guion 15 «APLAZADA») sigue abierto; esta tanda no lo toca ni lo necesita.
- El agujero `.ts` **no es de dos tests: es de una familia**. `arch-rules.json` tiene siete reglas con glob `qa/**/*.mjs` (líneas 581, 650, 677, 731, 758, 775, 798, 844: puertos, banco-fuera-de-producción, etc.). Cerrar la extensión en dos detectores y dejar las siete reglas es cerrarlo a medias; lo que no debería hacerse es tocar dos globs y declararlo cerrado.

## Coste contra valor

Coste: una función de ~40 líneas en el test, sus `it` de negativo, el barrido de prosa del contrato. Sin corrida de mutación (`test/` no está en el perímetro). Valor: modesto pero exacto —el defecto que originó #662, reproducido y medido, sigue abierto en los únicos tres sitios donde se puede reproducir—. **No hacer nada** es defendible (el agujero está declarado y medido), pero deja el padrón afirmando «cada consulta tiene dueño» cuando cuenta otra cosa; y arreglarlo cuesta menos que la discusión.

## Qué le cambiaría a `requisitos.md`

Pegar tal cual:

> **Corrección de premisa.** Hoy el `pc` del 119 tiene UN sitio de llamada (`119:385`, en bucle); los «7» de `_lo_que_esto_NO_sujeta` (3) son los que QA añadió en su experimento. La frase del contrato se corrige con el barrido.
>
> **Criterio 1, precisado.** «Alcanzable» significa **sitios de uso** resueltos sintácticamente dentro del fichero (referencias al identificador ligado por `const x = ….probeCollide` / `{probeCollide}` / `{probeCollide: x}`), con el mismo `ts.createSourceFile` del test y sin type-checker. Los nueve declarados deben dar la MISMA cifra que hoy sin tocar ningún guion (medido: 10:1 14:1 15:1 73:1 93:3 119:1 133:1 144:1 145:2) y el experimento de QA sobre el 119 debe dar 8.
>
> **Criterio 2, acotado.** La indirección por `qa/lib/` NO tiene sujeto hoy (`grep probeCollide qa/lib/` = 0; el alias del navegador no cruza a Node). Se **declara y se mide** en `_lo_que_esto_NO_sujeta` con su `it`, como el nombre partido; no se cierra. Sí se cierran, por costar una rama más del mismo mecanismo, el re-alias (`const q = pc`) y el string en `const` (`const S = "probeCollide"`); y se declara el sombreado como sobrecuenta a propósito.
>
> **Criterio 4, con su familia.** El `.ts` bajo `qa/` corre de verdad (Node 24 lo ejecuta sin tsx) pero `qa/run.mjs:1339` solo descubre guiones `.mjs`, así que la puerta es `qa/lib/*.ts` importado desde un guion. Las siete reglas de `arch-rules.json` con glob `qa/**/*.mjs` comparten el agujero: o se cierra la extensión para TODA la familia en esta tanda, o se cierra en los dos tests y se abre issue con las siete líneas citadas. No vale «cerrado» con dos de nueve.
>
> **Fuera de alcance (añadir):** contar por línea.
