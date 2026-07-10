/** Registro genérico de sistemas intercambiables (combate, input…).
 *
 *  Distinto de src/plugins/ (plugins declarativos narrativos): esto son
 *  módulos TS de hot loop con varias implementaciones registradas por id.
 *  Regla común: id ausente → default (la implementación actual); id
 *  desconocido → error con la lista de disponibles (fail-loud). */

export interface SystemRegistry<TImpl, TDeps> {
  /** Familia del sistema ("combat", "input"…) — solo para mensajes de error. */
  readonly kind: string;
  readonly defaultId: string;
  ids(): string[];
  has(id: string): boolean;
  /** id ausente/"" → defaultId. Id desconocido → Error (fail-loud). */
  create(id: string | undefined, deps: TDeps): TImpl;
}

export function createSystemRegistry<TImpl, TDeps>(
  kind: string,
  defaultId: string,
  factories: Record<string, (deps: TDeps) => TImpl>,
): SystemRegistry<TImpl, TDeps> {
  if (!factories[defaultId]) {
    throw new Error(`SystemRegistry(${kind}): default "${defaultId}" is not a registered factory`);
  }
  return {
    kind,
    defaultId,
    ids: () => Object.keys(factories),
    has: (id: string) => id in factories,
    create(id: string | undefined, deps: TDeps): TImpl {
      const effective = id || defaultId;
      const factory = factories[effective];
      if (!factory) {
        throw new Error(
          `unknown ${kind} system "${effective}" (available: ${Object.keys(factories).join(", ")})`,
        );
      }
      return factory(deps);
    },
  };
}
