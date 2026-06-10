/** Error del intérprete del DSL de plugins. Fail-loud: cualquier path
 *  malformado, operación sobre tipos incorrectos o violación de autorización
 *  lanza DslError; el caller (dispatcher/loader) decide cómo propagarlo. */
export class DslError extends Error {
  constructor(
    message: string,
    /** Path o expresión donde ocurrió, para diagnósticos. */
    public readonly where?: string,
  ) {
    super(where ? `${message} (en: ${where})` : message);
    this.name = "DslError";
  }
}
