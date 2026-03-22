/** Never Ending Fantasy — 2D top-down HTML client.
 *  Imports nefan-core directly (no WebSocket needed). */

import { GameSimulation } from "../../nefan-core/src/simulation/game-loop.js";
import { createCombatant } from "../../nefan-core/src/combat/combatant.js";
import { loadConfig } from "../../nefan-core/src/combat/combat-data.js";
import { GameStore } from "../../nefan-core/src/store/game-store.js";
import type { CombatConfig, Vec3, EnemyPersonality } from "../../nefan-core/src/types.js";
import { distance, normalized, sub } from "../../nefan-core/src/vec3.js";
import { CanvasRenderer } from "./renderer/canvas-renderer.js";
import { KeyboardHandler } from "./input/keyboard-handler.js";

// @ts-ignore — Vite resolves JSON imports
import combatConfigJson from "../../nefan-core/data/combat_config.json";
// @ts-ignore
import cryptRoomJson from "../../godot/test_rooms/crypt_001.json";

const SPEED = 5.0;
const SPRINT_SPEED = 8.0;

// --- Init ---
const config: CombatConfig = loadConfig(combatConfigJson);
const store = new GameStore();
const sim = new GameSimulation(config, store, Date.now());

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new CanvasRenderer(canvas);

// HUD elements
const playerHpBar = document.getElementById("player-hp") as HTMLElement;
const playerHpText = document.getElementById("player-hp-text") as HTMLElement;
const enemyHpBar = document.getElementById("enemy-hp") as HTMLElement;
const enemyHpText = document.getElementById("enemy-hp-text") as HTMLElement;
const combatLog = document.getElementById("combat-log") as HTMLElement;
const attackBtns = document.querySelectorAll(".attack-selector span");

const input = new KeyboardHandler(canvas, (type) => {
  attackBtns.forEach(btn => {
    btn.classList.toggle("active", (btn as HTMLElement).dataset.type === type);
  });
});

// Click attack type selection
attackBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const type = (btn as HTMLElement).dataset.type!;
    input.state.selectedAttack = type;
    attackBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// --- Load Room ---
const roomData = cryptRoomJson as any;
renderer.setRoom(roomData);

// Player state
const playerPos: Vec3 = { x: 0, y: 0, z: 2 };
let playerForward: Vec3 = { x: 0, y: 0, z: -1 };
const playerMaxHp = 100;

const player = createCombatant("player", playerMaxHp, "short_sword", playerPos, playerForward);
sim.addCombatant(player);

// Enemies from room data
interface RoomEntity { id: string; pos: Vec3; radius: number; color: string; label: string; hp?: number; maxHp?: number; alive: boolean }
const enemyEntities: RoomEntity[] = [];
const objectEntities: RoomEntity[] = [];

for (const obj of roomData.objects ?? []) {
  const pos: Vec3 = { x: obj.position[0], y: obj.position[1], z: obj.position[2] };
  if (obj.combat) {
    const enemyCombatant = createCombatant(
      obj.id, obj.combat.health, obj.combat.weapon_id ?? "unarmed",
      pos, { x: 0, y: 0, z: 1 },
    );
    const personality: EnemyPersonality = {
      aggression: obj.combat.personality?.aggression ?? 0.5,
      preferred_attacks: obj.combat.personality?.preferred_attacks ?? ["medium"],
      reaction_time: obj.combat.personality?.reaction_time ?? 0.8,
      combat_range: 4.0,
    };
    sim.addCombatant(enemyCombatant, personality);
    enemyEntities.push({
      id: obj.id, pos, radius: 8, color: "#c44", label: obj.description,
      hp: obj.combat.health, maxHp: obj.combat.health, alive: true,
    });
  } else {
    objectEntities.push({
      id: obj.id, pos, radius: 5,
      color: obj.category === "item" ? "#aa8" : "#666",
      label: obj.description, alive: true,
    });
  }
}

// Combat log helper
function log(msg: string): void {
  const line = document.createElement("div");
  line.textContent = msg;
  combatLog.prepend(line);
  while (combatLog.children.length > 8) combatLog.lastChild?.remove();
}

// Listen to store events for combat log
store.on("player_damaged", (p) => log(`Player hit: -${(p.amount as number).toFixed(1)} HP`));
store.on("enemy_damaged", (p) => log(`${p.enemy_id} hit: -${(p.amount as number).toFixed(1)} HP`));
store.on("player_died", () => log("YOU DIED — press R to respawn"));
store.on("enemy_died", (p) => log(`${p.enemy_id} killed!`));
store.on("player_respawned", () => log("Respawned!"));

// Respawn with R key
window.addEventListener("keydown", (e) => {
  if (e.key === "r" && player.health <= 0) {
    sim.respawn({ x: 0, y: 0, z: 2 });
    playerPos.x = 0; playerPos.z = 2;
    // Sync enemy entities after respawn
    for (const ee of enemyEntities) {
      const c = sim.getCombatant(ee.id);
      if (c) { ee.hp = c.health; ee.maxHp = c.maxHealth; ee.alive = true; }
    }
  }
});

// Mouse tracking for player facing direction
let mouseWorld: Vec3 | null = null;
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseWorld = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
});

// --- Game Loop ---
let lastTime = performance.now();

function gameLoop(now: number): void {
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // Face toward mouse cursor (compute before movement so WASD is relative)
  if (mouseWorld) {
    const dir = sub(mouseWorld, playerPos);
    if (dir.x !== 0 || dir.z !== 0) {
      playerForward = normalized({ x: dir.x, y: 0, z: dir.z });
    }
  }

  // Movement relative to facing direction (like 3D camera-relative)
  let inputFwd = 0, inputRight = 0;
  if (input.state.up) inputFwd += 1;
  if (input.state.down) inputFwd -= 1;
  if (input.state.right) inputRight += 1;
  if (input.state.left) inputRight -= 1;

  const speed = input.state.sprint ? SPRINT_SPEED : SPEED;
  if (inputFwd !== 0 || inputRight !== 0) {
    const len = Math.sqrt(inputFwd * inputFwd + inputRight * inputRight);
    const fwd = playerForward;
    const right = { x: -fwd.z, z: fwd.x }; // perpendicular
    const moveX = (fwd.x * inputFwd + right.x * inputRight) / len;
    const moveZ = (fwd.z * inputFwd + right.z * inputRight) / len;
    playerPos.x += moveX * speed * delta;
    playerPos.z += moveZ * speed * delta;
  }

  // Clamp to room bounds
  const halfW = roomData.dimensions.width / 2 - 0.3;
  const halfD = roomData.dimensions.depth / 2 - 0.3;
  playerPos.x = Math.max(-halfW, Math.min(halfW, playerPos.x));
  playerPos.z = Math.max(-halfD, Math.min(halfD, playerPos.z));

  // Update player combatant position
  player.position = { ...playerPos };
  player.forward = { ...playerForward };

  // Attack
  const attackRequested = input.consumeAttack();

  // Tick simulation
  const result = sim.tick(delta, {
    playerPosition: playerPos,
    playerForward: playerForward,
    playerMoving: dx !== 0 || dz !== 0,
    attackRequested,
    attackType: attackRequested ? input.state.selectedAttack : undefined,
  });

  // Sync enemy entities from combatant states
  for (const ee of enemyEntities) {
    const c = sim.getCombatant(ee.id);
    if (c) {
      ee.hp = c.health;
      ee.alive = c.health > 0;
    }
  }

  // Update HUD
  const pHpPct = Math.max(0, player.health / playerMaxHp * 100);
  playerHpBar.style.width = pHpPct + "%";
  playerHpText.textContent = Math.ceil(player.health).toString();

  const firstEnemy = enemyEntities[0];
  if (firstEnemy) {
    const eHpPct = Math.max(0, (firstEnemy.hp ?? 0) / (firstEnemy.maxHp ?? 1) * 100);
    enemyHpBar.style.width = eHpPct + "%";
    enemyHpText.textContent = Math.ceil(firstEnemy.hp ?? 0).toString();
  }

  // Render
  renderer.render(
    { pos: playerPos, forward: playerForward, hp: player.health, maxHp: playerMaxHp },
    enemyEntities,
    objectEntities,
  );

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
