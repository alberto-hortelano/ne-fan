/** Never Ending Fantasy — 2D top-down HTML client.
 *  Dual mode: connects to nefan-core bridge (WebSocket) or falls back to local simulation. */

import type { Vec3, EffectiveParams } from "../../nefan-core/src/types.js";
import { distance, normalized, sub } from "../../nefan-core/src/vec3.js";
import { getEffectiveParams, loadConfig } from "../../nefan-core/src/combat/combat-data.js";
import { CanvasRenderer, type Entity } from "./renderer/canvas-renderer.js";
import { SpriteRenderer } from "./renderer/sprite-renderer.js";
import { AssetCache } from "./renderer/asset-cache.js";
import { BridgeClient } from "./net/bridge-client.js";
import { NarrativeClient } from "./net/narrative-client.js";
import { TitleScreen, type TitleAction } from "./ui/title-screen.js";
import { HistoryBrowser } from "./ui/history-browser.js";
import { KeyboardHandler } from "./input/keyboard-handler.js";
import { DialoguePanel } from "./ui/dialogue-panel.js";
import { ObjectiveDisplay } from "./ui/objective-display.js";
import {
  createGameClient,
  LocalGameClient,
  type GameClient,
  type FrameResult,
  type RoomEnemy,
} from "./net/game-client.js";
import type { ScenarioUpdate } from "../../nefan-core/src/scenario/scenario-types.js";

// @ts-ignore — Vite resolves JSON imports
import combatConfigJson from "../../nefan-core/data/combat_config.json";

// Glob import all room JSONs (lazy) — Vite feature
const roomModules: Record<string, () => Promise<{ default: Record<string, unknown> }>> =
  (import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<{ default: Record<string, unknown> }>> })
    .glob("../../nefan-core/data/rooms/**/*.json");

const playerCfg = (combatConfigJson as Record<string, unknown>).player as Record<string, number> | undefined ?? {};
const SPEED = playerCfg.walk_speed ?? 3.0;
const SPRINT_SPEED = playerCfg.sprint_speed ?? 5.5;

// Player Mixamo sprite — character editor will overwrite once shipped.
let playerModel = "paladin";
let playerAnimStartedAt = performance.now();

const config = loadConfig(combatConfigJson);

// --- DOM elements ---
const canvas = document.getElementById("game") as HTMLCanvasElement;
const WORLD_ANGLE = "isometric_30";
const spriteRenderer = new SpriteRenderer("/sprites");
const assetCache = new AssetCache("http://127.0.0.1:8765");
const renderer = new CanvasRenderer(canvas, {
  spriteRenderer,
  assetCache,
  worldAngle: WORLD_ANGLE,
});

// Pre-load the default Mixamo idle so the player has a sprite the moment a
// session starts. Other anims load lazily on demand.
void spriteRenderer.loadAnimation(playerModel, "idle", WORLD_ANGLE);
const playerHpBar = document.getElementById("player-hp") as HTMLElement;
const playerHpText = document.getElementById("player-hp-text") as HTMLElement;
const enemyBarsContainer = document.getElementById("enemy-bars") as HTMLElement;
const combatLog = document.getElementById("combat-log") as HTMLElement;
const attackBtns = document.querySelectorAll(".attack-selector span");
const roomSelector = document.getElementById("room-selector") as HTMLSelectElement;
const connectionStatus = document.getElementById("connection-status") as HTMLElement;

const dialoguePanel = new DialoguePanel();
const objectiveDisplay = new ObjectiveDisplay();

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

// --- State ---
const playerPos: Vec3 = { x: 0, y: 0, z: 2 };
let playerForward: Vec3 = { x: 0, y: 0, z: -1 };
let playerMaxHp = 100;
let playerWeaponId = "short_sword";
let roomData: Record<string, unknown> | null = null;
let scenarioActive = false;

// Entity arrays
let enemyEntities: Entity[] = [];
let objectEntities: Entity[] = [];
let npcEntities: Entity[] = [];
const ENEMY_COLORS = ["#c44", "#4a4", "#48c", "#ca4"];
let colorIdx = 0;

// Attack area visualization state
let attackVisual: {
  active: boolean;
  mode: "windup" | "impact";
  params: EffectiveParams;
  impactQuality: number;
  fadeTimer: number;
} | null = null;

// --- Game client (will be set async) ---
let gameClient: GameClient | null = null;

// --- Room loading ---

function populateRoomSelector(): void {
  // Parse glob keys into room entries
  const rooms: { key: string; label: string; group: string }[] = [];

  for (const path of Object.keys(roomModules)) {
    // path like "../../nefan-core/data/rooms/dev/battle_royale.json"
    const match = path.match(/rooms\/(.+)\.json$/);
    if (!match) continue;
    const relPath = match[1]; // e.g. "dev/battle_royale"
    const parts = relPath.split("/");
    let group = "Game";
    let label = relPath;
    if (parts.length > 1) {
      if (parts[0] === "dev") group = "Dev";
      else if (parts[0] === "stress") group = "Stress";
      label = parts.slice(1).join("/");
    } else {
      if (relPath.startsWith("style_")) group = "Style";
    }
    rooms.push({ key: path, label, group });
  }

  // Group and sort
  const groups: Record<string, typeof rooms> = {};
  for (const r of rooms) {
    (groups[r.group] ??= []).push(r);
  }

  for (const [groupName, entries] of Object.entries(groups).sort()) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = groupName;
    for (const entry of entries.sort((a, b) => a.label.localeCompare(b.label))) {
      const opt = document.createElement("option");
      opt.value = entry.key;
      opt.textContent = entry.label;
      optgroup.appendChild(opt);
    }
    roomSelector.appendChild(optgroup);
  }

  // Narrative games
  const narrativeGroup = document.createElement("optgroup");
  narrativeGroup.label = "Narrative";
  const tavernOpt = document.createElement("option");
  tavernOpt.value = "game:tavern_intro";
  tavernOpt.textContent = "tavern_intro";
  narrativeGroup.appendChild(tavernOpt);
  roomSelector.appendChild(narrativeGroup);
}

async function loadRoom(globKey: string): Promise<void> {
  const loader = roomModules[globKey];
  if (!loader) {
    log("Room not found: " + globKey);
    return;
  }

  const mod = await loader();
  await loadSceneData(mod.default);
}

/** Apply an already-resolved scene/room JSON to the renderer + game client.
 *  Used both by the local room selector (legacy) and by the narrative flow
 *  when resuming a session or receiving a generated scene from the bridge. */
async function loadSceneData(data: Record<string, unknown>): Promise<void> {
  roomData = data;
  scenarioActive = false;

  renderer.setRoom(data as unknown as Parameters<typeof renderer.setRoom>[0]);

  // Reset player
  playerPos.x = 0;
  playerPos.z = 2;

  const world = (data.world ?? {}) as Record<string, unknown>;
  const styleToken = (typeof world.style_token === "string" ? world.style_token : "") || undefined;

  // Extract enemies from objects with combat
  const objects = (data.objects ?? []) as Record<string, unknown>[];
  const enemies: RoomEnemy[] = [];
  enemyEntities = [];
  objectEntities = [];
  colorIdx = 0;

  for (const obj of objects) {
    const pos: Vec3 = {
      x: (obj.position as number[])[0],
      y: (obj.position as number[])[1],
      z: (obj.position as number[])[2],
    };
    const combat = obj.combat as Record<string, unknown> | undefined;
    if (combat) {
      const personality = (combat.personality ?? {}) as Record<string, unknown>;
      enemies.push({
        id: obj.id as string,
        position: pos,
        health: combat.health as number,
        weaponId: (combat.weapon_id ?? "unarmed") as string,
        personality: {
          aggression: (personality.aggression ?? 0.5) as number,
          preferred_attacks: (personality.preferred_attacks ?? ["quick"]) as string[],
          reaction_time: (personality.reaction_time ?? 0.8) as number,
          combat_range: (personality.combat_range ?? 4.0) as number,
          ...(personality as Record<string, unknown>),
        },
      });
      const color = ENEMY_COLORS[colorIdx++ % ENEMY_COLORS.length];
      const enemyEntity: Entity = {
        id: obj.id as string, pos, radius: 8, color,
        label: (obj.description ?? obj.id) as string,
        hp: combat.health as number, maxHp: combat.health as number, alive: true,
      };
      enemyEntities.push(enemyEntity);
      attachSpriteForObject(obj, enemyEntity, styleToken);
    } else {
      const objectEntity: Entity = {
        id: obj.id as string, pos, radius: 5,
        color: (obj.category as string) === "item" ? "#aa8" : "#666",
        label: (obj.description ?? "") as string, alive: true,
      };
      objectEntities.push(objectEntity);
      attachSpriteForObject(obj, objectEntity, styleToken);
    }
  }

  // NPCs from room data
  const npcsData = (data.npcs ?? []) as Record<string, unknown>[];
  npcEntities = npcsData.map(npc => {
    const entity: Entity = {
      id: npc.id as string,
      pos: {
        x: (npc.position as number[])?.[0] ?? 0,
        y: (npc.position as number[])?.[1] ?? 0,
        z: (npc.position as number[])?.[2] ?? 0,
      },
      forward: { x: 0, y: 0, z: -1 },
      radius: 7,
      color: "#68c",
      label: (npc.name ?? npc.id) as string,
      name: (npc.name ?? npc.id) as string,
      alive: true,
    };
    attachSpriteForNpc(npc, entity, styleToken);
    return entity;
  });

  // Build enemy HP bars
  rebuildEnemyBars();

  // Notify game client
  if (gameClient) {
    const dims = data.dimensions as { width: number; depth: number } | undefined;
    gameClient.loadRoom(data, (data.room_id ?? "unknown") as string, enemies);
  }

  log("Room loaded: " + (data.room_id ?? "unknown"));
}

/** Drop a Mixamo character ref or an AI sprite hash on the entity, kicking off
 *  a generate_sprite request when the scene only carries a prompt. The entity
 *  is mutated in place once the hash arrives — the game loop re-renders every
 *  frame so the sprite pops in as soon as ai_server replies. */
function attachSpriteForObject(obj: Record<string, unknown>, entity: Entity, styleToken?: string): void {
  // Only `sprite_hash` is a 2D sprite — `texture_hash` is a PBR map for the
  // Godot renderer and lives in cache/textures/, not cache/sprites/.
  const existingHash = obj.sprite_hash as string | undefined;
  if (existingHash) {
    entity.spriteHash = existingHash;
    return;
  }
  const description = (obj.description as string | undefined) ?? "";
  const category = (obj.category as string | undefined) ?? "prop";
  const id = (obj.id as string | undefined) ?? "object";
  const prompt = description
    ? `${description}, single ${category}, isolated on transparent background`
    : `${id} ${category}, isolated on transparent background`;
  void assetCache
    .requestSprite(prompt, { angle: WORLD_ANGLE, styleToken })
    .then(hash => {
      if (hash) entity.spriteHash = hash;
    });
}

function attachSpriteForNpc(npc: Record<string, unknown>, entity: Entity, styleToken?: string): void {
  const existingHash = npc.sprite_hash as string | undefined;
  if (existingHash) {
    entity.spriteHash = existingHash;
    return;
  }
  const skin = (npc.skin_prompt as string | undefined) ?? (npc.description as string | undefined) ?? "";
  const name = (npc.name as string | undefined) ?? (npc.id as string | undefined) ?? "character";
  const prompt = skin
    ? `${skin}, full body, single character standing, isolated on transparent background`
    : `${name}, full body, single character standing, isolated on transparent background`;
  void assetCache
    .requestSprite(prompt, { angle: WORLD_ANGLE, styleToken })
    .then(hash => {
      if (hash) entity.spriteHash = hash;
    });
}

function rebuildEnemyBars(): void {
  enemyBarsContainer.innerHTML = "";
  for (const ee of enemyEntities) {
    const bar = document.createElement("div");
    bar.className = "hp-bar";
    bar.innerHTML = `<span style="color:${ee.color}">${ee.id}</span>
      <div class="hp-fill"><div class="hp-fill-inner" id="hp-${ee.id}" style="width:100%;background:${ee.color}"></div></div>
      <span id="hp-text-${ee.id}">${ee.maxHp}</span>`;
    enemyBarsContainer.appendChild(bar);
  }
}

// --- Combat log ---
function log(msg: string): void {
  const line = document.createElement("div");
  line.textContent = msg;
  combatLog.prepend(line);
  while (combatLog.children.length > 8) combatLog.lastChild?.remove();
}

// --- Mouse look ---
const MOUSE_SENSITIVITY = 0.004;
let playerYaw = Math.PI; // facing -Z initially

canvas.addEventListener("click", () => {
  if (!dialoguePanel.isVisible) {
    canvas.requestPointerLock();
  }
});

document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== canvas) return;
  playerYaw -= e.movementX * MOUSE_SENSITIVITY;
  playerForward = normalized({ x: Math.sin(playerYaw), y: 0, z: Math.cos(playerYaw) });
});

// --- Utility ---

function getSelectedParams(): EffectiveParams {
  const weaponData = config.weapons[playerWeaponId] ?? config.weapons["unarmed"];
  return getEffectiveParams(input.state.selectedAttack, config.attack_types, weaponData);
}

// --- Exit detection ---

function checkExits(): void {
  if (!roomData) return;
  const dims = roomData.dimensions as { width: number; depth: number };
  if (!dims) return;
  const halfW = dims.width / 2;
  const halfD = dims.depth / 2;
  const threshold = 0.5;
  const exits = (roomData.exits ?? []) as { wall: string; offset: number; size: number[] }[];

  for (const exit of exits) {
    const ew = exit.size[0] / 2;
    const eOff = exit.offset;
    let triggered = false;

    switch (exit.wall) {
      case "north":
        triggered = playerPos.z < -halfD + threshold && Math.abs(playerPos.x - eOff) < ew;
        break;
      case "south":
        triggered = playerPos.z > halfD - threshold && Math.abs(playerPos.x - eOff) < ew;
        break;
      case "east":
        triggered = playerPos.x > halfW - threshold && Math.abs(playerPos.z - eOff) < ew;
        break;
      case "west":
        triggered = playerPos.x < -halfW + threshold && Math.abs(playerPos.z - eOff) < ew;
        break;
    }

    if (triggered) {
      if (gameClient?.isBridge) {
        gameClient.sendScenarioEvent("exit_entered", { exitWall: exit.wall });
        log("Exit: " + exit.wall);
      } else {
        log("Exit detected — bridge required for transitions");
      }
      // Move player back slightly to prevent re-triggering
      switch (exit.wall) {
        case "north": playerPos.z += 1.0; break;
        case "south": playerPos.z -= 1.0; break;
        case "east": playerPos.x -= 1.0; break;
        case "west": playerPos.x += 1.0; break;
      }
      return;
    }
  }
}

// --- Scenario update processing ---

function processScenario(scenario: ScenarioUpdate): void {
  if (scenario.dialogue) {
    const dlg = scenario.dialogue;
    dialoguePanel.show(dlg.speaker, dlg.text, dlg.choices);
    input.dialogueActive = true;
  }
  if (scenario.objective) {
    objectiveDisplay.show(scenario.objective);
  }
  if (scenario.spawn_npc) {
    const npc = scenario.spawn_npc;
    npcEntities.push({
      id: npc.id,
      pos: {
        x: npc.position[0],
        y: npc.position[1],
        z: npc.position[2],
      },
      forward: { x: 0, y: 0, z: -1 },
      radius: 7,
      color: "#68c",
      label: npc.name,
      name: npc.name,
      alive: true,
    });
    log("NPC appeared: " + npc.name);
  }
  if (scenario.despawn_npc) {
    npcEntities = npcEntities.filter(n => n.id !== scenario.despawn_npc);
    log("NPC left: " + scenario.despawn_npc);
  }
  if (scenario.spawn_enemy) {
    const enemy = scenario.spawn_enemy;
    const color = ENEMY_COLORS[colorIdx++ % ENEMY_COLORS.length];
    enemyEntities.push({
      id: enemy.id,
      pos: {
        x: enemy.position[0],
        y: enemy.position[1],
        z: enemy.position[2],
      },
      radius: 8, color,
      label: enemy.id,
      hp: enemy.combat.health,
      maxHp: enemy.combat.health,
      alive: true,
    });
    rebuildEnemyBars();
    log("Enemy spawned: " + enemy.id);
  }
  if (scenario.give_weapon) {
    playerWeaponId = scenario.give_weapon;
    log("Weapon acquired: " + scenario.give_weapon);
  }
  if (scenario.change_scene) {
    // change_scene contains full room data
    const sceneData = scenario.change_scene as Record<string, unknown>;
    roomData = sceneData;
    scenarioActive = true;
    renderer.setRoom(sceneData as unknown as Parameters<typeof renderer.setRoom>[0]);
    playerPos.x = 0;
    playerPos.z = 2;

    // Parse objects/npcs from scene data
    const objects = (sceneData.objects ?? []) as Record<string, unknown>[];
    objectEntities = [];
    const sceneEnemies: Entity[] = [];
    for (const obj of objects) {
      const pos: Vec3 = {
        x: (obj.position as number[])[0],
        y: (obj.position as number[])[1],
        z: (obj.position as number[])[2],
      };
      if (obj.combat) {
        const combat = obj.combat as Record<string, unknown>;
        const color = ENEMY_COLORS[colorIdx++ % ENEMY_COLORS.length];
        sceneEnemies.push({
          id: obj.id as string, pos, radius: 8, color,
          label: (obj.description ?? obj.id) as string,
          hp: combat.health as number, maxHp: combat.health as number, alive: true,
        });
      } else {
        objectEntities.push({
          id: obj.id as string, pos, radius: 5,
          color: (obj.category as string) === "item" ? "#aa8" : "#666",
          label: (obj.description ?? "") as string, alive: true,
        });
      }
    }
    enemyEntities = sceneEnemies;

    const npcsData = (sceneData.npcs ?? []) as Record<string, unknown>[];
    npcEntities = npcsData.map(npc => ({
      id: npc.id as string,
      pos: {
        x: (npc.position as number[])?.[0] ?? 0,
        y: (npc.position as number[])?.[1] ?? 0,
        z: (npc.position as number[])?.[2] ?? 0,
      },
      forward: { x: 0, y: 0, z: -1 },
      radius: 7, color: "#68c",
      label: (npc.name ?? npc.id) as string,
      name: (npc.name ?? npc.id) as string,
      alive: true,
    }));

    rebuildEnemyBars();
    log("Scene changed: " + (sceneData.room_id ?? "unknown"));
  }
  if (scenario.spawn_objects) {
    for (const obj of scenario.spawn_objects) {
      objectEntities.push({
        id: obj.id,
        pos: { x: obj.position[0], y: obj.position[1], z: obj.position[2] },
        radius: 5,
        color: obj.category === "item" ? "#aa8" : "#666",
        label: obj.description,
        alive: true,
      });
    }
  }
}

// --- Dialogue callbacks ---

dialoguePanel.onAdvanced = () => {
  input.dialogueActive = false;
  gameClient?.sendScenarioEvent("dialogue_advanced");
};

dialoguePanel.onChoice = (index: number) => {
  input.dialogueActive = false;
  gameClient?.sendScenarioEvent("dialogue_choice", { choiceIndex: index });
};

// --- Room selector handler ---

roomSelector.addEventListener("change", () => {
  const value = roomSelector.value;
  if (!value) return;

  if (value.startsWith("game:")) {
    const gameId = value.slice(5);
    if (gameClient?.isBridge) {
      scenarioActive = true;
      gameClient.loadGame(gameId);
      log("Loading game: " + gameId);
    } else {
      log("Bridge required for narrative games");
    }
  } else {
    loadRoom(value);
  }
});

// --- Respawn ---

window.addEventListener("keydown", (e) => {
  if (e.key === "r") {
    const p = gameClient?.getCombatant("player");
    if (p && p.health <= 0) {
      gameClient?.respawn({ x: 0, y: 0, z: 2 });
      playerPos.x = 0;
      playerPos.z = 2;
      log("Respawned!");
    }
  }
});

// --- Connection status UI ---

function updateConnectionStatus(connected: boolean, isBridge: boolean): void {
  if (isBridge && connected) {
    connectionStatus.textContent = "Bridge";
    connectionStatus.className = "connected";
  } else if (isBridge) {
    connectionStatus.textContent = "Disconnected";
    connectionStatus.className = "disconnected";
  } else {
    connectionStatus.textContent = "Local";
    connectionStatus.className = "disconnected";
  }
}

// --- Game Loop ---

let lastTime = performance.now();

function gameLoop(now: number): void {
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (!gameClient) {
    requestAnimationFrame(gameLoop);
    return;
  }

  // Movement (suppressed during dialogue)
  if (!dialoguePanel.isVisible) {
    let inputFwd = 0, inputRight = 0;
    if (input.state.up) inputFwd += 1;
    if (input.state.down) inputFwd -= 1;
    if (input.state.right) inputRight += 1;
    if (input.state.left) inputRight -= 1;

    const speed = input.state.sprint ? SPRINT_SPEED : SPEED;
    if (inputFwd !== 0 || inputRight !== 0) {
      const len = Math.sqrt(inputFwd * inputFwd + inputRight * inputRight);
      const fwd = playerForward;
      const right = { x: -fwd.z, z: fwd.x };
      const moveX = (fwd.x * inputFwd + right.x * inputRight) / len;
      const moveZ = (fwd.z * inputFwd + right.z * inputRight) / len;
      playerPos.x += moveX * speed * delta;
      playerPos.z += moveZ * speed * delta;
    }

    // Clamp to room bounds
    if (roomData) {
      const dims = roomData.dimensions as { width: number; depth: number };
      if (dims) {
        const halfW = dims.width / 2 - 0.3;
        const halfD = dims.depth / 2 - 0.3;
        playerPos.x = Math.max(-halfW, Math.min(halfW, playerPos.x));
        playerPos.z = Math.max(-halfD, Math.min(halfD, playerPos.z));
      }
    }

    // Exit detection
    checkExits();
  }

  // Attack
  const attackRequested = dialoguePanel.isVisible ? false : input.consumeAttack();

  // Tick
  const result: FrameResult = gameClient.tick(delta, {
    playerPosition: playerPos,
    playerForward: playerForward,
    playerMoving: input.state.up || input.state.down || input.state.left || input.state.right,
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
    } else if (e.type === "attack_landed") {
      const targetId = e.targetId as string;
      const dmg = e.damage as number;
      if (targetId === "player") {
        log(`Player hit: -${dmg.toFixed(1)} HP`);
      } else {
        log(`${targetId} hit: -${dmg.toFixed(1)} HP`);
      }
    } else if (e.type === "died") {
      const who = e.combatantId as string;
      if (who === "player") {
        log("YOU DIED — press R to respawn");
      } else {
        log(`${who} killed!`);
      }
    } else if (e.type === "player_respawned") {
      log("Respawned!");
    }
  }

  // Fade impact flash
  if (attackVisual?.mode === "impact") {
    attackVisual.fadeTimer -= delta;
    if (attackVisual.fadeTimer <= 0) {
      attackVisual = null;
    }
  }

  // Sync enemy entities from result
  for (const enemyState of result.enemies) {
    const ee = enemyEntities.find(e => e.id === enemyState.id);
    if (ee) {
      if (enemyState.pos) {
        ee.pos = { x: enemyState.pos.x, y: enemyState.pos.y, z: enemyState.pos.z };
      }
      if (enemyState.forward) {
        ee.forward = { x: enemyState.forward.x, y: enemyState.forward.y, z: enemyState.forward.z };
      }
      ee.hp = enemyState.hp;
      ee.alive = enemyState.alive;
      ee.attacking = enemyState.state === "winding_up" || enemyState.state === "attacking";
    }
  }

  // Sync NPCs from result (bridge mode)
  if (result.npcs) {
    for (const npcState of result.npcs) {
      const npc = npcEntities.find(n => n.id === npcState.id);
      if (npc) {
        if (npcState.pos) {
          npc.pos.x = npcState.pos.x;
          npc.pos.z = npcState.pos.z;
        }
        if (npcState.facing) {
          npc.forward = { x: npcState.facing.x, y: 0, z: npcState.facing.z };
        }
        if (npcState.visible === false) {
          npc.alive = false;
        } else {
          npc.alive = true;
        }
      }
    }
  }

  // Process scenario updates (bridge mode)
  if (result.scenario) {
    processScenario(result.scenario);
  }

  // Update HUD
  const pHpPct = Math.max(0, result.playerHp / playerMaxHp * 100);
  playerHpBar.style.width = pHpPct + "%";
  playerHpText.textContent = Math.ceil(result.playerHp).toString();

  for (const ee of enemyEntities) {
    const bar = document.getElementById(`hp-${ee.id}`);
    const text = document.getElementById(`hp-text-${ee.id}`);
    if (bar) bar.style.width = Math.max(0, (ee.hp ?? 0) / (ee.maxHp ?? 1) * 100) + "%";
    if (text) text.textContent = Math.ceil(ee.hp ?? 0).toString();
  }

  // Render
  renderer.render(
    {
      pos: playerPos,
      forward: playerForward,
      hp: result.playerHp,
      maxHp: playerMaxHp,
      sprite: { model: playerModel, anim: "idle", angle: WORLD_ANGLE, animStartedAt: playerAnimStartedAt },
    },
    enemyEntities,
    objectEntities,
    npcEntities,
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

// --- Init ---

populateRoomSelector();

const sharedBridge = new BridgeClient();
const narrativeClient = new NarrativeClient(sharedBridge);
const titleScreen = new TitleScreen(narrativeClient);
const historyBrowser = new HistoryBrowser(narrativeClient);
let activeSessionId: string | null = null;

dialoguePanel.onChoice = (idx, text) => {
  if (!activeSessionId) return;
  const cur = dialoguePanel.current();
  narrativeClient.sendDialogueChoice({
    eventId: `client_${Date.now()}`,  // bridge generates the canonical id
    choiceIndex: idx,
    speaker: cur.speaker,
    chosenText: text,
  });
};

dialoguePanel.onFreeText = (freeText) => {
  if (!activeSessionId) return;
  const cur = dialoguePanel.current();
  narrativeClient.sendDialogueChoice({
    eventId: `client_${Date.now()}`,
    choiceIndex: -1,
    speaker: cur.speaker,
    chosenText: freeText,
    freeText,
  });
};

narrativeClient.onNarrativeEvent((event) => {
  // Minimum viable handler: log everything to the combat log.
  // Task 13 will wire each effect to dialogue/spawns/story HUD.
  for (const effect of event.effects) {
    switch (effect.kind) {
      case "show_dialogue":
        dialoguePanel.show(effect.speaker, effect.text, effect.choices.map((c) =>
          typeof c === "string" ? c : c.text,
        ));
        break;
      case "story_delta":
        log(`📖 ${effect.delta.slice(0, 80)}`);
        break;
      case "spawn_entity": {
        // The bridge wraps a freshly generated scene in a spawn_entity effect
        // with `data.scene` (see ws-server.ts start_session handler). Treat
        // that as a "load scene" instruction; everything else is just a log.
        const scene = (effect.data as Record<string, unknown> | undefined)?.scene as
          | Record<string, unknown>
          | undefined;
        if (scene) {
          void loadSceneData(scene);
          log(`🌍 escena cargada: ${effect.entityId}`);
        } else {
          log(`✨ spawn ${effect.entityKind}: ${effect.description.slice(0, 60)}`);
        }
        break;
      }
      case "schedule_event":
        log(`⏳ scheduled: ${effect.description.slice(0, 60)}`);
        break;
      case "ambient_message":
        log(effect.message);
        break;
    }
  }
});

createGameClient(combatConfigJson as Record<string, unknown>, sharedBridge, (client) => {
  gameClient = client;
  updateConnectionStatus(client.isConnected, client.isBridge);

  client.on("connected", () => updateConnectionStatus(true, true));
  client.on("disconnected", () => updateConnectionStatus(false, true));

  // Listen to store events for combat log (local mode)
  if (client instanceof LocalGameClient) {
    client.store.on("player_damaged", (p: Record<string, unknown>) =>
      log(`Player hit: -${(p.amount as number).toFixed(1)} HP`));
    client.store.on("enemy_damaged", (p: Record<string, unknown>) =>
      log(`${p.enemy_id} hit: -${(p.amount as number).toFixed(1)} HP`));
    client.store.on("player_died", () => log("YOU DIED — press R to respawn"));
    client.store.on("enemy_died", (p: Record<string, unknown>) => log(`${p.enemy_id} killed!`));
    client.store.on("player_respawned", () => log("Respawned!"));
  }

  void runTitleFlow(client);
});

async function runTitleFlow(client: GameClient): Promise<void> {
  if (!client.isBridge) {
    // Bridge unavailable: skip the narrative title screen and keep the legacy
    // local mode (room JSON selector). This preserves the previous behaviour
    // when running without the bridge.
    const defaultRoom = Object.keys(roomModules).find(k => k.includes("battle_royale"));
    if (defaultRoom) loadRoom(defaultRoom);
    return;
  }

  let action: TitleAction;
  try {
    action = await titleScreen.show();
  } catch (err) {
    console.warn("title-screen failed, falling back to room selector:", err);
    titleScreen.hide();
    const defaultRoom = Object.keys(roomModules).find(k => k.includes("battle_royale"));
    if (defaultRoom) loadRoom(defaultRoom);
    return;
  }

  try {
    if (action.kind === "new_game") {
      const res = await narrativeClient.startSession(action.gameId, action.appearance);
      activeSessionId = res.sessionId;
      historyBrowser.setSession(res.sessionId);
      log(`Nueva partida: ${res.sessionId} (${action.gameId})`);
      playerModel = action.appearance.model_id;
      playerAnimStartedAt = performance.now();
      void spriteRenderer.loadAnimation(playerModel, "idle", WORLD_ANGLE);
    } else {
      const res = await narrativeClient.resumeSession(action.sessionId);
      activeSessionId = res.state.session_id;
      historyBrowser.setSession(res.state.session_id);
      log(`Reanudada: ${res.state.session_id}`);
      playerModel = res.state.player.appearance.model_id || playerModel;
      playerAnimStartedAt = performance.now();
      void spriteRenderer.loadAnimation(playerModel, "idle", WORLD_ANGLE);

      // Materialise the scene the player was last in. Without this the canvas
      // stays empty after a resume — the bridge only broadcasts a scene to new
      // sessions via narrative_event/spawn_entity.
      const activeId = res.state.world?.active_scene_id;
      const scenes = res.state.scenes_loaded as Record<string, { scene_data?: Record<string, unknown> }> | undefined;
      const sceneData = activeId ? scenes?.[activeId]?.scene_data : undefined;
      if (sceneData) {
        await loadSceneData(sceneData);
      } else {
        log(`(sin escena en el save — esperando narrativa)`);
      }
    }
  } catch (err) {
    alert(`No se pudo iniciar la sesión: ${(err as Error).message}`);
    console.error(err);
  } finally {
    titleScreen.hide();
  }
}

requestAnimationFrame(gameLoop);
