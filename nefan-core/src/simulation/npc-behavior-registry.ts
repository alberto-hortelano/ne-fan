/** Registro de sistemas de comportamiento ambiental de NPCs (patrón
 *  src/combat/registry.ts). A diferencia del combate, NO se congela en el
 *  save en v1: el behavior no persiste nada dependiente de la implementación
 *  (las posiciones viven en EntityRecord.position, agnósticas). Congelar
 *  cuando exista una segunda implementación. */

import { createSystemRegistry } from "../systems/registry.js";
import {
  createAmbientNpcBehavior,
  type NpcBehaviorDeps,
  type NpcBehaviorSystem,
} from "./npc-behavior.js";

export const npcBehaviorRegistry = createSystemRegistry<NpcBehaviorSystem, NpcBehaviorDeps>(
  "npc_behavior",
  "ambient",
  {
    ambient: createAmbientNpcBehavior,
  },
);
