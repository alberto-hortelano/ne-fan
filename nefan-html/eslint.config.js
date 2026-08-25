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
  // `files` acota el bloque a propósito: `vite.config.ts` y este mismo fichero
  // están fuera del `include` del tsconfig, y un `projectService` global los
  // pondría rojos. `recommendedTypeChecked` entero daría 40 violaciones y es
  // otra tarea (#260).
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
    },
  },
);
