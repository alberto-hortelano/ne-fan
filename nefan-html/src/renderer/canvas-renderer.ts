/** 2D top-down room renderer on Canvas. */

import type { Vec3 } from "../../nefan-core/src/types.js";

interface RoomData {
  room_id: string;
  room_description: string;
  dimensions: { width: number; height: number; depth: number };
  exits: { wall: string; offset: number; size: number[] }[];
  objects: { id: string; position: number[]; scale: number[]; category: string; description: string }[];
  npcs: { id: string; name: string; position: number[] }[];
  lighting: { ambient: { color: number[]; intensity: number }; lights: { position: number[]; color: number[]; range: number }[] };
}

interface Entity {
  id: string;
  pos: Vec3;
  radius: number;
  color: string;
  label: string;
  hp?: number;
  maxHp?: number;
  alive: boolean;
}

const WALL_COLOR = "#3a3a3a";
const FLOOR_COLOR = "#252520";
const EXIT_COLOR = "#1a1a14";
const GRID_COLOR = "#2a2a25";
const PLAYER_COLOR = "#4a9";
const ENEMY_COLOR = "#c44";
const OBJECT_COLOR = "#886";
const NPC_COLOR = "#68c";
const LIGHT_COLOR = "rgba(255,200,100,0.08)";

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 40; // pixels per meter
  private offsetX = 0;
  private offsetY = 0;
  private roomData: RoomData | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight - 30; // HUD height
  }

  setRoom(data: RoomData): void {
    this.roomData = data;
    // Center room in canvas
    this.offsetX = this.canvas.width / 2;
    this.offsetY = this.canvas.height / 2;
  }

  /** Convert world XZ to screen XY (top-down, Z goes up on screen) */
  private toScreen(x: number, z: number): [number, number] {
    return [
      this.offsetX + x * this.scale,
      this.offsetY + z * this.scale,
    ];
  }

  render(
    player: { pos: Vec3; forward: Vec3; hp: number; maxHp: number },
    enemies: Entity[],
    objects: Entity[],
  ): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);

    if (!this.roomData) return;
    const dims = this.roomData.dimensions;
    const halfW = dims.width / 2;
    const halfD = dims.depth / 2;

    // Floor
    const [fx, fy] = this.toScreen(-halfW, -halfD);
    const fw = dims.width * this.scale;
    const fh = dims.depth * this.scale;
    ctx.fillStyle = FLOOR_COLOR;
    ctx.fillRect(fx, fy, fw, fh);

    // Grid
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let gx = -halfW; gx <= halfW; gx++) {
      const [sx] = this.toScreen(gx, -halfD);
      ctx.beginPath(); ctx.moveTo(sx, fy); ctx.lineTo(sx, fy + fh); ctx.stroke();
    }
    for (let gz = -halfD; gz <= halfD; gz++) {
      const [, sy] = this.toScreen(-halfW, gz);
      ctx.beginPath(); ctx.moveTo(fx, sy); ctx.lineTo(fx + fw, sy); ctx.stroke();
    }

    // Walls
    ctx.strokeStyle = WALL_COLOR;
    ctx.lineWidth = 4;
    const walls: [number, number, number, number][] = [
      [-halfW, -halfD, halfW, -halfD],  // north
      [halfW, -halfD, halfW, halfD],     // east
      [-halfW, halfD, halfW, halfD],     // south
      [-halfW, -halfD, -halfW, halfD],   // west
    ];
    for (const [x1, z1, x2, z2] of walls) {
      const [sx1, sy1] = this.toScreen(x1, z1);
      const [sx2, sy2] = this.toScreen(x2, z2);
      ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
    }

    // Exits (gaps in walls)
    ctx.strokeStyle = EXIT_COLOR;
    ctx.lineWidth = 6;
    for (const exit of this.roomData.exits) {
      const ew = exit.size[0];
      const eOff = exit.offset;
      let ex1: number, ez1: number, ex2: number, ez2: number;
      switch (exit.wall) {
        case "north": ex1 = eOff - ew/2; ez1 = -halfD; ex2 = eOff + ew/2; ez2 = -halfD; break;
        case "south": ex1 = eOff - ew/2; ez1 = halfD; ex2 = eOff + ew/2; ez2 = halfD; break;
        case "east":  ex1 = halfW; ez1 = eOff - ew/2; ex2 = halfW; ez2 = eOff + ew/2; break;
        case "west":  ex1 = -halfW; ez1 = eOff - ew/2; ex2 = -halfW; ez2 = eOff + ew/2; break;
        default: continue;
      }
      const [sx1, sy1] = this.toScreen(ex1, ez1);
      const [sx2, sy2] = this.toScreen(ex2, ez2);
      ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
    }

    // Lights (soft circles)
    for (const light of this.roomData.lighting.lights) {
      const [lx, ly] = this.toScreen(light.position[0], light.position[2]);
      const lr = (light.range ?? 5) * this.scale;
      const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
      const c = light.color;
      grad.addColorStop(0, `rgba(${c[0]*255|0},${c[1]*255|0},${c[2]*255|0},0.15)`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
    }

    // Objects
    for (const obj of objects) {
      this.drawEntity(obj);
    }

    // Enemies
    for (const e of enemies) {
      if (e.alive) this.drawEntity(e);
    }

    // Player
    this.drawPlayer(player);

    // Room description
    ctx.fillStyle = "#666";
    ctx.font = "11px monospace";
  }

  private drawPlayer(player: { pos: Vec3; forward: Vec3; hp: number; maxHp: number }): void {
    const ctx = this.ctx;
    const [px, py] = this.toScreen(player.pos.x, player.pos.z);
    const r = 10;

    // Player circle
    ctx.fillStyle = PLAYER_COLOR;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();

    // Forward direction indicator
    const fLen = 18;
    const fx = px + player.forward.x * fLen;
    const fy = py + player.forward.z * fLen;
    ctx.strokeStyle = PLAYER_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(fx, fy); ctx.stroke();

    // HP bar above
    this.drawHpBar(px, py - 16, player.hp, player.maxHp, "#4a9");
  }

  private drawEntity(e: Entity): void {
    const ctx = this.ctx;
    const [ex, ey] = this.toScreen(e.pos.x, e.pos.z);

    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.arc(ex, ey, e.radius, 0, Math.PI * 2); ctx.fill();

    // HP bar if applicable
    if (e.hp !== undefined && e.maxHp !== undefined) {
      this.drawHpBar(ex, ey - e.radius - 6, e.hp, e.maxHp, e.color);
    }
  }

  private drawHpBar(cx: number, cy: number, hp: number, maxHp: number, color: string): void {
    const ctx = this.ctx;
    const bw = 24;
    const bh = 3;
    const x = cx - bw / 2;
    ctx.fillStyle = "#333";
    ctx.fillRect(x, cy, bw, bh);
    const fill = Math.max(0, hp / maxHp);
    ctx.fillStyle = color;
    ctx.fillRect(x, cy, bw * fill, bh);
  }

  /** Draw attack area visualization during wind-up or impact flash */
  drawAttackArea(
    player: { pos: Vec3; forward: Vec3 },
    params: { optimal_distance: number; distance_tolerance: number; area_radius: number },
    mode: "windup" | "impact",
    opacity: number = 0.3,
    impactQuality: number = 0,
  ): void {
    const ctx = this.ctx;
    const [px, py] = this.toScreen(player.pos.x, player.pos.z);
    const s = this.scale;

    const minDist = params.optimal_distance - params.distance_tolerance;
    const maxDist = params.optimal_distance + params.distance_tolerance;
    const halfWidth = params.area_radius;

    // Angle from forward vector
    const angle = Math.atan2(player.forward.x, player.forward.z);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-angle);

    if (mode === "windup") {
      // Draw gradient attack zone — rows from minDist to maxDist
      const steps = 20;
      const distStep = (maxDist - minDist) / steps;
      const widthSteps = 10;

      for (let di = 0; di < steps; di++) {
        const dist = minDist + di * distStep;
        const distMid = dist + distStep / 2;
        const distFactor = 1.0 - Math.abs(distMid - params.optimal_distance) / params.distance_tolerance;

        for (let wi = -widthSteps; wi < widthSteps; wi++) {
          const offset = (wi + 0.5) * (halfWidth / widthSteps);
          const precFactor = 1.0 - Math.abs(offset) / halfWidth;
          const quality = Math.max(0, distFactor) * Math.max(0, precFactor);

          if (quality <= 0) continue;

          // Green = high quality, red = low
          const r = Math.round((1 - quality) * 255);
          const g = Math.round(quality * 255);
          ctx.fillStyle = `rgba(${r},${g},40,${quality * opacity})`;

          const sx = offset * s;
          const sy = dist * s;
          const sw = (halfWidth / widthSteps) * s;
          const sh = distStep * s;
          ctx.fillRect(sx - sw / 2, sy, sw, sh);
        }
      }
    } else {
      // Impact flash — uniform color based on quality
      let r: number, g: number, b: number;
      if (impactQuality > 0.7) { r = 80; g = 255; b = 80; }
      else if (impactQuality > 0.3) { r = 255; g = 255; b = 60; }
      else if (impactQuality > 0) { r = 255; g = 80; b = 60; }
      else { r = 120; g = 120; b = 120; }

      ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`;
      ctx.fillRect(
        -halfWidth * s,
        minDist * s,
        halfWidth * 2 * s,
        (maxDist - minDist) * s,
      );
    }

    ctx.restore();
  }

  /** Convert screen click to world XZ */
  screenToWorld(screenX: number, screenY: number): Vec3 {
    return {
      x: (screenX - this.offsetX) / this.scale,
      y: 0,
      z: (screenY - this.offsetY) / this.scale,
    };
  }
}
