/** Dev menu state — shared between frontends. */

import type { Vec3 } from "../types.js";

export interface DevState {
  menuOpen: boolean;
  selectedRoom: string;
  debugInfo: {
    fps: number;
    playerPos: Vec3;
    currentRoom: string;
    bridgeConnected: boolean;
    attackType: string;
    playerHp: number;
  };
}

export function createDevState(): DevState {
  return {
    menuOpen: false,
    selectedRoom: "",
    debugInfo: {
      fps: 0,
      playerPos: { x: 0, y: 0, z: 0 },
      currentRoom: "",
      bridgeConnected: false,
      attackType: "quick",
      playerHp: 100,
    },
  };
}
