// El lint del banco (`qa/**/*.mjs`), con UNA regla: `no-unused-vars` (#733).
//
// Por qué vive aquí y no en `qa/`: bajo `qa/` solo caben las extensiones de
// `EXTENSIONES_DEL_BANCO` (un `.js` es ejecutable y reabre #686), y la config
// de este paquete no puede mirar `../qa` — ESLint 10 la ata a su directorio y
// todo lo de fuera sale «outside of the base path». Con `-c` el base path es
// el CWD, así que `lint:qa` se lanza desde la raíz del repo:
//   cd .. && eslint -c nefan-core/eslint.qa.config.js qa
//
// Por qué solo esa regla: con `recommended` (+ TS) el banco daba el
// 2026-09-24 3314 hallazgos, 3254 de ellos `no-undef` — globals del navegador
// y de Node, porque un guion mezcla Node con cuerpos de `page.evaluate`. Eso
// es ruido o una lista de globals que nadie mantendría. Lo que se busca aquí
// es el helper o el import que nadie usa: código muerto, o un aserto que se
// prometió y no se hace (la familia de #356).
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
    },
  },
];
