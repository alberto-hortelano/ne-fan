/** Never Ending Fantasy — 2D top-down HTML client.
 *  Dual mode: connects to nefan-core bridge (WebSocket) or falls back to local simulation. */

import type { Vec3, EffectiveParams } from "../../nefan-core/src/types.js";
import { distance, normalized, sub } from "../../nefan-core/src/vec3.js";
import { getEffectiveParams, loadConfig } from "../../nefan-core/src/combat/combat-data.js";
import { formatDToWorld } from "../../nefan-core/src/scene/scene-normalize.js";
import { CanvasRenderer, type Entity, type Occluder } from "./renderer/canvas-renderer.js";
import { SceneImageController } from "./scene/scene-image.js";
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
// La vista cenital 2D necesita un ritmo más arcade que el walk_speed realista
// (1.9 m/s) que comparte el Godot 3D en tercera persona. Multiplicador propio
// del cliente 2D para no alterar el config compartido (rompería el feel 3D).
const TOPDOWN_SPEED_SCALE = 2.2;
const SPEED = (playerCfg.walk_speed ?? 3.0) * TOPDOWN_SPEED_SCALE;
const SPRINT_SPEED = (playerCfg.sprint_speed ?? 5.5) * TOPDOWN_SPEED_SCALE;

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
// Generación IA del fondo de escena (img2img desde el esquema del canvas +
// outpainting). Disparada manualmente con G/O en dev. Puramente visual: no
// toca colisiones ni SceneData.
const sceneImageController = new SceneImageController(renderer, AI_SERVER_URL);
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

// --- Zoom (px por metro) ---
// El objetivo (zoomTarget) salta por pasos multiplicativos con la rueda/teclas;
// currentZoom lo persigue con suavizado frame-independent (mismo patrón que la
// cámara) y se aplica al renderer cada frame. Se persiste en localStorage.
const ZOOM_STEP = 1.12;   // factor por paso de rueda/tecla
const ZOOM_RATE = 12;     // velocidad de convergencia del suavizado
const ZOOM_KEY = "nefan.zoom";
function loadSavedZoom(): number {
  const raw = localStorage.getItem(ZOOM_KEY);
  const v = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(v) ? v : 40;
}
let zoomTarget = renderer.clampScale(loadSavedZoom());
let currentZoom = zoomTarget;
renderer.setScale(currentZoom);

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
/** Salidas del world-map de la escena actual (las adjunta el bridge). Se usan
 *  para la transición continua al cruzar un borde. */
let currentExits: SceneExit[] = [];
/** Cuando el jugador sale por un borde, se anota aquí el lado de SALIDA; la
 *  siguiente escena coloca al jugador en el borde OPUESTO (entra caminando, sin
 *  teletransporte al origen). null ⇒ usar __player_start / origen. */
let pendingEntryEdge: "north" | "south" | "east" | "west" | null = null;
/** Debounce para no disparar la transición de borde varias veces mientras llega
 *  la escena nueva. */
let edgeTransitionUntil = 0;

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

/** Apply an already-resolved scene JSON to the renderer + game client.
 *  Used tanto por el dropdown de escenarios locales como por el flujo narrativo
 *  (start_session / resume_session). Acepta el campo legacy `room_id` para
 *  saves antiguos. */
async function loadSceneData(rawData: Record<string, unknown>): Promise<void> {
  const data = formatDToWorld(rawData);
  sceneData = data;
  scenarioActive = false;

  renderer.setScene(data as unknown as Parameters<typeof renderer.setScene>[0]);

  // Reinicia el controlador de imagen de escena con el rectángulo de la nueva
  // escena (centrado en el origen) y limpia cualquier fondo IA anterior. La
  // generación se dispara después manualmente con G.
  {
    const d = data.dimensions as { width: number; depth: number } | undefined;
    if (d) {
      const hw = d.width / 2;
      const hd = d.depth / 2;
      sceneImageController.reset(
        { minX: -hw, minZ: -hd, maxX: hw, maxZ: hd },
        data as unknown as Parameters<typeof sceneImageController.reset>[1],
      );
    }
  }

  // Posición de entrada. Tres casos, en orden de prioridad:
  //  1) pendingEntryEdge: venimos de cruzar un borde → entramos por el lado
  //     OPUESTO preservando la posición lateral (transición continua, sin
  //     teletransporte al origen).
  //  2) __player_start: la escena Format D trae un punto de entrada explícito.
  //  3) origen (carga directa / save antiguo).
  const dims = data.dimensions as { width: number; depth: number } | undefined;
  const playerStart = data.__player_start as { x: number; z: number } | null | undefined;
  if (pendingEntryEdge && dims) {
    const halfW = dims.width / 2;
    const halfD = dims.depth / 2;
    const inset = 1.5;
    const clampLat = (v: number, half: number) => Math.max(-half + inset, Math.min(half - inset, v));
    switch (pendingEntryEdge) {
      case "north": playerPos.z = halfD - inset; playerPos.x = clampLat(playerPos.x, halfW); break; // salió al N → entra por el S
      case "south": playerPos.z = -halfD + inset; playerPos.x = clampLat(playerPos.x, halfW); break;
      case "east":  playerPos.x = -halfW + inset; playerPos.z = clampLat(playerPos.z, halfD); break; // salió al E → entra por el O
      case "west":  playerPos.x = halfW - inset;  playerPos.z = clampLat(playerPos.z, halfD); break;
    }
    pendingEntryEdge = null;
  } else if (playerStart) {
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

  // Travel panel — el bridge adjunta `exits` (salidas del world map). También
  // las guardamos para la transición continua al cruzar un borde (gameLoop).
  currentExits = (data.exits ?? []) as SceneExit[];
  travelPanel.setExits(currentExits);

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
/** El jugador puede salir del rectángulo de escena hasta este margen (metros)
 *  hacia el campo abierto, sin caer al vacío infinito. Sustituye a la "jaula"
 *  dura; la Fase 4 reemplazará este tope por una transición donde haya salidas. */
const EDGE_MARGIN = 6;

/** Phase 2 — snap each solid object's collision AABB to the footprint SAM
 *  actually found painted (the cyan box in the B overlay), so collisions match
 *  the image instead of the LLM-authored `scale`/`position`. Moves the centre to
 *  the segmented centre and resizes; `collidesAt` then blocks on the real shape.
 *  Degenerate masks (a near-empty crop, e.g. a flat rune) keep their authored
 *  box — a tiny footprint would otherwise make a real object walk-through. */
const MIN_REFINED_FOOTPRINT_M = 0.6;
function refineCollisionsFromSegments(occluders: Occluder[]): void {
  let refined = 0;
  for (const occ of occluders) {
    const obj = objectEntities.find((o) => o.id === occ.id);
    if (!obj) continue;
    const w = occ.world;
    const sx = w.maxX - w.minX;
    const sz = w.maxZ - w.minZ;
    if (sx < MIN_REFINED_FOOTPRINT_M || sz < MIN_REFINED_FOOTPRINT_M) continue;
    obj.pos.x = (w.minX + w.maxX) / 2;
    obj.pos.z = (w.minZ + w.maxZ) / 2;
    obj.sizeXZ = { x: sx, z: sz };
    refined++;
  }
  if (refined > 0) {
    console.log(`[collision] refined ${refined}/${occluders.length} AABBs to segmented footprint`);
  }
}

/** Phase 3: register props the image model invented (discovered via SAM3) as
 *  real solid objects so `collidesAt` blocks them and the B overlay shows them.
 *  Their occluder sprite already gives z-index; here we add the collision AABB
 *  from the same segmented footprint. Re-discovery updates in place by id. */
function addDiscoveredObjects(occluders: Occluder[]): void {
  let added = 0;
  for (const occ of occluders) {
    const w = occ.world;
    const sx = w.maxX - w.minX;
    const sz = w.maxZ - w.minZ;
    if (sx < MIN_REFINED_FOOTPRINT_M || sz < MIN_REFINED_FOOTPRINT_M) continue;
    const pos = { x: (w.minX + w.maxX) / 2, y: 0, z: (w.minZ + w.maxZ) / 2 };
    const sizeXZ = { x: sx, z: sz };
    const existing = objectEntities.find((o) => o.id === occ.id);
    if (existing) {
      existing.pos = pos;
      existing.sizeXZ = sizeXZ;
      existing.category = "prop";
    } else {
      objectEntities.push({
        id: occ.id, pos, radius: 5, color: "#9a8", label: occ.id,
        alive: true, category: "prop", sizeXZ,
      });
      added++;
    }
  }
  if (added > 0) console.log(`[collision] added ${added} discovered props with collision`);
}

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

  // Zoom: aplica la intención de rueda/teclas al objetivo (pasos multiplicativos,
  // clampados por el renderer) y persigue el objetivo con suavizado exponencial
  // frame-independent. Centrado en el jugador automáticamente (el offset de la
  // cámara se recomputa desde scale alrededor del player cada frame).
  const zd = input.consumeZoomDelta();
  if (zd !== 0) {
    zoomTarget = renderer.clampScale(zoomTarget * Math.pow(ZOOM_STEP, zd));
    localStorage.setItem(ZOOM_KEY, String(Math.round(zoomTarget)));
  }
  if (Math.abs(currentZoom - zoomTarget) > 0.01) {
    currentZoom += (zoomTarget - currentZoom) * (1 - Math.exp(-ZOOM_RATE * delta));
    renderer.setScale(currentZoom);
  }

  // Generación IA del escenario (dev): G regenera la imagen del escenario
  // actual desde el esquema; O hace outpaint hacia el borde más próximo al
  // jugador. Async fire-and-forget — el controlador ya loguea fallos a
  // ErrorLog; el .catch evita unhandled rejection.
  if (input.consumeGenerateScene()) {
    void sceneImageController.generateFull().catch(() => {});
  }
  if (input.consumeOutpaintScene()) {
    void sceneImageController.outpaintTowardPlayer(playerPos).catch(() => {});
  }
  // X segmenta los oclusores (muros/edificios) de la imagen actual para que
  // tapen al personaje (depth-sort). Requiere haber generado antes con G.
  if (input.consumeSegmentScene()) {
    void sceneImageController.segmentOccluders()
      .then((occ) => refineCollisionsFromSegments(occ))
      .catch(() => {});
  }
  // B alterna el overlay de bordes de colisión (rojo) vs footprint segmentado
  // (cian) sobre la imagen, para juzgar la precisión de las colisiones.
  if (input.consumeToggleCollisionDebug()) {
    const on = renderer.toggleDebugCollision();
    console.log(`[debug] collision overlay ${on ? "ON" : "OFF"}`);
  }
  // N descubre props que la IA inventó (SAM3 open-vocab) y les da oclusión +
  // colisión. Requiere haber generado antes con G (idealmente segmentado con X).
  if (input.consumeDiscoverObjects()) {
    void sceneImageController.discoverObjects()
      .then((disc) => addDiscoveredObjects(disc))
      .catch(() => {});
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

    // Borde blando: ya no hay jaula. El jugador sale del rectángulo de escena
    // al campo abierto hasta EDGE_MARGIN metros. Al alcanzar ese tope:
    //  - si el lado cruzado tiene una salida del world-map (caso lineal: una
    //    sola salida), se dispara una transición CONTINUA al lugar vecino y se
    //    anota el lado para entrar por el borde opuesto (sin teletransporte).
    //  - si no hay salida (o hay varias, ambiguas), sólo se retiene al jugador
    //    (la "pared" existe sólo donde el mundo no continúa; el TravelPanel
    //    sigue disponible para elegir destino).
    if (sceneData) {
      const dims = sceneData.dimensions as { width: number; depth: number };
      if (dims) {
        const limX = dims.width / 2 + EDGE_MARGIN;
        const limD = dims.depth / 2 + EDGE_MARGIN;
        // Lado cruzado (eje dominante). +x=este, -x=oeste, +z=sur, -z=norte.
        let crossed: "north" | "south" | "east" | "west" | null = null;
        if (playerPos.x > limX) crossed = "east";
        else if (playerPos.x < -limX) crossed = "west";
        else if (playerPos.z > limD) crossed = "south";
        else if (playerPos.z < -limD) crossed = "north";
        // Soft-clamp: nunca se sale más allá del tope.
        playerPos.x = Math.max(-limX, Math.min(limX, playerPos.x));
        playerPos.z = Math.max(-limD, Math.min(limD, playerPos.z));

        if (crossed && activeSessionId && currentExits.length === 1 && now >= edgeTransitionUntil) {
          edgeTransitionUntil = now + 8000;
          pendingEntryEdge = crossed;
          const exit = currentExits[0];
          showLoader("Viajando...", `Hacia ${exit.name}`);
          narrativeClient.enterPlace(exit.place_id);
          log(`Saliendo hacia ${exit.name}...`);
        }
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

/** Materializa un `spawn_entity` del motor narrativo EN LA ESCENA VIVA, sin
 *  recargar (Task 13 — paridad con godot/scripts/main.gd:_apply_spawn_entity_
 *  consequence). El `position` ya viene resuelto en metros mundo por el bridge
 *  (consequence-handler.ts:resolvePositionHint, relativo al jugador). NPCs van a
 *  npcEntities (interactuables con E); building/object a objectEntities con
 *  `sizeXZ` para que sean sólidos (collidesAt) y dibujables (drawSceneBox), que
 *  es la "geometría base" sobre la que luego se superponen imágenes IA. */
function materializeSpawn(effect: {
  entityId: string;
  entityKind: "npc" | "object" | "building";
  description: string;
  name?: string;
  position: [number, number, number];
  data: Record<string, unknown>;
}): void {
  const [x, y, z] = effect.position;
  const pos: Vec3 = { x, y, z };
  const label = (effect.name ?? effect.description ?? effect.entityId).slice(0, 40);
  const spriteHash = typeof effect.data.sprite_hash === "string" ? effect.data.sprite_hash : undefined;

  if (effect.entityKind === "npc") {
    npcEntities.push({
      id: effect.entityId,
      pos,
      forward: { x: 0, y: 0, z: -1 },
      radius: 7,
      color: "#68c",
      label,
      name: effect.name ?? effect.entityId,
      alive: true,
      category: "creature",
      spriteHash,
    });
    log(`✨ ${effect.name ?? "NPC"} aparece`);
    return;
  }

  // building / object: caja sólida colocada en la escena actual.
  const isBuilding = effect.entityKind === "building";
  objectEntities.push({
    id: effect.entityId,
    pos,
    radius: isBuilding ? 8 : 5,
    color: isBuilding ? "#5a4a38" : "#666",
    label,
    alive: true,
    category: isBuilding ? "building" : "prop",
    sizeXZ: isBuilding ? { x: 4, z: 4 } : { x: 1.4, z: 1.4 },
    spriteHash,
  });
  log(`✨ ${isBuilding ? "edificio" : "objeto"}: ${label}`);
}

narrativeClient.onNarrativeEvent((event) => {
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
        // El bridge envuelve una escena recién generada en un spawn_entity con
        // `data.scene` (ws-server.ts start_session): eso es "cargar escena".
        // Un spawn_entity SIN `data.scene` es una entidad suelta que se
        // materializa in-place en la escena viva (Task 13).
        const scene = (effect.data as Record<string, unknown> | undefined)?.scene as
          | Record<string, unknown>
          | undefined;
        if (scene) {
          void loadSceneData(scene);
          log(`🌍 escena cargada: ${effect.entityId}`);
        } else {
          materializeSpawn(effect);
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
