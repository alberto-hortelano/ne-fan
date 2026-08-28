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
);
