/** EL HUD DE COMBATE: el catálogo de ataques del sistema de combate de la
 *  sesión, la barra con un botón por ataque (con su tecla 1..N) y los
 *  parámetros efectivos del ataque elegido, que alimentan el aro del telegraph.
 *
 *  Es presentación y nada más: qué ataques existen lo declara el sistema de
 *  combate (`combatRegistry`, core) y su id viene congelado en el save; el
 *  daño, el wind-up y el alcance REALES los resuelve el sim detrás del bridge.
 *  Aquí se pinta el catálogo y se le instala al proveedor de input el mapeo
 *  «qué tecla pide qué ataque» — el proveedor sigue siendo el dueño de la
 *  selección, y este módulo se repinta cuando él avisa. */

import type { EffectiveParams } from "@nefan-core/src/types.js";
import { getEffectiveParams, loadConfig } from "@nefan-core/src/combat/combat-data.js";
import { combatRegistry } from "@nefan-core/src/combat/registry.js";
import type { AttackSpec } from "@nefan-core/src/combat/combat-system.js";
import combatConfigJson from "@nefan-core/data/combat_config.json";
import type { InputProvider } from "../input/input-provider.js";
import { ActionBar } from "./action-bar.js";

const config = loadConfig(combatConfigJson);

export interface DepsDelHudDeCombate {
  /** El proveedor de input, dueño de la selección: recibe el mapeo 1..N de
   *  cada sistema y se le pregunta el ataque elegido. Es un `let` del
   *  bootstrap de `main.ts`, así que cruza como pregunta. */
  input(): Pick<InputProvider, "state" | "selectAttack" | "setAttackBindings" | "onAttackTypeChanged">;
  /** El arma con la que se calculan los parámetros del ataque elegido. */
  armaDelJugador: string;
  log(msg: string): void;
}

export interface HudDeCombate {
  /** La barra de ataques, para quien necesita más que pintarla: el seam del
   *  banco (`snapshot()`). */
  readonly barra: ActionBar;
  /** Instala el sistema de combate de la sesión: catálogo, mapeo 1..N y barra
   *  se regeneran desde lo que declara el sistema. `""` = sin sesión →
   *  estándar. */
  aplicarSistema(id: string): void;
  /** Los parámetros efectivos del ataque que el jugador tiene elegido AHORA,
   *  con su arma: distancia óptima, tolerancia y radio del área. */
  parametrosSeleccionados(): EffectiveParams;
  /** El catálogo del sistema vigente. */
  catalogo(): readonly AttackSpec[];
  /** Id efectivo del sistema de combate de la sesión (`""` = sin sesión). */
  sistemaId(): string;
}

export function crearHudDeCombate(deps: DepsDelHudDeCombate): HudDeCombate {
  /** Ataques del sistema de combate de la sesión, clicables y con su tecla. */
  const barra = new ActionBar(document.getElementById("action-bar") as HTMLElement);

  // Espejo de applyRenderModes: el id viene congelado en el save
  // (world.combat_system); "" (sin sesión / saves previos) = estándar. El HUD
  // y el mapeo 1..N se regeneran desde el catálogo que declara el sistema.
  let catalogoDeAtaques: readonly AttackSpec[] = [];
  /** Id efectivo del sistema de combate de la sesión ("" = sin sesión). */
  let idDelSistema = "";

  /** Selector de ataque: un botón por ataque del catálogo de la sesión, con su
   *  tecla. El provider sigue siendo el dueño de la selección — el click es un
   *  origen más de intención, igual que la tecla. */
  function pintarBarra(): void {
    const input = deps.input();
    barra.set(
      catalogoDeAtaques.map((spec, i) => ({
        id: `attack:${spec.id}`,
        label: spec.label,
        key: String(i + 1),
        active: input.state.selectedAttack === spec.id,
        invoke: () => input.selectAttack(spec.id),
      })),
    );
  }

  function aplicarSistema(id: string): void {
    idDelSistema = id;
    catalogoDeAtaques = combatRegistry.create(id || undefined, config).attacks;
    deps.input().setAttackBindings(catalogoDeAtaques.map((a) => a.id));
    pintarBarra();
    if (id) {
      deps.log(`Combate: ${id} (${catalogoDeAtaques.length} ataque${catalogoDeAtaques.length === 1 ? "" : "s"})`);
    }
  }

  function parametrosSeleccionados(): EffectiveParams {
    const type = deps.input().state.selectedAttack;
    if (config.attack_types[type]) {
      const weaponData = config.weapons[deps.armaDelJugador] ?? config.weapons["unarmed"];
      return getEffectiveParams(type, config.attack_types, weaponData);
    }
    // Ataques fuera de combat_config.json (p.ej. "strike" del combate básico):
    // params sintéticos desde el catálogo — solo alimentan el feedback visual
    // del aro de ataque (el daño real lo resuelve el sistema en el bridge).
    const spec = catalogoDeAtaques.find((a) => a.id === type);
    if (!spec) {
      throw new Error(`parametrosSeleccionados: attack '${type}' is neither in combat_config nor in the session catalog`);
    }
    return {
      optimal_distance: spec.displayRange / 2,
      distance_tolerance: spec.displayRange / 2, // el aro cubre [0, displayRange]
      area_radius: spec.displayRange,
      base_damage: 0,
      damage_reduction: 0,
      wind_up_time: 0,
    };
  }

  // Cada cambio de selección (tecla o click) repinta la barra. El proveedor
  // admite UN oyente y es este; `setAttackBindings` ya avisa por aquí, así que
  // la suscripción va ANTES del primer sistema.
  deps.input().onAttackTypeChanged = () => pintarBarra();
  aplicarSistema(""); // arranque sin sesión: catálogo estándar

  return {
    barra,
    aplicarSistema,
    parametrosSeleccionados,
    catalogo: () => catalogoDeAtaques,
    sistemaId: () => idDelSistema,
  };
}
