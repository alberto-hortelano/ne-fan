/** Vida ambiental de NPCs — el ejecutor del "verbo" que NpcDirector solo
 *  almacena (src/world-map/npc-director.ts: "executing the verb is a
 *  separate concern").
 *
 *  Corre dentro del tick de GameSimulation y opera SOBRE los EntityRecord de
 *  NarrativeState: muta `record.position` in situ (misma filosofía que los
 *  CombatantState del sim), así el save persiste las posiciones gratis.
 *
 *  Capas:
 *  - Intención (LLM): `data.directive` (wander/goto_place/visit_npc/hold) y
 *    `data.in_transit` (npc_move_to_place). Verbos desconocidos degradan a
 *    micro-wander con warning — el LLM puede inventar verbos.
 *  - Reflejos locales por rol (data.role): girarse hacia el jugador cercano,
 *    huir de peleas (peasant), intervenir (guard). Sin LLM en el hot loop.
 *  - Sin directiva: micro-wander alrededor del spawn para que se vea vida.
 *
 *  Determinista con SeededRng (mismo seed + mismos ticks → mismas posiciones).
 */

import type { Vec3, CombatEvent } from "../types.js";
import type { EntityRecord } from "../narrative/types.js";
import { SeededRng } from "../rng.js";
import { resolveRoleParams, type NpcRoleParams } from "./npc-roles.js";

export type NpcMode = "idle" | "wander" | "goto" | "visit" | "flee" | "intervene" | "react";

/** Lo que el sistema necesita del mundo — el bridge inyecta el real
 *  (colisión server-side + world map + entities); los tests, un fake. */
export interface NpcWorldAdapter {
  blocksMove(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): boolean;
  blocksCircle(x: number, z: number, radius: number): boolean;
  resolvePlaceTarget(placeId: string): { x: number; z: number } | null;
  getEntityPosition(entityId: string): Vec3 | null;
}

export interface NpcBehaviorEvent {
  type: "npc_reached_place" | "npc_reached_npc" | "npc_fled_combat"
    | "npc_intervened" | "npc_resumed";
  npcId: string;
  placeId?: string;
  targetId?: string;
}

export interface NpcTickContext {
  playerPos: Vec3;
  /** CombatEvents del tick en curso (attack_started/attack_landed/…). */
  combatEvents: CombatEvent[];
  /** Posiciones de los combatientes vivos, para localizar la pelea. */
  combatantPositions: ReadonlyMap<string, Vec3>;
}

export interface NpcState {
  id: string;
  pos: Vec3;
  forward: Vec3;
  moving: boolean;
  run: boolean;
  /** Animación one-shot pedida al cliente (p. ej. "quick" como amenaza). */
  anim?: string;
  mode: NpcMode;
}

export interface NpcBehaviorSystem {
  readonly id: string;
  addNpc(record: EntityRecord): void;
  removeNpc(id: string): void;
  has(id: string): boolean;
  ids(): string[];
  clear(): void;
  tick(delta: number, ctx: NpcTickContext): NpcBehaviorEvent[];
  states(): NpcState[];
}

export interface NpcBehaviorDeps {
  rng: SeededRng;
  world: NpcWorldAdapter;
}

/** Radio de colisión del NPC — mayor que el del jugador (0.4) porque la
 *  colisión server-side no tiene el raster fino del map_ground SVG. */
const NPC_RADIUS = 0.5;
/** Cadencia de decisión (re-lectura de directiva, proximidad del jugador). */
const DECIDE_INTERVAL = 0.25;
/** Umbral de llegada a un waypoint de wander. */
const WAYPOINT_REACHED = 0.3;
/** Umbral de llegada a un place / NPC visitado. */
const GOAL_REACHED = 1.5;
/** Distancia máxima a la que un goto_place se ejecuta físicamente (2 tiles);
 *  más lejos queda narrative-paced (el LLM declara la llegada). */
const MAX_GOTO_DIST = 128;
/** Segundos sin eventos de combate cerca para volver a la rutina. */
const COMBAT_CLEAR_SECONDS = 4;
/** Margen extra sobre perception_radius al que el que huye se detiene. */
const FLEE_EXTRA_DIST = 4;
/** Distancia a la que el guardia se planta frente al hostil. */
const INTERVENE_STOP_DIST = 2;
/** Ciclo de amenaza del guardia: periodo y ventana con anim "quick". */
const THREAT_PERIOD = 2.5;
const THREAT_ANIM_WINDOW = 0.6;

/** Tipos de CombatEvent que delatan una pelea en curso. */
const FIGHT_EVENT_TYPES = new Set(["attack_started", "attack_landed", "damage_received"]);

const DEFLECTION_ANGLES = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2,
  (3 * Math.PI) / 4, -(3 * Math.PI) / 4];

interface NpcRuntime {
  record: EntityRecord;
  params: NpcRoleParams;
  home: { x: number; z: number };
  mode: NpcMode;
  forward: Vec3;
  moving: boolean;
  running: boolean;
  anim?: string;
  waypoint: { x: number; z: number } | null;
  /** Pausa entre tramos de wander. */
  pauseTimer: number;
  /** Timer staggered de decisiones (evita que todos decidan el mismo tick). */
  decideTimer: number;
  /** Último foco de pelea percibido y tiempo desde el último evento cercano. */
  danger: { x: number; z: number } | null;
  dangerTimer: number;
  threatTimer: number;
  /** Serialización de la directiva vigente, para detectar cambios. */
  directiveKey: string;
  /** Meta ya alcanzada ("place:<id>" | "npc:<id>") — evita re-emitir eventos. */
  reachedGoal: string | null;
}

function rotate(dir: { x: number; z: number }, angle: number): { x: number; z: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: dir.x * c - dir.z * s, z: dir.x * s + dir.z * c };
}

function distXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function readDirective(rt: NpcRuntime): { type: string; [key: string]: unknown } | null {
  const d = rt.record.data.directive;
  if (d && typeof d === "object" && typeof (d as { type?: unknown }).type === "string") {
    return d as { type: string; [key: string]: unknown };
  }
  return null;
}

function readTransitTo(rt: NpcRuntime): string | null {
  const t = rt.record.data.in_transit;
  if (t && typeof t === "object" && typeof (t as { to?: unknown }).to === "string") {
    return (t as { to: string }).to;
  }
  return null;
}

class AmbientNpcBehavior implements NpcBehaviorSystem {
  readonly id = "ambient";
  private npcs = new Map<string, NpcRuntime>();
  private rng: SeededRng;
  private world: NpcWorldAdapter;
  private warned = new Set<string>();

  constructor(deps: NpcBehaviorDeps) {
    this.rng = deps.rng;
    this.world = deps.world;
  }

  addNpc(record: EntityRecord): void {
    const existing = this.npcs.get(record.id);
    if (existing) {
      // Re-sync (cambio de tile, resume): conservar el runtime y apuntar al
      // record vigente — la posición autoritativa es la del record.
      existing.record = record;
      return;
    }
    this.npcs.set(record.id, {
      record,
      params: resolveRoleParams(record.data),
      home: { x: record.position[0], z: record.position[2] },
      mode: "idle",
      forward: { x: 0, y: 0, z: -1 },
      moving: false,
      running: false,
      waypoint: null,
      pauseTimer: this.rng.next() * 3,
      decideTimer: this.rng.next() * DECIDE_INTERVAL,
      danger: null,
      dangerTimer: 0,
      threatTimer: 0,
      directiveKey: JSON.stringify(record.data.directive ?? null),
      reachedGoal: null,
    });
  }

  removeNpc(id: string): void {
    this.npcs.delete(id);
  }

  has(id: string): boolean {
    return this.npcs.has(id);
  }

  ids(): string[] {
    return [...this.npcs.keys()];
  }

  clear(): void {
    this.npcs.clear();
  }

  states(): NpcState[] {
    const out: NpcState[] = [];
    for (const rt of this.npcs.values()) {
      out.push({
        id: rt.record.id,
        pos: { x: rt.record.position[0], y: rt.record.position[1], z: rt.record.position[2] },
        forward: rt.forward,
        moving: rt.moving,
        run: rt.running,
        anim: rt.anim,
        mode: rt.mode,
      });
    }
    return out;
  }

  tick(delta: number, ctx: NpcTickContext): NpcBehaviorEvent[] {
    const events: NpcBehaviorEvent[] = [];
    const hotspots = this.collectFightHotspots(ctx);

    for (const rt of this.npcs.values()) {
      this.updateDanger(rt, hotspots, delta, events);
      rt.decideTimer -= delta;
      if (rt.decideTimer <= 0) {
        rt.decideTimer += DECIDE_INTERVAL;
        this.decide(rt, ctx, events);
      }
      this.move(rt, ctx, delta, events);
    }
    return events;
  }

  /** Posiciones de los combatientes que emitieron eventos de pelea este tick. */
  private collectFightHotspots(ctx: NpcTickContext): Array<{ x: number; z: number }> {
    const spots: Array<{ x: number; z: number }> = [];
    for (const ev of ctx.combatEvents) {
      if (!FIGHT_EVENT_TYPES.has(ev.type)) continue;
      const id = (ev as { combatantId?: unknown }).combatantId
        ?? (ev as { attackerId?: unknown }).attackerId;
      if (typeof id !== "string") continue;
      const pos = ctx.combatantPositions.get(id);
      if (pos) spots.push({ x: pos.x, z: pos.z });
    }
    return spots;
  }

  private updateDanger(
    rt: NpcRuntime,
    hotspots: Array<{ x: number; z: number }>,
    delta: number,
    events: NpcBehaviorEvent[],
  ): void {
    const px = rt.record.position[0];
    const pz = rt.record.position[2];
    let nearest: { x: number; z: number } | null = null;
    let nearestDist = Infinity;
    for (const spot of hotspots) {
      const d = distXZ(px, pz, spot.x, spot.z);
      if (d <= rt.params.perception_radius && d < nearestDist) {
        nearest = spot;
        nearestDist = d;
      }
    }

    if (nearest) {
      rt.danger = nearest;
      rt.dangerTimer = 0;
      // Transición inmediata (no esperar al decide tick): los eventos de
      // combate son transitorios.
      if (rt.params.flees_from_combat && rt.mode !== "flee") {
        rt.mode = "flee";
        rt.waypoint = null;
        rt.anim = undefined;
        events.push({ type: "npc_fled_combat", npcId: rt.record.id });
      } else if (rt.params.intervenes_in_combat && rt.mode !== "intervene") {
        rt.mode = "intervene";
        rt.waypoint = null;
        rt.threatTimer = 0;
        events.push({ type: "npc_intervened", npcId: rt.record.id });
      }
      return;
    }

    if (rt.danger) {
      rt.dangerTimer += delta;
      if (rt.dangerTimer >= COMBAT_CLEAR_SECONDS) {
        rt.danger = null;
        rt.anim = undefined;
        if (rt.mode === "flee" || rt.mode === "intervene") {
          rt.mode = "idle";
          rt.pauseTimer = 0.5 + this.rng.next() * 1.5;
          rt.waypoint = null;
          events.push({ type: "npc_resumed", npcId: rt.record.id });
        }
      }
    }
  }

  /** Decisión de baja frecuencia: re-deriva el modo desde la directiva y la
   *  proximidad del jugador. flee/intervene se gestionan en updateDanger. */
  private decide(rt: NpcRuntime, ctx: NpcTickContext, events: NpcBehaviorEvent[]): void {
    if (rt.mode === "flee" || rt.mode === "intervene") return;

    // Cambio de rol en runtime (el LLM puede reescribir data.role).
    if (typeof rt.record.data.role === "string" && rt.record.data.role !== rt.params.role) {
      rt.params = resolveRoleParams(rt.record.data);
    }

    // Cambio de directiva → resetear la meta en curso.
    const directiveKey = JSON.stringify(rt.record.data.directive ?? null);
    if (directiveKey !== rt.directiveKey) {
      rt.directiveKey = directiveKey;
      rt.waypoint = null;
      rt.reachedGoal = null;
      rt.mode = "idle";
      rt.pauseTimer = 0;
    }

    // react: pararse y encarar al jugador cercano. Solo interrumpe la rutina
    // (idle/wander) — un NPC en goto/visit sigue a lo suyo.
    const px = rt.record.position[0];
    const pz = rt.record.position[2];
    const playerDist = distXZ(px, pz, ctx.playerPos.x, ctx.playerPos.z);
    if (rt.mode === "react") {
      if (playerDist > rt.params.greet_radius + 1) {
        rt.mode = "idle";
        rt.pauseTimer = 0.3 + this.rng.next();
      }
      return;
    }
    if ((rt.mode === "idle" || rt.mode === "wander") && playerDist <= rt.params.greet_radius) {
      rt.mode = "react";
      rt.waypoint = null;
      return;
    }

    // Meta de alto nivel: in_transit (npc_move_to_place) > directiva.
    const transitTo = readTransitTo(rt);
    if (transitTo) {
      this.deriveGoto(rt, transitTo);
      return;
    }
    const directive = readDirective(rt);
    if (!directive) {
      if (rt.mode !== "wander") rt.mode = rt.pauseTimer > 0 ? "idle" : "wander";
      return;
    }
    switch (directive.type) {
      case "hold":
        rt.mode = "idle";
        rt.waypoint = null;
        rt.pauseTimer = Infinity;
        return;
      case "wander":
      case "patrol":
        if (rt.mode !== "wander" && rt.mode !== "idle") {
          rt.mode = "idle";
          rt.pauseTimer = 0;
        }
        if (rt.pauseTimer === Infinity) rt.pauseTimer = 0;
        return;
      case "goto_place": {
        const placeId = directive.target_place_id;
        if (typeof placeId !== "string" || !placeId) {
          this.warnOnce(`${rt.record.id}:goto_place`, `directiva goto_place de "${rt.record.id}" sin target_place_id — micro-wander`);
          rt.mode = "idle";
          if (rt.pauseTimer === Infinity) rt.pauseTimer = 0;
          return;
        }
        this.deriveGoto(rt, placeId);
        return;
      }
      case "visit_npc": {
        const targetId = directive.target_npc_id;
        if (typeof targetId !== "string" || !targetId) {
          this.warnOnce(`${rt.record.id}:visit_npc`, `directiva visit_npc de "${rt.record.id}" sin target_npc_id — micro-wander`);
          rt.mode = "idle";
          if (rt.pauseTimer === Infinity) rt.pauseTimer = 0;
          return;
        }
        this.deriveVisit(rt, targetId, events);
        return;
      }
      default:
        this.warnOnce(
          `${rt.record.id}:${directive.type}`,
          `directiva desconocida "${directive.type}" para "${rt.record.id}" — micro-wander (vocabulario: wander, patrol, goto_place, visit_npc, hold)`,
        );
        rt.mode = rt.pauseTimer > 0 && rt.pauseTimer !== Infinity ? "idle" : "wander";
        if (rt.pauseTimer === Infinity) rt.pauseTimer = 0;
        return;
    }
  }

  private deriveGoto(rt: NpcRuntime, placeId: string): void {
    if (rt.reachedGoal === `place:${placeId}`) {
      rt.mode = "idle";
      return;
    }
    const target = this.world.resolvePlaceTarget(placeId);
    const px = rt.record.position[0];
    const pz = rt.record.position[2];
    if (!target || distXZ(px, pz, target.x, target.z) > MAX_GOTO_DIST) {
      // Sin anchor cercano el viaje es narrative-paced (el LLM declarará la
      // llegada con npc_arrive) — mientras tanto, rutina normal.
      if (rt.mode === "goto") {
        rt.mode = "idle";
        rt.pauseTimer = 0;
      }
      return;
    }
    rt.mode = "goto";
    rt.waypoint = target;
  }

  private deriveVisit(rt: NpcRuntime, targetId: string, events: NpcBehaviorEvent[]): void {
    const target = this.world.getEntityPosition(targetId);
    if (!target) {
      this.warnOnce(
        `${rt.record.id}:visit:${targetId}`,
        `visit_npc: entidad "${targetId}" no encontrada para "${rt.record.id}" — micro-wander`,
      );
      rt.mode = "idle";
      if (rt.pauseTimer === Infinity) rt.pauseTimer = 0;
      return;
    }
    const px = rt.record.position[0];
    const pz = rt.record.position[2];
    if (distXZ(px, pz, target.x, target.z) <= GOAL_REACHED + NPC_RADIUS) {
      if (rt.reachedGoal !== `npc:${targetId}`) {
        rt.reachedGoal = `npc:${targetId}`;
        events.push({ type: "npc_reached_npc", npcId: rt.record.id, targetId });
      }
      rt.mode = "idle";
      rt.pauseTimer = Infinity; // quedarse de visita hasta nueva directiva
      rt.forward = this.faceTowards(rt, target.x, target.z);
      return;
    }
    rt.mode = "visit";
    rt.waypoint = { x: target.x, z: target.z };
  }

  /** Movimiento continuo por tick según el modo vigente. */
  private move(rt: NpcRuntime, ctx: NpcTickContext, delta: number, events: NpcBehaviorEvent[]): void {
    rt.moving = false;
    rt.running = false;
    if (rt.mode !== "intervene") rt.anim = undefined;

    switch (rt.mode) {
      case "idle":
        if (rt.pauseTimer !== Infinity) {
          rt.pauseTimer -= delta;
          if (rt.pauseTimer <= 0 && !readTransitTo(rt) && !readDirectiveBlocksWander(rt)) {
            rt.mode = "wander";
          }
        }
        return;

      case "react":
        rt.forward = this.faceTowards(rt, ctx.playerPos.x, ctx.playerPos.z);
        return;

      case "wander": {
        if (!rt.waypoint) {
          rt.waypoint = this.pickWanderWaypoint(rt);
          if (!rt.waypoint) {
            rt.mode = "idle";
            rt.pauseTimer = 1 + this.rng.next() * 2;
            return;
          }
        }
        const arrived = this.stepTowards(rt, rt.waypoint.x, rt.waypoint.z, rt.params.walk_speed, delta, WAYPOINT_REACHED);
        if (arrived) {
          rt.waypoint = null;
          rt.mode = "idle";
          rt.pauseTimer = 2 + this.rng.next() * 6;
        }
        return;
      }

      case "goto":
      case "visit": {
        if (!rt.waypoint) return;
        const arrived = this.stepTowards(rt, rt.waypoint.x, rt.waypoint.z, rt.params.walk_speed, delta, GOAL_REACHED);
        if (arrived) {
          if (rt.mode === "goto") {
            const placeId = readTransitTo(rt) ?? (readDirective(rt)?.target_place_id as string | undefined);
            if (placeId && rt.reachedGoal !== `place:${placeId}`) {
              rt.reachedGoal = `place:${placeId}`;
              events.push({ type: "npc_reached_place", npcId: rt.record.id, placeId });
            }
          }
          // El destino pasa a ser su nueva "casa": el micro-wander posterior
          // orbita el place alcanzado, no el spawn original.
          rt.home = { x: rt.record.position[0], z: rt.record.position[2] };
          rt.waypoint = null;
          rt.mode = "idle";
          rt.pauseTimer = 1 + this.rng.next() * 2;
        }
        return;
      }

      case "flee": {
        if (!rt.danger) return;
        const px = rt.record.position[0];
        const pz = rt.record.position[2];
        const dist = distXZ(px, pz, rt.danger.x, rt.danger.z);
        if (dist >= rt.params.perception_radius + FLEE_EXTRA_DIST) {
          // A salvo: parar y mirar hacia la pelea desde lejos.
          rt.forward = this.faceTowards(rt, rt.danger.x, rt.danger.z);
          return;
        }
        const away = {
          x: px + (dist > 1e-6 ? (px - rt.danger.x) / dist : 1) * 4,
          z: pz + (dist > 1e-6 ? (pz - rt.danger.z) / dist : 0) * 4,
        };
        this.stepTowards(rt, away.x, away.z, rt.params.run_speed, delta, WAYPOINT_REACHED);
        rt.running = rt.moving;
        return;
      }

      case "intervene": {
        if (!rt.danger) return;
        const px = rt.record.position[0];
        const pz = rt.record.position[2];
        const dist = distXZ(px, pz, rt.danger.x, rt.danger.z);
        if (dist > INTERVENE_STOP_DIST + 0.3) {
          this.stepTowards(rt, rt.danger.x, rt.danger.z, rt.params.run_speed, delta, INTERVENE_STOP_DIST);
          rt.running = rt.moving;
          rt.anim = undefined;
          return;
        }
        // Plantado frente al hostil: encararlo y amenazar cíclicamente con el
        // sprite de ataque quick. Sin daño real en v1 (joins_combat: false).
        rt.forward = this.faceTowards(rt, rt.danger.x, rt.danger.z);
        rt.threatTimer += delta;
        if (rt.threatTimer >= THREAT_PERIOD) rt.threatTimer -= THREAT_PERIOD;
        rt.anim = rt.threatTimer < THREAT_ANIM_WINDOW ? "quick" : undefined;
        return;
      }
    }
  }

  /** Avanza hacia (tx,tz) con evitación por deflexión. Devuelve true si el
   *  destino quedó a menos de `reachedDist`. */
  private stepTowards(
    rt: NpcRuntime,
    tx: number,
    tz: number,
    speed: number,
    delta: number,
    reachedDist: number,
  ): boolean {
    const px = rt.record.position[0];
    const pz = rt.record.position[2];
    const dist = distXZ(px, pz, tx, tz);
    if (dist <= reachedDist) return true;

    const dir = { x: (tx - px) / dist, z: (tz - pz) / dist };
    const step = Math.min(speed * delta, dist);
    // TODO(A*): steering por deflexión se atasca en cul-de-sacs; la máscara
    // walkable + BFS de scene-validate.ts es el molde para pathfinding real.
    for (const angle of DEFLECTION_ANGLES) {
      const d = angle === 0 ? dir : rotate(dir, angle);
      const nx = px + d.x * step;
      const nz = pz + d.z * step;
      if (this.world.blocksMove(px, pz, nx, nz, NPC_RADIUS)) continue;
      rt.record.position[0] = nx;
      rt.record.position[2] = nz;
      rt.forward = { x: d.x, y: 0, z: d.z };
      rt.moving = true;
      return distXZ(nx, nz, tx, tz) <= reachedDist;
    }
    // Bloqueado en todas las direcciones: soltar el waypoint y pausar la
    // rutina. flee/intervene conservan su modo (updateDanger los gestiona).
    rt.waypoint = null;
    if (rt.mode === "wander" || rt.mode === "goto" || rt.mode === "visit") {
      rt.mode = "idle";
      rt.pauseTimer = 1 + this.rng.next() * 2;
    }
    return false;
  }

  private pickWanderWaypoint(rt: NpcRuntime): { x: number; z: number } | null {
    const directive = readDirective(rt);
    let radius = rt.params.wander_radius;
    if (directive?.type === "patrol") radius *= 2;
    else if (directive?.type === "wander" && typeof directive.radius === "number" &&
      Number.isFinite(directive.radius) && directive.radius > 0) {
      radius = directive.radius;
    }
    for (let i = 0; i < 8; i++) {
      const angle = this.rng.next() * Math.PI * 2;
      const r = Math.min(1, radius) + this.rng.next() * Math.max(0, radius - 1);
      const x = rt.home.x + Math.cos(angle) * r;
      const z = rt.home.z + Math.sin(angle) * r;
      if (!this.world.blocksCircle(x, z, NPC_RADIUS)) return { x, z };
    }
    return null;
  }

  private faceTowards(rt: NpcRuntime, tx: number, tz: number): Vec3 {
    const px = rt.record.position[0];
    const pz = rt.record.position[2];
    const d = distXZ(px, pz, tx, tz);
    if (d < 1e-6) return rt.forward;
    return { x: (tx - px) / d, y: 0, z: (tz - pz) / d };
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[npc-behavior] ${msg}`);
  }
}

/** true si la directiva vigente impide el micro-wander desde idle. */
function readDirectiveBlocksWander(rt: NpcRuntime): boolean {
  const d = rt.record.data.directive;
  if (!d || typeof d !== "object") return false;
  const type = (d as { type?: unknown }).type;
  return type === "hold" || type === "goto_place" || type === "visit_npc";
}

export function createAmbientNpcBehavior(deps: NpcBehaviorDeps): NpcBehaviorSystem {
  return new AmbientNpcBehavior(deps);
}
