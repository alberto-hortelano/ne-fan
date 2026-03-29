/** Never Ending Fantasy — 2D top-down HTML client.
 *  Imports nefan-core directly (no WebSocket needed). */

import { GameSimulation } from "../../nefan-core/src/simulation/game-loop.js";
import { createCombatant } from "../../nefan-core/src/combat/combatant.js";
import { loadConfig } from "../../nefan-core/src/combat/combat-data.js";
import { GameStore } from "../../nefan-core/src/store/game-store.js";
import type { CombatConfig, Vec3, EnemyPersonality, EffectiveParams } from "../../nefan-core/src/types.js";
import { distance, normalized, sub } from "../../nefan-core/src/vec3.js";
import { getEffectiveParams } from "../../nefan-core/src/combat/combat-data.js";
import { CanvasRenderer } from "./renderer/canvas-renderer.js";
import { KeyboardHandler } from "./input/keyboard-handler.js";

// @ts-ignore — Vite resolves JSON imports
import combatConfigJson from "../../nefan-core/data/combat_config.json";
// @ts-ignore
import battleRoyaleJson from "../../nefan-core/data/rooms/dev/battle_royale.json";

const playerCfg = (combatConfigJson as any).player ?? {};
const SPEED = playerCfg.walk_speed ?? 3.0;
const SPRINT_SPEED = playerCfg.sprint_speed ?? 5.5;

// --- Init ---
const config: CombatConfig = loadConfig(combatConfigJson);
const store = new GameStore();
const sim = new GameSimulation(config, store, Date.now());

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new CanvasRenderer(canvas);

// HUD elements
const playerHpBar = document.getElementById("player-hp") as HTMLElement;
const playerHpText = document.getElementById("player-hp-text") as HTMLElement;
const enemyBarsContainer = document.getElementById("enemy-bars") as HTMLElement;
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
const roomData = battleRoyaleJson as any;
renderer.setRoom(roomData);
sim.setRoomBounds(roomData.dimensions.width, roomData.dimensions.depth);

// Player state
const playerPos: Vec3 = { x: 0, y: 0, z: 2 };
let playerForward: Vec3 = { x: 0, y: 0, z: -1 };
const playerMaxHp = 100;

const player = createCombatant("player", playerMaxHp, "short_sword", playerPos, playerForward);
sim.addCombatant(player);

// Enemies from room data
interface RoomEntity { id: string; pos: Vec3; forward?: Vec3; radius: number; color: string; label: string; hp?: number; maxHp?: number; alive: boolean; attacking?: boolean }
const enemyEntities: RoomEntity[] = [];
const objectEntities: RoomEntity[] = [];

const ENEMY_COLORS = ["#c44", "#4a4", "#48c", "#ca4"];
let colorIdx = 0;

for (const obj of roomData.objects ?? []) {
  const pos: Vec3 = { x: obj.position[0], y: obj.position[1], z: obj.position[2] };
  if (obj.combat) {
    const enemyCombatant = createCombatant(
      obj.id, obj.combat.health, obj.combat.weapon_id ?? "unarmed",
      pos, { x: 0, y: 0, z: 1 },
    );
    // Pass full personality including difficulty/aggression_style
    const personality: EnemyPersonality = {
      ...(obj.combat.personality ?? {}),
      combat_range: obj.combat.personality?.combat_range ?? 4.0,
    };
    sim.addCombatant(enemyCombatant, personality);
    const color = ENEMY_COLORS[colorIdx++ % ENEMY_COLORS.length];
    enemyEntities.push({
      id: obj.id, pos, radius: 8, color, label: obj.description ?? obj.id,
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

// Build enemy HP bars dynamically
for (const ee of enemyEntities) {
  const bar = document.createElement("div");
  bar.className = "hp-bar";
  bar.innerHTML = `<span style="color:${ee.color}">${ee.id}</span>
    <div class="hp-fill"><div class="hp-fill-inner" id="hp-${ee.id}" style="width:100%;background:${ee.color}"></div></div>
    <span id="hp-text-${ee.id}">${ee.maxHp}</span>`;
  enemyBarsContainer.appendChild(bar);
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

// Attack area visualization state
let attackVisual: {
  active: boolean;
  mode: "windup" | "impact";
  params: EffectiveParams;
  impactQuality: number;
  fadeTimer: number;
} | null = null;

function getSelectedParams(): EffectiveParams {
  const weaponData = config.weapons[player.weaponId] ?? config.weapons["unarmed"];
  return getEffectiveParams(input.state.selectedAttack, config.attack_types, weaponData);
}

// Mouse look — relative movement rotates player (like 3D camera)
const MOUSE_SENSITIVITY = 0.004;
let playerYaw = Math.PI; // facing -Z initially

canvas.addEventListener("click", () => {
  canvas.requestPointerLock();
});

document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== canvas) return;
  playerYaw -= e.movementX * MOUSE_SENSITIVITY;
  playerForward = normalized({ x: Math.sin(playerYaw), y: 0, z: Math.cos(playerYaw) });
});

// --- Game Loop ---
let lastTime = performance.now();

function gameLoop(now: number): void {
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // Movement relative to facing direction (mouse rotates, like 3D camera)
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
    playerMoving: inputFwd !== 0 || inputRight !== 0,
    attackRequested,
    attackType: attackRequested ? input.state.selectedAttack : undefined,
  });

  // Process combat events for attack visualization
  for (const e of result.events) {
    if (e.type === "attack_started" && e.combatantId === "player") {
      attackVisual = {
        active: true,
        mode: "windup",
        params: getSelectedParams(),
        impactQuality: 0,
        fadeTimer: 0,
      };
    } else if (e.type === "attack_impacted" && e.combatantId === "player") {
      // Calculate actual quality against nearest enemy
      let quality = 0;
      for (const ee of enemyEntities) {
        if (!ee.alive) continue;
        const dist = distance(playerPos, ee.pos);
        const params = attackVisual?.params ?? getSelectedParams();
        const distFactor = Math.max(0, 1 - Math.abs(dist - params.optimal_distance) / params.distance_tolerance);
        const dir = sub(ee.pos, playerPos);
        const fwdXz = { x: playerForward.x, z: playerForward.z };
        const perpDist = Math.abs(fwdXz.x * dir.z - fwdXz.z * dir.x);
        const precFactor = Math.max(0, 1 - perpDist / params.area_radius);
        quality = Math.max(quality, distFactor * precFactor);
      }
      attackVisual = {
        active: true,
        mode: "impact",
        params: attackVisual?.params ?? getSelectedParams(),
        impactQuality: quality,
        fadeTimer: 0.3,
      };
    }
  }

  // Fade impact flash
  if (attackVisual?.mode === "impact") {
    attackVisual.fadeTimer -= delta;
    if (attackVisual.fadeTimer <= 0) {
      attackVisual = null;
    }
  }

  // Sync enemy entities from combatant states
  for (const ee of enemyEntities) {
    const c = sim.getCombatant(ee.id);
    if (c) {
      ee.pos = { ...c.position };
      ee.forward = { ...c.forward };
      ee.hp = c.health;
      ee.alive = c.health > 0;
      ee.attacking = c.state === "winding_up" || c.state === "attacking";
    }
  }

  // Update HUD
  const pHpPct = Math.max(0, player.health / playerMaxHp * 100);
  playerHpBar.style.width = pHpPct + "%";
  playerHpText.textContent = Math.ceil(player.health).toString();

  for (const ee of enemyEntities) {
    const bar = document.getElementById(`hp-${ee.id}`);
    const text = document.getElementById(`hp-text-${ee.id}`);
    if (bar) bar.style.width = Math.max(0, (ee.hp ?? 0) / (ee.maxHp ?? 1) * 100) + "%";
    if (text) text.textContent = Math.ceil(ee.hp ?? 0).toString();
  }

  // Render
  renderer.render(
    { pos: playerPos, forward: playerForward, hp: player.health, maxHp: playerMaxHp },
    enemyEntities,
    objectEntities,
  );

  // Draw attack area overlay
  if (attackVisual?.active) {
    const opacity = attackVisual.mode === "impact"
      ? attackVisual.fadeTimer / 0.3 * 0.5
      : 0.3;
    renderer.drawAttackArea(
      { pos: playerPos, forward: playerForward },
      attackVisual.params,
      attackVisual.mode,
      opacity,
      attackVisual.impactQuality,
    );
  }

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
