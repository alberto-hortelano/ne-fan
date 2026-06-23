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
import { TravelPanel, type SceneExit } from "./ui/travel-panel.js";
import { errors } from "./ui/error-log.js";
import {
  createGameClient,
  type GameClient,
  type FrameResult,
  type RoomEnemy,
} from "./net/game-client.js";
import type { ScenarioUpdate } from "../../nefan-core/src/scenario/scenario-types.js";

// @ts-ignore — Vite resolves JSON imports
import combatConfigJson from "../../nefan-core/data/combat_config.json";
import { CONFIG } from "../../nefan-core/src/config.js";

// Glob import all open-world scene JSONs (lazy) — Vite feature.
// El concepto sala se ha retirado del cliente HTML: estos fixtures definen
// escenarios exteriores con elementos planos por categoría.
const sceneModules: Record<string, () => Promise<{ default: Record<string, unknown> }>> =
  (import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<{ default: Record<string, unknown> }>> })
    .glob("../../nefan-core/data/scenes/**/*.json");

const playerCfg = (combatConfigJson as Record<string, unknown>).player as Record<string, number> | undefined ?? {};
const SPEED = playerCfg.walk_speed ?? 3.0;
const SPRINT_SPEED = playerCfg.sprint_speed ?? 5.5;

/** Player visual state. When CONFIG.graphics.player_sprites is false the
 *  player is drawn as a coloured circle and these stay null. When true,
 *  setPlayerAppearance must succeed before the first frame is rendered. */
let playerModel: string | null = null;
let playerSkinPrompt = "";
let playerAnimStartedAt = performance.now();

/** Load (and optionally AI-skin) the Mixamo sheet that represents the player.
 *
 *  - CONFIG.graphics.player_sprites === false  → does nothing. The renderer
 *    draws a circle and that's the contract.
 *  - CONFIG.graphics.player_sprites === true   → demands the requested model
 *    exists on disk. If the sheet fails to load, throws and pushes to
 *    ErrorLog. No silent fallback to paladin.
 *  - CONFIG.graphics.ai_skin === false but skinPrompt is non-empty → throws.
 *    Caller asked for something the config does not allow. */
async function setPlayerAppearance(modelId: string, skinPrompt: string): Promise<void> {
  if (!CONFIG.graphics.player_sprites) {
    if (skinPrompt) {
      const msg = `appearance.skin_path="${skinPrompt}" requires graphics.player_sprites=true`;
      errors.push("config", msg);
      throw new Error(msg);
    }
    playerModel = null;
    playerSkinPrompt = "";
    return;
  }

  if (!modelId) {
    const msg = "appearance.model_id is empty but graphics.player_sprites=true";
    errors.push("player", msg);
    throw new Error(msg);
  }

  playerSkinPrompt = skinPrompt;
  playerAnimStartedAt = performance.now();

  await spriteRenderer.loadAnimation(modelId, "idle", WORLD_ANGLE);
  playerModel = modelId;

  if (skinPrompt) {
    if (!CONFIG.graphics.ai_skin) {
      const msg = `appearance.skin_path="${skinPrompt}" requires graphics.ai_skin=true`;
      errors.push("config", msg);
      throw new Error(msg);
    }
    await spriteRenderer.loadSkinnedAnimation(modelId, "idle", WORLD_ANGLE, skinPrompt);
    log(`skin aplicado: ${skinPrompt.slice(0, 40)}`);
  }
}

const config = loadConfig(combatConfigJson);

// --- DOM elements ---
const canvas = document.getElementById("game") as HTMLCanvasElement;
const WORLD_ANGLE = "isometric_30";
const AI_SERVER_URL = "http://127.0.0.1:8765";
const spriteRenderer = new SpriteRenderer("/sprites", AI_SERVER_URL);
const assetCache = new AssetCache(AI_SERVER_URL);
const renderer = new CanvasRenderer(canvas, {
  spriteRenderer,
  assetCache,
  worldAngle: WORLD_ANGLE,
});
// Sprite sheets are loaded on demand from setPlayerAppearance once the
// session starts. No pre-load: if the player ends up needing them, that
// happens behind an explicit CONFIG.graphics.player_sprites=true check.
const playerHpBar = document.getElementById("player-hp") as HTMLElement;
const playerHpText = document.getElementById("player-hp-text") as HTMLElement;
const enemyBarsContainer = document.getElementById("enemy-bars") as HTMLElement;
const combatLog = document.getElementById("combat-log") as HTMLElement;
const attackBtns = document.querySelectorAll(".attack-selector span");
const sceneSelector = document.getElementById("room-selector") as HTMLSelectElement;
const connectionStatus = document.getElementById("connection-status") as HTMLElement;

const dialoguePanel = new DialoguePanel();
const objectiveDisplay = new ObjectiveDisplay();
const travelPanel = new TravelPanel();
const interactPromptEl = document.getElementById("interact-prompt") as HTMLElement;
errors.attach(document.getElementById("error-log") as HTMLElement);

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
let sceneData: Record<string, unknown> | null = null;
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

// --- Scene loading ---

function populateSceneSelector(): void {
  // Scene fixtures (cargados localmente, sin bridge).
  const scenes: { key: string; label: string }[] = [];
  for (const path of Object.keys(sceneModules)) {
    // path like "../../nefan-core/data/scenes/tavern_clearing.json"
    const match = path.match(/scenes\/(.+)\.json$/);
    if (!match) continue;
    scenes.push({ key: path, label: match[1] });
  }
  if (scenes.length > 0) {
    const sceneGroup = document.createElement("optgroup");
    sceneGroup.label = "Scene";
    for (const entry of scenes.sort((a, b) => a.label.localeCompare(b.label))) {
      const opt = document.createElement("option");
      opt.value = entry.key;
      opt.textContent = entry.label;
      sceneGroup.appendChild(opt);
    }
    sceneSelector.appendChild(sceneGroup);
  }

  // Narrative games — vía bridge + Claude.
  const narrativeGroup = document.createElement("optgroup");
  narrativeGroup.label = "Narrative";
  const tavernOpt = document.createElement("option");
  tavernOpt.value = "game:tavern_intro";
  tavernOpt.textContent = "tavern_intro";
  narrativeGroup.appendChild(tavernOpt);
  sceneSelector.appendChild(narrativeGroup);
}

async function loadSceneFile(globKey: string): Promise<void> {
  const loader = sceneModules[globKey];
  if (!loader) {
    log("Scene not found: " + globKey);
    return;
  }

  const mod = await loader();
  await loadSceneData(mod.default);
}

/** Detecta si `data` viene en Map Format D (size.cols + terrain como array de
 *  strings + entities con cell/footprint) y, si es así, lo convierte al
 *  formato que el canvas-renderer ya entiende (`dimensions` + `objects[]` +
 *  `npcs[]` con position/scale en metros). Si no es D, lo devuelve tal cual. */
function normalizeSceneFormatD(raw: Record<string, unknown>): Record<string, unknown> {
  const size = raw.size as { cols?: number; rows?: number; meters_per_cell?: number } | undefined;
  const terrain = raw.terrain;
  const entities = raw.entities;
  const isFormatD =
    !!size && typeof size.cols === "number" && typeof size.rows === "number" &&
    Array.isArray(terrain) && terrain.every(r => typeof r === "string") &&
    Array.isArray(entities);

  if (!isFormatD) return raw;

  const cols = size!.cols!;
  const rows = size!.rows!;
  const mpc = size!.meters_per_cell ?? 2;
  const halfW = (cols * mpc) / 2;
  const halfD = (rows * mpc) / 2;

  type FormatDEntity = {
    id: string; kind: string; name: string;
    cell: [number, number]; footprint: [number, number]; glyph?: string;
    texture_hash?: string; model_hash?: string;
  };

  const objects: Record<string, unknown>[] = [];
  const npcs: Record<string, unknown>[] = [];
  let playerStart: { x: number; z: number } | null = null;

  const VALID_KINDS = new Set(["player", "npc", "building", "prop", "tree", "item"]);
  for (let i = 0; i < entities.length; i++) {
    const ent = (entities as FormatDEntity[])[i];
    if (!ent) throw new Error(`scene entities[${i}] is null/undefined`);
    if (!ent.id) throw new Error(`scene entities[${i}] missing id`);
    if (!VALID_KINDS.has(ent.kind)) {
      throw new Error(`scene entities[${i}] (${ent.id}) has invalid kind="${ent.kind}"; expected one of ${[...VALID_KINDS]}`);
    }
    if (!Array.isArray(ent.cell) || ent.cell.length < 2) {
      throw new Error(`scene entities[${i}] (${ent.id}) missing cell [col,row]`);
    }
    if (!Array.isArray(ent.footprint) || ent.footprint.length < 2) {
      throw new Error(`scene entities[${i}] (${ent.id}) missing footprint [w,h]`);
    }
    const [c, r] = ent.cell;
    const [w, h] = ent.footprint;
    if (![c, r, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new Error(`scene entities[${i}] (${ent.id}) cell/footprint must be finite numbers, got cell=[${c},${r}] fp=[${w},${h}]`);
    }
    // Centro del footprint en coordenadas mundo (origin = centro del mapa).
    const x = (c + w / 2) * mpc - halfW;
    const z = (r + h / 2) * mpc - halfD;

    if (ent.kind === "player") {
      playerStart = { x, z };
      continue;
    }
    if (ent.kind === "npc") {
      if (!ent.name) {
        throw new Error(`scene entities[${i}] (npc ${ent.id}) missing name`);
      }
      npcs.push({
        id: ent.id,
        name: ent.name,
        position: [x, 0, z],
      });
      continue;
    }
    // building / prop / tree / item: tree maps to prop visually.
    const category = (ent.kind === "tree") ? "prop" : ent.kind;
    if (!ent.name) {
      throw new Error(`scene entities[${i}] (${ent.id}) missing name`);
    }
    const obj: Record<string, unknown> = {
      id: ent.id,
      position: [x, 0, z],
      scale: [w * mpc, 1, h * mpc],
      category,
      description: ent.name,
    };
    if (ent.texture_hash) obj.texture_hash = ent.texture_hash;
    if (ent.model_hash)   obj.model_hash = ent.model_hash;
    objects.push(obj);
  }

  return {
    scene_id: raw.scene_id ?? raw.room_id,
    room_id: raw.scene_id ?? raw.room_id,
    scene_description: raw.scene_description ?? raw.room_description ?? "",
    room_description: raw.scene_description ?? raw.room_description ?? "",
    dimensions: { width: cols * mpc, depth: rows * mpc, height: 3 },
    terrain: { color: [0.18, 0.22, 0.14] },
    objects,
    npcs,
    ambient_event: raw.ambient_event,
    // El bridge adjunta las salidas del world map; el renderer las ignora pero
    // loadSceneData las pasa al TravelPanel.
    exits: raw.exits,
    // Metadatos para el cliente — el renderer los ignora.
    __player_start: playerStart,
    __format_d: raw,
  };
}

/** Apply an already-resolved scene JSON to the renderer + game client.
 *  Used tanto por el dropdown de escenarios locales como por el flujo narrativo
 *  (start_session / resume_session). Acepta el campo legacy `room_id` para
 *  saves antiguos. */
async function loadSceneData(rawData: Record<string, unknown>): Promise<void> {
  const data = normalizeSceneFormatD(rawData);
  sceneData = data;
  scenarioActive = false;

  renderer.setScene(data as unknown as Parameters<typeof renderer.setScene>[0]);

  // Reset player — si la escena trae __player_start (Format D), aplicarlo.
  const playerStart = data.__player_start as { x: number; z: number } | null | undefined;
  if (playerStart) {
    playerPos.x = playerStart.x;
    playerPos.z = playerStart.z;
  } else {
    playerPos.x = 0;
    playerPos.z = 2;
  }

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
    const scale = (obj.scale as number[] | undefined);
    const sizeXZ = scale && scale.length >= 3
      ? { x: scale[0], z: scale[2] }
      : undefined;
    const category = obj.category as string | undefined;
    const combat = obj.combat as Record<string, unknown> | undefined;
    if (combat) {
      // Combat block exists → every field is required. The narrative engine
      // sets these explicitly; missing values mean the LLM produced a broken
      // combat record, not a place to default-fill.
      if (typeof combat.health !== "number" || !Number.isFinite(combat.health)) {
        throw new Error(`scene object ${obj.id} combat.health must be a finite number, got ${combat.health}`);
      }
      if (typeof combat.weapon_id !== "string" || !combat.weapon_id) {
        throw new Error(`scene object ${obj.id} combat.weapon_id missing`);
      }
      const personality = combat.personality as Record<string, unknown> | undefined;
      if (!personality || typeof personality !== "object") {
        throw new Error(`scene object ${obj.id} combat.personality missing`);
      }
      const requireNum = (key: string): number => {
        const v = personality[key];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          throw new Error(`scene object ${obj.id} combat.personality.${key} must be a finite number, got ${v}`);
        }
        return v;
      };
      const attacks = personality.preferred_attacks;
      if (!Array.isArray(attacks) || attacks.length === 0 ||
          !attacks.every((a) => typeof a === "string")) {
        throw new Error(`scene object ${obj.id} combat.personality.preferred_attacks must be a non-empty string array`);
      }
      enemies.push({
        id: obj.id as string,
        position: pos,
        health: combat.health,
        weaponId: combat.weapon_id,
        personality: {
          aggression: requireNum("aggression"),
          preferred_attacks: attacks as string[],
          reaction_time: requireNum("reaction_time"),
          combat_range: requireNum("combat_range"),
          ...personality,
        },
      });
      const color = ENEMY_COLORS[colorIdx++ % ENEMY_COLORS.length];
      const enemyEntity: Entity = {
        id: obj.id as string, pos, radius: 8, color,
        label: (obj.description ?? obj.id) as string,
        hp: combat.health as number, maxHp: combat.health as number, alive: true,
        category: category ?? "creature",
        sizeXZ,
      };
      enemyEntities.push(enemyEntity);
    } else {
      const objectEntity: Entity = {
        id: obj.id as string, pos, radius: 5,
        color: category === "item" ? "#aa8" : "#666",
        label: (obj.description ?? "") as string, alive: true,
        category: category ?? "prop",
        sizeXZ,
      };
      objectEntities.push(objectEntity);
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
      category: "creature",
    };
    return entity;
  });

  // Build enemy HP bars
  rebuildEnemyBars();

  // Travel panel — el bridge adjunta `exits` (salidas del world map).
  travelPanel.setExits((data.exits ?? []) as SceneExit[]);

  // Notify game client (load_room sigue siendo el mensaje del protocolo —
  // sólo el cliente HTML ya no piensa en "salas").
  if (gameClient) {
    gameClient.loadRoom(data, (data.scene_id ?? data.room_id ?? "unknown") as string, enemies);
  }

  log("Scene loaded: " + (data.scene_id ?? data.room_id ?? "unknown"));
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

// --- Collision ---
const PLAYER_RADIUS = 0.4;

/** AABB collision of the player (inflated point) against solid scene objects.
 *  Items are walkable; only buildings and props block. */
function collidesAt(x: number, z: number): boolean {
  for (const obj of objectEntities) {
    if (!obj.sizeXZ) continue;
    if (obj.category !== "building" && obj.category !== "prop") continue;
    const hx = obj.sizeXZ.x / 2 + PLAYER_RADIUS;
    const hz = obj.sizeXZ.z / 2 + PLAYER_RADIUS;
    if (Math.abs(x - obj.pos.x) < hx && Math.abs(z - obj.pos.z) < hz) {
      return true;
    }
  }
  return false;
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
    const next = scenario.change_scene as Record<string, unknown>;
    sceneData = next;
    scenarioActive = true;
    renderer.setScene(next as unknown as Parameters<typeof renderer.setScene>[0]);
    playerPos.x = 0;
    playerPos.z = 2;

    // Parse objects/npcs from scene data
    const objects = (next.objects ?? []) as Record<string, unknown>[];
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

    const npcsData = (next.npcs ?? []) as Record<string, unknown>[];
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
    travelPanel.setExits((next.exits ?? []) as SceneExit[]);
    log("Scene changed: " + (next.scene_id ?? next.room_id ?? "unknown"));
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

// --- Scene selector handler ---

sceneSelector.addEventListener("change", () => {
  const value = sceneSelector.value;
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
    loadSceneFile(value);
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
// Evita reenviar interact_entity mientras el motor narrativo aún responde.
let interactCooldownUntil = 0;

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
      const dx = moveX * speed * delta;
      const dz = moveZ * speed * delta;
      // Resolución por ejes contra objetos sólidos → desliza por las paredes.
      if (!collidesAt(playerPos.x + dx, playerPos.z)) playerPos.x += dx;
      if (!collidesAt(playerPos.x, playerPos.z + dz)) playerPos.z += dz;
    }

    // Clamp al borde del terrain (los bounds de la escena open-world).
    if (sceneData) {
      const dims = sceneData.dimensions as { width: number; depth: number };
      if (dims) {
        const halfW = dims.width / 2 - 0.3;
        const halfD = dims.depth / 2 - 0.3;
        playerPos.x = Math.max(-halfW, Math.min(halfW, playerPos.x));
        playerPos.z = Math.max(-halfD, Math.min(halfD, playerPos.z));
      }
    }
  }

  // NPC interaction — NPC vivo más cercano dentro de rango + tecla E.
  const INTERACT_RANGE = 2.5;
  let npcInRange: Entity | null = null;
  let nearestDist = Infinity;
  for (const npc of npcEntities) {
    if (npc.alive === false) continue;
    const d = Math.hypot(npc.pos.x - playerPos.x, npc.pos.z - playerPos.z);
    if (d < nearestDist) { nearestDist = d; npcInRange = npc; }
  }
  if (npcInRange && nearestDist > INTERACT_RANGE) npcInRange = null;

  if (npcInRange && !dialoguePanel.isVisible) {
    interactPromptEl.textContent = `[E] hablar con ${npcInRange.name ?? npcInRange.id}`;
    interactPromptEl.style.display = "block";
  } else {
    interactPromptEl.style.display = "none";
  }

  const interactPressed = input.consumeInteract();
  if (interactPressed && npcInRange && !dialoguePanel.isVisible && now >= interactCooldownUntil) {
    interactCooldownUntil = now + 3000;
    const name = (npcInRange.name ?? npcInRange.id) as string;
    narrativeClient.interactEntity(npcInRange.id, name);
    log(`Hablando con ${name}...`);
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

  // Render. Sprite is supplied only when player_sprites is on AND the sheet
  // has been loaded by setPlayerAppearance. Otherwise the renderer draws the
  // primary path (a circle) — explicitly, not as a fallback.
  const playerSprite = CONFIG.graphics.player_sprites && playerModel !== null
    ? {
        model: spriteRenderer.skinnedKey(playerModel, playerSkinPrompt),
        anim: "idle",
        angle: WORLD_ANGLE,
        animStartedAt: playerAnimStartedAt,
      }
    : undefined;
  renderer.render(
    {
      pos: playerPos,
      forward: playerForward,
      hp: result.playerHp,
      maxHp: playerMaxHp,
      sprite: playerSprite,
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

populateSceneSelector();

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

travelPanel.onTravel = (placeId) => {
  if (!activeSessionId) return;
  showLoader("Viajando...", "El motor narrativo está preparando el lugar.");
  narrativeClient.enterPlace(placeId);
};

// --- Narrative loader (status-driven overlay) ---
const loaderEl = document.getElementById("narrative-loader") as HTMLDivElement | null;
const loaderTitle = document.getElementById("narrative-loader-title");
const loaderDetail = document.getElementById("narrative-loader-detail");
const loaderElapsed = document.getElementById("narrative-loader-elapsed");
const loaderDismiss = document.getElementById("narrative-loader-dismiss");

let loaderStartedAt = 0;
let loaderTicker: ReturnType<typeof setInterval> | null = null;

function showLoader(title: string, detail: string): void {
  if (!loaderEl) return;
  loaderEl.classList.remove("error");
  loaderEl.classList.add("visible");
  if (loaderTitle) loaderTitle.textContent = title;
  if (loaderDetail) loaderDetail.textContent = detail;
  loaderStartedAt = Date.now();
  if (loaderElapsed) loaderElapsed.textContent = "0s";
  if (loaderTicker) clearInterval(loaderTicker);
  loaderTicker = setInterval(() => {
    if (!loaderElapsed) return;
    const s = Math.floor((Date.now() - loaderStartedAt) / 1000);
    loaderElapsed.textContent = `${s}s`;
  }, 500);
}

function hideLoader(): void {
  if (!loaderEl) return;
  loaderEl.classList.remove("visible", "error");
  if (loaderTicker) {
    clearInterval(loaderTicker);
    loaderTicker = null;
  }
}

function setLoaderState(state: "error", title: string, detail: string): void {
  if (!loaderEl) return;
  loaderEl.classList.remove("error");
  loaderEl.classList.add("visible", state);
  if (loaderTitle) loaderTitle.textContent = title;
  if (loaderDetail) loaderDetail.textContent = detail;
  if (loaderTicker) {
    clearInterval(loaderTicker);
    loaderTicker = null;
  }
}

if (loaderDismiss) loaderDismiss.onclick = () => hideLoader();

narrativeClient.onNarrativeStatus((status) => {
  if (status.kind === "scene") {
    switch (status.phase) {
      case "generating":
        showLoader(
          "Generando escena...",
          status.message ?? "El motor narrativo está construyendo el mundo. Puede tardar un momento.",
        );
        break;
      case "ready":
        hideLoader();
        break;
      case "error": {
        const detail = status.message ?? "Algo falló en el motor narrativo.";
        errors.push("narrative", detail);
        setLoaderState("error", "Error al generar la escena", detail);
        break;
      }
    }
    return;
  }

  // Estados que no son de escena (consequences / plugins). El bridge sólo los
  // emite en error: una reacción narrativa rechazada (p.ej. 422 de
  // /report_player_choice por una consequence mal formada). Sin esto el error
  // se traga en silencio — el jugador no ve diálogo ni motivo. Lo surgimos al
  // error-log y a un overlay descartable.
  if (status.phase === "error") {
    const detail = status.message ?? "El motor narrativo rechazó la reacción.";
    errors.push("narrative", detail);
    setLoaderState("error", "El motor narrativo rechazó la respuesta", detail);
  }
});

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
      case "plugin_applied":
        log(`⚙️ plugin ${effect.pluginId.slice(0, 8)}…: ${effect.eventType} → ${effect.changedPaths.join(", ") || "(solo slice)"}`);
        break;
    }
  }
});

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    const client = await createGameClient(sharedBridge);
    gameClient = client;
    updateConnectionStatus(client.isConnected, true);
    client.on("connected", () => updateConnectionStatus(true, true));
    client.on("disconnected", () => updateConnectionStatus(false, true));
    await runTitleFlow();
  } catch (err) {
    setLoaderState(
      "error",
      "No se pudo arrancar la partida",
      (err as Error).message,
    );
    errors.push("session", "bootstrap failed", err);
  }
}

async function runTitleFlow(): Promise<void> {
  let action: TitleAction;
  try {
    action = await titleScreen.show();
  } catch (err) {
    titleScreen.hide();
    setLoaderState(
      "error",
      "No se pudo mostrar la pantalla de título",
      (err as Error).message,
    );
    errors.push("session", "title-screen failed", err);
    throw err;
  }

  try {
    if (action.kind === "new_game") {
      // Show loader immediately so the canvas isn't blank while we wait on
      // start_session + the bridge's "generating" broadcast.
      showLoader(
        "Iniciando partida...",
        "Pidiendo al motor narrativo que construya la escena inicial.",
      );
      const res = await narrativeClient.startSession(action.gameId, action.appearance);
      activeSessionId = res.sessionId;
      historyBrowser.setSession(res.sessionId);
      log(`Nueva partida: ${res.sessionId} (${action.gameId})`);
      await setPlayerAppearance(action.appearance.model_id, action.appearance.skin_path);
    } else {
      const res = await narrativeClient.resumeSession(action.sessionId);
      activeSessionId = res.state.session_id;
      historyBrowser.setSession(res.state.session_id);
      log(`Reanudada: ${res.state.session_id}`);
      // resume: trust the save's appearance verbatim. If model_id is empty
      // and player_sprites is on, setPlayerAppearance will refuse to start.
      const desiredModel = res.state.player.appearance.model_id;
      const skinPath = res.state.player.appearance.skin_path || "";
      await setPlayerAppearance(desiredModel, skinPath);

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
    setLoaderState(
      "error",
      "No se pudo iniciar la sesión",
      (err as Error).message,
    );
    errors.push("session", "session start/resume failed", err);
    throw err;
  } finally {
    titleScreen.hide();
  }
}

requestAnimationFrame(gameLoop);
