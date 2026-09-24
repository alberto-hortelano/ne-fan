// El lint de los benches (`labs/**/*.{js,mjs,cjs}`), con UNA regla:
// `no-unused-vars` con `^_` exento, la misma del banco (#744).
//
// Por qué una config HERMANA y no un bloque más en `eslint.qa.config.js`: la
// del banco tiene dos candados que miden SOLO `qa/` —el guion 176 (A) cuenta
// que `lint:qa` devuelva exactamente los `.mjs` del banco, y
// `test/el-lint-del-banco-salta-lo-que-el-banco-salta.test.ts` exige que sus
// ignores sean `SALTOS_DEL_BANCO`—. Meter `labs/` ahí los rompe o los deja
// midiendo otra cosa. Aquí `labs/` tiene su pasada, su script (`lint:labs`) y
// sus guiones (186 el mecanismo, 187 el árbol real).
//
// Por qué solo esa regla: al encenderla (tanda AY, 2026-09-24) daba 3
// hallazgos, los tres en `labs/authoring/three/escena.js` (un parámetro por
// defecto que el cuerpo no leía, un `const` y un campo desestructurado sin
// usar); con `recommended` entero, nada más. Los `.ts` de `labs/` no pasan por
// aquí: los mira `typecheck:labs` (#309).
//
// Como `lint:qa`, se lanza desde la raíz (`cd .. && eslint -c … labs`): ESLint
// 10 ata la config a su directorio y todo lo de fuera sale «outside of the base
// path». Ignora `runs/`, que es lo que los `.gitignore` de los benches dejan
// fuera (el material de cada corrida); `node_modules` ya lo ignora ESLint. El
// guion 187 canda que lo lintado sea exactamente lo que git ve en `labs/`.
export default [
  { ignores: ["labs/**/runs/"] },
  {
    files: ["labs/**/*.{js,mjs,cjs}"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
