import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

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
  // POR QUÉ AQUÍ Y NO EN `arch-rules.json`, que es donde vive el resto de los
  // candados del repo, y la razón NO es la que se escribió primero: el motor
  // de fronteras SÍ sabe contar líneas (un `text.pattern` de N saltos da UNA
  // violación, no miles). El motivo es el coste, y va RE-MEDIDO hoy en vez de
  // citado: el caso CONFORME —el que corre siempre— es justo el lento, porque
  // la regex tiene que agotar el retroceso para poder decir que no. Medido el
  // 2026-09-01: un `main.ts` que NO viola (patrón de 4.000 saltos) cuesta 379
  // ms; los dos ficheros de ~1.650 líneas que tampoco violan, 216 ms entre los
  // dos; el que SÍ viola, 0 ms. Eso se pagaría en cada `npm test` y cada
  // `npm run deuda`.
  // A favor de eslint hay además algo que el otro motor no da: reporta «File
  // has too many lines (3136)», EL MISMO NÚMERO que `wc -l`, así que el
  // candado y el criterio de aceptación miden lo mismo.
  //
  // EL TOPE, 450, y por qué no 400: cualquier valor entre 389 y 543 exime
  // exactamente a los mismos cuatro ficheros (no hay nada entre 388 y 544), y
  // lo único que cambia es la holgura del peor no eximido —
  // `renderer/character-sprites.ts`, hoy 388. Con 400 le quedarían 12 líneas,
  // menos de una función documentada de esta casa: el primer edit honesto lo
  // pondría rojo y la respuesta sería subir el tope, que es el anti-patrón que
  // `quality-thresholds.json` prohíbe por escrito. Con 450 le quedan 62 sin
  // ceder un gramo de fuerza.
  //
  // LOS DOS `false` NO SON DECORACIÓN: con `skipComments` o `skipBlankLines`
  // el número del candado dejaría de ser el de `wc -l`, y entonces «main.ts
  // baja de 3.136» y «el candado no salta» medirían cosas distintas. Esta casa
  // documenta mucho: descontar comentarios sería además premiar el borrado de
  // prosa como si fuera troceo.
  //
  // LO QUE NO VE: (1) el CSS — `src/ui/game-ui.css` tiene 467 líneas y queda
  // fuera porque el bloque es `*.ts`; se dice en vez de callarlo, y entra el
  // día que alguien lo quiera candar. (2) Repartir 3.000 líneas en siete
  // ficheros de 430: el tope frena el crecimiento por fichero, no la
  // concentración (hoy 50,1 % del cliente en tres ficheros), y contra eso no
  // hay checker sino revisión.
  //
  // COSTE MEDIDO en este repo (tres corridas de `npm run lint` entero, 2026-09-01):
  // 2,58 / 2,67 / 2,63 s sin la regla → 2,67 / 2,65 / 2,66 s con ella. O sea,
  // dentro del ruido: `max-lines` cuenta saltos de línea sobre un AST que
  // eslint ya tenía parseado, no vuelve a leer nada.
  //
  // `error` y no `warn`: entra con CUATRO ocupantes, todos conocidos, todos
  // eximidos abajo con su cifra de HOY. Un `warn` es una lista que crece.
  {
    files: ["src/**/*.ts"],
    rules: {
      "max-lines": ["error", { max: 450, skipBlankLines: false, skipComments: false }],
    },
  },
  // Las CUATRO excepciones, congeladas en los valores de hoy (2026-09-01). El
  // número de cada una es su `wc -l` exacto, así que la excepción no da
  // holgura: exime lo que ya hay y prohíbe la línea siguiente. Cada entrega
  // que corte uno de estos ficheros BAJA su número en el mismo commit — si no,
  // el candado devuelve el hueco recién liberado.
  {
    // #358 · el fichero que abre esta tanda. Entró en 3.136 (game loop, carga
    // de tiles, colisión, diálogo, viaje, HUD, arranque, título y bootstrap) y
    // BAJA en el mismo commit que corta: 2.817 al llevarse la carga de tile a
    // `world/carga-de-tile.ts`, y 2.500 al repartir el bucle (mirada y paso a
    // `nefan-core`, más animación, frontera, eco de combate, saludo y volcado
    // del bridge a sus propios módulos). Si el número no bajara aquí, el
    // candado le devolvería al fichero el hueco recién liberado.
    files: ["src/main.ts"],
    rules: { "max-lines": ["error", { max: 2500, skipBlankLines: false, skipComments: false }] },
  },
  {
    // La fachada de three.js: es el ÚNICO fichero del repo que puede
    // importarlo (`three-solo-en-fps-gl` en arch-rules.json), así que trocearlo
    // exige antes decidir qué otro fichero hereda ese permiso. Sin issue
    // propio todavía.
    files: ["src/renderer/fps-gl.ts"],
    rules: { "max-lines": ["error", { max: 1687, skipBlankLines: false, skipComments: false }] },
  },
  {
    // #346 · trocear la pantalla de título es la continuación natural de #358.
    files: ["src/ui/title-screen.ts"],
    rules: { "max-lines": ["error", { max: 1651, skipBlankLines: false, skipComments: false }] },
  },
  {
    // La corrida de «Aplicar estilo» (subida de pack + confirmación de coste).
    // Cuelga de #346: es la mitad del título que vive fuera del título.
    files: ["src/ui/style-apply.ts"],
    rules: { "max-lines": ["error", { max: 544, skipBlankLines: false, skipComments: false }] },
  },
);
