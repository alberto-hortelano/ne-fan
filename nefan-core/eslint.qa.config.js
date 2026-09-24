// El lint del banco (`qa/**/*.mjs`), con TRES reglas: `no-unused-vars` (#733),
// `no-useless-assignment` y `preserve-caught-error` (#745).
//
// Por qué vive aquí y no en `qa/`: bajo `qa/` solo caben las extensiones de
// `EXTENSIONES_DEL_BANCO` (un `.js` es ejecutable y reabre #686), y la config
// de este paquete no puede mirar `../qa` — ESLint 10 la ata a su directorio y
// todo lo de fuera sale «outside of the base path». Con `-c` el base path es
// el CWD, así que `lint:qa` se lanza desde la raíz del repo:
//   cd .. && eslint -c nefan-core/eslint.qa.config.js qa
//
// Por qué no `recommended`: con él (+ TS) el banco daba el 2026-09-24 3314
// hallazgos, 3254 de ellos `no-undef` — globals del navegador y de Node,
// porque un guion mezcla Node con cuerpos de `page.evaluate`. Eso es ruido o
// una lista de globals que nadie mantendría. Se encienden las reglas una a
// una, con sus hallazgos clasificados antes:
//   · `no-unused-vars`: el helper o el import que nadie usa — código muerto,
//     o un aserto que se prometió y no se hace (la familia de #356);
//   · `no-useless-assignment`: una escritura que nadie lee antes de que otra
//     la pise. Va como prevención: el valor inicial que un `try` sobrescribe
//     antes de leerlo se escribe `let x;`;
//   · `preserve-caught-error` (con `requireCatchParameter`): un `throw`
//     dentro de un `catch` sin `{ cause }` pierde la causa del rojo, y un
//     `catch {}` sin parámetro no tiene causa que pasar, así que también cuenta.
// `no-irregular-whitespace` NO: su único hallazgo es el U+200B que
// `qa/dos-corridas.mjs` pone a propósito para que `*/` no cierre un comentario.
//
// Los ignores son los MISMOS directorios que salta el barrido del banco
// (`SALTOS_DEL_BANCO` en `test/banco-ficheros.ts`), y del mismo modo: por
// NOMBRE, a cualquier profundidad. `node_modules` no se escribe porque ESLint
// ya lo ignora siempre. Lo canda
// `test/el-lint-del-banco-salta-lo-que-el-banco-salta.test.ts`.
export default [
  { ignores: ["qa/**/.tmp/", "qa/**/capturas/"] },
  {
    files: ["qa/**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-useless-assignment": "error",
      "preserve-caught-error": ["error", { requireCatchParameter: true }],
    },
  },
];
