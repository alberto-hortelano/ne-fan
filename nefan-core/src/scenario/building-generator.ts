/** Building generator — creates building geometry as arrays of JSON objects. */

import type { Vec3 } from "../types.js";

export interface BuildingSpec {
  id: string;
  width: number;
  depth: number;
  wallHeight?: number;
  wallThickness?: number;
  numRooms?: number;
  doorWidth?: number;
  doorHeight?: number;
  description?: string;
  style?: string;
}

export interface BuildingObject {
  id: string;
  mesh: "box";
  position: [number, number, number];
  scale: [number, number, number];
  category: "building";
  description: string;
  texture_prompt?: string;
}

export interface BuildingRoom {
  index: number;
  center: Vec3;
  width: number;
  depth: number;
  height: number;
}

export interface GeneratedBuilding {
  objects: BuildingObject[];
  rooms: BuildingRoom[];
}

const DEFAULT_WALL_HEIGHT = 3.5;
const DEFAULT_WALL_THICKNESS = 0.15;
const DEFAULT_DOOR_WIDTH = 1.5;
const DEFAULT_DOOR_HEIGHT = 2.5;

export class BuildingGenerator {
  /** Generate a building centered at origin. Caller offsets to world position. */
  generate(spec: BuildingSpec): GeneratedBuilding {
    const w = spec.width;
    const d = spec.depth;
    const h = spec.wallHeight ?? DEFAULT_WALL_HEIGHT;
    const t = spec.wallThickness ?? DEFAULT_WALL_THICKNESS;
    const doorW = spec.doorWidth ?? DEFAULT_DOOR_WIDTH;
    const doorH = spec.doorHeight ?? DEFAULT_DOOR_HEIGHT;
    const numRooms = Math.min(spec.numRooms ?? 1, 4);
    const style = spec.style ?? "medieval";
    const bid = spec.id;

    const objects: BuildingObject[] = [];

    // Floor
    objects.push({
      id: `${bid}_floor`,
      mesh: "box",
      position: [0, -t / 2, 0],
      scale: [w, t, d],
      category: "building",
      description: `suelo de ${spec.description ?? "edificio"}`,
      texture_prompt: `${style} floor, stone or wooden planks, seamless tiling`,
    });

    // Ceiling
    objects.push({
      id: `${bid}_ceiling`,
      mesh: "box",
      position: [0, h + t / 2, 0],
      scale: [w, t, d],
      category: "building",
      description: `techo de ${spec.description ?? "edificio"}`,
      texture_prompt: `${style} ceiling, wooden beams, seamless tiling`,
    });

    // Exterior walls — south has door by default
    // North wall (z = -d/2) — solid
    objects.push(...this.createWallSegments(
      bid, "north", w, h, t, -d / 2, "z", null, doorW, doorH, style,
    ));

    // South wall (z = +d/2) — with door
    objects.push(...this.createWallSegments(
      bid, "south", w, h, t, d / 2, "z", 0, doorW, doorH, style,
    ));

    // East wall (x = +w/2)
    objects.push(...this.createWallSegments(
      bid, "east", d, h, t, w / 2, "x", null, doorW, doorH, style,
    ));

    // West wall (x = -w/2)
    objects.push(...this.createWallSegments(
      bid, "west", d, h, t, -w / 2, "x", null, doorW, doorH, style,
    ));

    // Interior walls and rooms
    const rooms = this.generateRooms(bid, w, d, h, t, numRooms, doorW, doorH, style, objects);

    return { objects, rooms };
  }

  /**
   * Create wall segments with optional door gap.
   * axis="z" for N/S walls (span along X), axis="x" for E/W walls (span along Z).
   * doorOffset: null = solid wall, number = door center offset along wall span.
   */
  private createWallSegments(
    bid: string,
    label: string,
    span: number,
    height: number,
    thickness: number,
    fixedPos: number,
    axis: "x" | "z",
    doorOffset: number | null,
    doorWidth: number,
    doorHeight: number,
    style: string,
  ): BuildingObject[] {
    const desc = `pared ${label} de edificio`;
    const texPrompt = `${style} wall, rough plaster or stone, seamless tiling`;

    if (doorOffset === null) {
      // Solid wall
      const pos: [number, number, number] = axis === "z"
        ? [0, height / 2, fixedPos]
        : [fixedPos, height / 2, 0];
      const scale: [number, number, number] = axis === "z"
        ? [span, height, thickness]
        : [thickness, height, span];
      return [{
        id: `${bid}_wall_${label}`,
        mesh: "box",
        position: pos,
        scale: scale,
        category: "building",
        description: desc,
        texture_prompt: texPrompt,
      }];
    }

    // Wall with door gap
    const segments: BuildingObject[] = [];
    const halfSpan = span / 2;
    const halfDoor = doorWidth / 2;

    // Left segment
    const leftLen = halfSpan - halfDoor;
    if (leftLen > 0.01) {
      const leftCenter = -halfSpan + leftLen / 2;
      const pos: [number, number, number] = axis === "z"
        ? [leftCenter + doorOffset, height / 2, fixedPos]
        : [fixedPos, height / 2, leftCenter + doorOffset];
      const scale: [number, number, number] = axis === "z"
        ? [leftLen, height, thickness]
        : [thickness, height, leftLen];
      segments.push({
        id: `${bid}_wall_${label}_left`,
        mesh: "box",
        position: pos,
        scale: scale,
        category: "building",
        description: desc,
        texture_prompt: texPrompt,
      });
    }

    // Right segment
    const rightLen = halfSpan - halfDoor;
    if (rightLen > 0.01) {
      const rightCenter = halfSpan - rightLen / 2;
      const pos: [number, number, number] = axis === "z"
        ? [rightCenter + doorOffset, height / 2, fixedPos]
        : [fixedPos, height / 2, rightCenter + doorOffset];
      const scale: [number, number, number] = axis === "z"
        ? [rightLen, height, thickness]
        : [thickness, height, rightLen];
      segments.push({
        id: `${bid}_wall_${label}_right`,
        mesh: "box",
        position: pos,
        scale: scale,
        category: "building",
        description: desc,
        texture_prompt: texPrompt,
      });
    }

    // Lintel (above door)
    const lintelH = height - doorHeight;
    if (lintelH > 0.01) {
      const pos: [number, number, number] = axis === "z"
        ? [doorOffset, doorHeight + lintelH / 2, fixedPos]
        : [fixedPos, doorHeight + lintelH / 2, doorOffset];
      const scale: [number, number, number] = axis === "z"
        ? [doorWidth, lintelH, thickness]
        : [thickness, lintelH, doorWidth];
      segments.push({
        id: `${bid}_wall_${label}_lintel`,
        mesh: "box",
        position: pos,
        scale: scale,
        category: "building",
        description: desc,
        texture_prompt: texPrompt,
      });
    }

    return segments;
  }

  /** Generate interior walls and return room metadata. */
  private generateRooms(
    bid: string,
    w: number,
    d: number,
    h: number,
    t: number,
    numRooms: number,
    doorW: number,
    doorH: number,
    style: string,
    objects: BuildingObject[],
  ): BuildingRoom[] {
    const rooms: BuildingRoom[] = [];

    if (numRooms <= 1) {
      // Single room — entire building interior
      rooms.push({
        index: 0,
        center: { x: 0, y: 0, z: 0 },
        width: w - t * 2,
        depth: d - t * 2,
        height: h,
      });
      return rooms;
    }

    if (numRooms === 2) {
      // Split along Z axis at midpoint
      const wallZ = 0;
      objects.push(...this.createWallSegments(
        bid, "interior_0", w - t * 2, h, t, wallZ, "z", 0, doorW, doorH, style,
      ));

      const roomDepth = d / 2 - t;
      rooms.push({
        index: 0,
        center: { x: 0, y: 0, z: -d / 4 },
        width: w - t * 2,
        depth: roomDepth,
        height: h,
      });
      rooms.push({
        index: 1,
        center: { x: 0, y: 0, z: d / 4 },
        width: w - t * 2,
        depth: roomDepth,
        height: h,
      });
      return rooms;
    }

    if (numRooms === 3) {
      // Three rooms split along Z
      const third = d / 3;
      const wallZ1 = -third / 2;
      const wallZ2 = third / 2;

      objects.push(...this.createWallSegments(
        bid, "interior_0", w - t * 2, h, t, wallZ1, "z", 0, doorW, doorH, style,
      ));
      objects.push(...this.createWallSegments(
        bid, "interior_1", w - t * 2, h, t, wallZ2, "z", 0, doorW, doorH, style,
      ));

      const roomDepth = third - t;
      for (let i = 0; i < 3; i++) {
        rooms.push({
          index: i,
          center: { x: 0, y: 0, z: -d / 3 + i * third },
          width: w - t * 2,
          depth: roomDepth,
          height: h,
        });
      }
      return rooms;
    }

    // 4 rooms — 2x2 grid
    const wallZ = 0;
    const wallX = 0;

    // Horizontal wall (spans X, splits Z)
    objects.push(...this.createWallSegments(
      bid, "interior_h", w - t * 2, h, t, wallZ, "z", 0, doorW, doorH, style,
    ));
    // Vertical wall (spans Z, splits X) — two halves with doors
    // Top half (z < 0)
    objects.push(...this.createWallSegments(
      bid, "interior_v_top", d / 2 - t, h, t, wallX, "x", 0, doorW, doorH, style,
    ));
    // Bottom half (z > 0)
    objects.push(...this.createWallSegments(
      bid, "interior_v_bot", d / 2 - t, h, t, wallX, "x", 0, doorW, doorH, style,
    ));

    const roomW = w / 2 - t;
    const roomD = d / 2 - t;
    const offsets: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (let i = 0; i < 4; i++) {
      const [ox, oz] = offsets[i];
      rooms.push({
        index: i,
        center: { x: ox * w / 4, y: 0, z: oz * d / 4 },
        width: roomW,
        depth: roomD,
        height: h,
      });
    }

    return rooms;
  }
}
