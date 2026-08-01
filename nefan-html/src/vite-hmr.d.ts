/** Tipado mínimo de la API HMR de Vite. Imprescindible usar la forma LITERAL
 *  `import.meta.hot` en el código: Vite detecta que un módulo acepta HMR
 *  buscando esa subcadena — un cast que la parta hace que el módulo cuente
 *  como no-aceptante y cualquier edición recargue la página entera. */
interface ImportMeta {
  readonly hot?: {
    accept(cb: (mod: unknown) => void): void;
    accept(dep: string, cb: (mod: unknown) => void): void;
    invalidate(): void;
  };
}
