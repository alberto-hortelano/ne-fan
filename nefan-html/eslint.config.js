import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

import tamano from "../nefan-core/data/contract/client-file-size.json" with { type: "json" };

/** Opciones de `max-lines` para un tope dado. Los dos `false` son los que
 *  hacen que el número del candado sea el mismo que `wc -l` — ver el bloque de
 *  abajo. */
const topeDe = (max) => ({ max, skipBlankLines: false, skipComments: false });

export default tseslint.config(
  { ignores: ["dist/", "node_modules/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Reglas CON TIPOS, solo para el código del cliente (#248).
  //
  // `no-floating-promises` es el backstop de `html-sin-promesa-muda`: aquel
  // candado (arch-rules.json) caza el idioma HONESTO —quien escribe `void`
  // declara que sabe que es una promesa— y deja pasar al descuidado que
  // simplemente llama a una `async function` y sigue. Eso es lo que hacía del
  // selector «Room» un no-op mudo si el módulo de la fixture fallaba.
  // Las dos reglas son COMPLEMENTARIAS, no sustitutas: con `ignoreVoid: true`
  // (el defecto) esta acepta `void p()` sin catch, que es justo lo que el
  // candado del repo persigue.
  //
  // `no-misused-promises` cierra el tercer hueco (#260): entregar una `async`
  // a quien espera una función que no devuelve nada — un `addEventListener`,
  // típicamente. Ahí el rechazo no lo recoge nadie: no hay `void` (así que
  // `html-sin-promesa-muda` no lo ve) y no hay llamada suelta descartada (así
  // que `no-floating-promises` tampoco). Las SEIS que había estaban en
  // `title-screen.ts` y solo UNA perdía algo de verdad —la de subir un estilo,
  // con el `await` del `FileReader` fuera del `try`, o sea un click mudo—;
  // las otras cinco tenían el cuerpo entero en `try/catch` y se ajustaron
  // porque la regla lo pide, no porque mordieran. Coste medido de la regla en
  // este repo: 2,16 s → 2,68 s el `npm run lint` entero.
  //
  // `files` acota el bloque a propósito: `vite.config.ts` y este mismo fichero
  // están fuera del `include` del tsconfig, y un `projectService` global los
  // pondría rojos. `recommendedTypeChecked` entero seguiría dando decenas de
  // violaciones y es otra tarea: lo que cierra #260 son estas dos reglas
  // nombradas, no el preset.
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  // EL INPUT DE JUEGO SOLO SE REGISTRA EN LA PUERTA (#285), mirando la
  // LLAMADA y no el texto.
  //
  // El candado hermano de `arch-rules.json`
  // (`teclas-de-juego-pasan-por-la-puerta`) es un patrón sobre el texto, y un
  // patrón sobre el texto es una lista de formas de escribir: tres pasadas
  // sucesivas encontraron ocho —comillas simples, `document.`,
  // `document.body.`, `window.onkeydown =`, la forma multilínea de prettier,
  // `addEventListener` a secas con el `window` implícito y
  // `globalThis.`—, y siempre queda una más. Esta regla mira el AST: el
  // receptor, el nombre del método y el primer argumento. Da igual cómo se
  // escriba.
  //
  // LO QUE NO VE, dicho porque tampoco lo ve un AST sin tipos: el receptor
  // por ALIAS (`const w = window; w.addEventListener("keydown", …)`).
  // Reconocerlo exige seguir el tipo de una variable. No tiene ocupante hoy.
  //
  // La puerta se exime abajo: es donde se DEFINE el registro.
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='addEventListener'][callee.object.name=/^(window|globalThis|document)$/][arguments.0.value=/^(keydown|mousedown)$/]",
          message:
            "El input de juego se registra SOLO en input/puerta-de-teclado.ts (alPulsarTecla / alPulsarRaton): con el título delante el mundo no se ve y la tecla no debe responder (#285).",
        },
        {
          selector:
            "CallExpression[callee.property.name='addEventListener'][callee.object.property.name='body'][arguments.0.value=/^(keydown|mousedown)$/]",
          message:
            "El input de juego se registra SOLO en input/puerta-de-teclado.ts (#285). `document.body` no es una excepción.",
        },
        {
          selector:
            "CallExpression[callee.type='Identifier'][callee.name='addEventListener'][arguments.0.value=/^(keydown|mousedown)$/]",
          message:
            "El input de juego se registra SOLO en input/puerta-de-teclado.ts (#285). `addEventListener` a secas es `window.addEventListener`.",
        },
        {
          selector: "AssignmentExpression[left.property.name=/^on(keydown|mousedown)$/]",
          message:
            "El input de juego se registra SOLO en input/puerta-de-teclado.ts (#285). Asignar `onkeydown`/`onmousedown` es lo mismo con otra sintaxis.",
        },
      ],
    },
  },
  {
    // La puerta: prohibirlo aquí sería prohibir que exista.
    files: ["src/input/puerta-de-teclado.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  // NINGÚN FICHERO DEL CLIENTE CRECE POR ENCIMA DE DONDE ESTÁ HOY (#358).
  //
  // Es el único invariante estructural de esta casa que dependía de que
  // alguien se acordara: `scripts/deuda.ts` declara por escrito que el tamaño
  // de un fichero queda fuera de su alcance, así que trocear `main.ts` no
  // tenía ni métrica de éxito ni freno — nada impedía que recuperase mañana
  // las líneas que perdiera hoy. Y el problema medido NO es la foto (3.136
  // líneas) sino la derivada: +894 líneas (+39,9 %) en 30 días, tocado en 72
  // de 366 commits.
  //
  // LOS NÚMEROS NO ESTÁN AQUÍ: viven en `data/contract/client-file-size.json`,
  // con el resto de los contratos del repo, y este bloque los CONSUME. No es
  // orden: es que un número escrito solo aquí no lo puede vigilar nadie.
  // Eslint sabe decir «te has pasado» y no sabe decir «esta excepción sobra
  // desde que troceaste el fichero» — el día que #346 baje `title-screen.ts`
  // de 1.651 a 900, una excepción que siga diciendo 1.651 le regala 751 líneas
  // de recrecimiento en silencio (QA 2026-09-01, H-2). Ese es el trabajo de
  // `nefan-core/test/client-file-size.test.ts`, que exige que cada cifra sea
  // EXACTAMENTE el `wc -l` de su fichero y denuncia la que sobre.
  //
  // POR QUÉ EL CONTEO VIVE EN ESLINT Y NO EN `arch-rules.json`, que es donde
  // vive el resto de los candados del repo, y la razón NO es la que se escribió
  // primero: el motor de fronteras SÍ sabe contar líneas (un `text.pattern` de
  // N saltos da UNA violación, no miles). El motivo es el coste, y va
  // RE-MEDIDO en vez de citado: el caso CONFORME —el que corre siempre— es
  // justo el lento, porque la regex tiene que agotar el retroceso para poder
  // decir que no. Medido el 2026-09-01: un `main.ts` que NO viola (patrón de
  // 4.000 saltos) cuesta 379 ms; los dos ficheros de ~1.650 líneas que tampoco
  // violan, 216 ms entre los dos; el que SÍ viola, 0 ms. Eso se pagaría en cada
  // `npm test` y cada `npm run deuda`. A favor de eslint hay además algo que el
  // otro motor no da: reporta «File has too many lines (3136)», EL MISMO NÚMERO
  // que `wc -l`, así que el candado y el criterio de aceptación miden lo mismo.
  //
  // LOS DOS `false` NO SON DECORACIÓN: con `skipComments` o `skipBlankLines`
  // el número del candado dejaría de ser el de `wc -l`, y entonces «main.ts
  // baja de 3.136» y «el candado no salta» medirían cosas distintas. Esta casa
  // documenta mucho: descontar comentarios sería además premiar el borrado de
  // prosa como si fuera troceo.
  //
  // LO QUE ESTE BLOQUE NO PUEDE HACER, y por eso tiene DOS acompañantes en
  // otro motor: (1) no puede impedir que lo apaguen — un `/* eslint-disable
  // max-lines */` en la primera línea devuelve el fichero al régimen anterior
  // con exit 0 y sin una palabra en la salida, así que eso lo cierra
  // `el-tope-de-tamano-no-se-apaga-con-un-comentario` en `arch-rules.json`;
  // (2) no puede ver envejecer sus propias excepciones — eso lo cierra el test
  // de arriba. Y lo que NO cubre nadie: el CSS (`src/ui/game-ui.css`, 467
  // líneas, fuera porque el régimen es `.ts`) y la CONCENTRACIÓN, porque
  // repartir 3.000 líneas en siete ficheros de 430 le parece bien a todos.
  //
  // COSTE MEDIDO en este repo (tres corridas de `npm run lint` entero, 2026-09-01):
  // 2,58 / 2,67 / 2,63 s sin la regla → 2,67 / 2,65 / 2,66 s con ella. O sea,
  // dentro del ruido: `max-lines` cuenta saltos de línea sobre un AST que
  // eslint ya tenía parseado, no vuelve a leer nada.
  //
  // `error` y no `warn`: entra con CUATRO ocupantes, todos conocidos, todos
  // eximidos con su cifra de HOY. Un `warn` es una lista que crece.
  {
    files: ["src/**/*.ts"],
    rules: { "max-lines": ["error", topeDe(tamano.tope)] },
  },
  // Las cuatro excepciones, generadas desde el contrato. El motivo de cada una
  // viaja con su número, en el JSON: separarlos es como se acaba con una cifra
  // que nadie sabe por qué está.
  ...tamano.excepciones.map((e) => ({
    files: [e.fichero],
    rules: { "max-lines": ["error", topeDe(e.lineas)] },
  })),
);
