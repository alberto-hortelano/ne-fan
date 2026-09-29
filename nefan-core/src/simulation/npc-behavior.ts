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
import type { EntityRecord, SuspendedGoal } from "../narrative/types.js";
import { SeededRng } from "../rng.js";
// El radio del NPC vive junto a la colisión que lo consulta, no aquí: es el
// cuerpo MAYOR del juego y quien decide cuánto hueco dejar tiene que poder
// leerlo (issue #289).
import { NPC_RADIUS_M } from "../scene/terrain-collision.js";
import type { Impedimento, PorDondeSalir } from "./cajas-de-runtime.js";
import type { Punto, Ruta } from "./ruta-por-el-suelo.js";
import { resolveRoleParams, type NpcRoleParams } from "./npc-roles.js";

export type NpcMode = "idle" | "wander" | "goto" | "visit" | "flee" | "intervene" | "react";

/** Vocabulario de directivas que el motor EJECUTA — FUENTE ÚNICA. La tool MCP
 *  npc_set_directive construye su descripción desde esta lista; un verbo fuera
 *  de ella se guarda como intención pero degrada a micro-wander con warning
 *  (el LLM puede inventar verbos; degradación esperable, no fail). */
export const NPC_DIRECTIVE_TYPES = ["wander", "patrol", "goto_place", "visit_npc", "hold"] as const;
export type NpcDirectiveType = (typeof NPC_DIRECTIVE_TYPES)[number];

/** Lo que el sistema necesita del mundo — el bridge inyecta el real
 *  (colisión server-side + world map + entities); los tests, un fake. */
export interface NpcWorldAdapter {
  /** QUÉ impide el paso, y no solo si algo lo impide. Sustituye al booleano de
   *  siempre con #583 y NO es opcional: el escape del encajonado solo se abre
   *  sobre una caja de runtime, así que un adapter que no sepa distinguirlas
   *  tiene que romper `tsc` y no salir verde atravesando muros. */
  queImpideElPaso(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
  ): Impedimento;
  /** POR DÓNDE SALIR de lo que te tiene dentro, o `null`. Tampoco es opcional,
   *  y por el mismo motivo: sin ella el que tiene una caja encima se queda
   *  dentro andando para siempre, y eso salió VERDE en toda la batería (#583,
   *  QA H-2) porque la consulta de movimiento no le frena — solo es que nadie
   *  le empuja hacia fuera. Desde #616 contesta también por la geometría del
   *  TILE, así que el dueño de la respuesta puede ser `"tile"`. */
  porDondeSalirDeAqui(x: number, z: number, radius: number): PorDondeSalir | null;
  blocksCircle(x: number, z: number, radius: number): boolean;
  /** POR DÓNDE IR de `desde` a un sitio LIBRE junto a `hasta` (#618): la ruta
   *  del A* sobre la colisión que ve el sim —terreno, plan y cajas de runtime—
   *  y su meta ya movida fuera del sólido. Tampoco es opcional: un adapter sin
   *  ella tiene que romper `tsc` y no dejar al NPC pisando en el sitio delante
   *  del primer carro, que es lo que pasaba sin ella (57 s de 60 andando sin
   *  avanzar, `qa/el-mundo-solido-tambien-para-el-npc.mjs`). */
  buscarRuta(desde: Punto, hasta: Punto, radius: number, evitar?: ReadonlyArray<Punto>): Ruta;
  /** QUÉ HAY en la zona del punto, como huella comparable: si cambia, el
   *  mundo de ahí cambió. El NPC que se quedó SIN CAMINO solo lo reintenta por
   *  su cuenta cuando esto cambia (QA de BO, H3). Obligatorio por lo mismo que
   *  los demás: sin ella reintentaría a ciegas en bucle, o nunca. */
  huellaDeLaZona(x: number, z: number): string;
  resolvePlaceTarget(placeId: string): { x: number; z: number } | null;
  getEntityPosition(entityId: string): Vec3 | null;
}

export interface NpcBehaviorEvent {
  type: "npc_reached_place" | "npc_reached_npc" | "npc_fled_combat" | "npc_no_path" | "npc_path_reopened"
    | "npc_intervened" | "npc_resumed";
  npcId: string;
  placeId?: string;
  targetId?: string;
  /** `npc_fled_combat`: dónde era la pelea de la que huye. */
  fightAt?: { x: number; z: number };
  /** `npc_fled_combat`: la meta que llevaba y ABANDONA al huir, si llevaba
   *  una; `npc_no_path`: la que deja por no tener camino; `npc_path_reopened`:
   *  la que retoma porque el mundo de su zona cambió (ver `SuspendedGoal`). */
  suspended?: SuspendedGoal;
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
/** Margen extra sobre perception_radius al que el que huye se detiene. Es uno
 *  de los tres sumandos de `distanciaDeHuida`, que es la meta de verdad. */
const FLEE_EXTRA_DIST = 4;

/** CUÁNTO SE ALEJA DE SU `home` el micro-wander: el radio del rol, el doble
 *  si patrulla, o el `radius` que el motor escribió en la directiva `wander`.
 *  Una sola cuenta para el elector de waypoints y para la huida, que la
 *  necesita para saber hasta dónde correr. */
export function radioDePaseo(
  directive: { type: string; [key: string]: unknown } | null,
  params: NpcRoleParams,
): number {
  if (directive?.type === "patrol") return params.wander_radius * 2;
  if (directive?.type === "wander" && typeof directive.radius === "number" &&
    Number.isFinite(directive.radius) && directive.radius > 0) {
    return directive.radius;
  }
  return params.wander_radius;
}

/** HASTA DÓNDE HUYE: fuera de su percepción, un margen, y además lo que mide
 *  su paseo. El tercer sumando es #298: al acabar la huida su `home` pasa a
 *  ser donde se paró, y si el disco de paseo alrededor de ese punto cortaba el
 *  círculo de percepción de la pelea, el micro-wander le devolvía a verla y
 *  volvía a huir cada ~10 s. Con la meta a `percepción + margen + paseo`, el
 *  paseo entero queda fuera por geometría — porque la huida no se cierra hasta
 *  llegar aquí (`huidaEnCurso`), salvo que no pueda correr.
 *
 *  EXPORTADA a propósito: un test que escriba la meta a mano deja de proteger
 *  nada en cuanto alguien cambia un sumando —#262 se pasó semanas leyéndose
 *  como «la huida está rota» con un aserto de `> 3 m` que habría pasado igual
 *  con el tope puesto en 4. Quien mida la huida deriva su meta de aquí. */
export function distanciaDeHuida(params: NpcRoleParams, radioPaseo: number): number {
  return params.perception_radius + FLEE_EXTRA_DIST + radioPaseo;
}
/** Distancia a la que el guardia se planta frente al hostil. */
const INTERVENE_STOP_DIST = 2;
/** Ciclo de amenaza del guardia: periodo y ventana con anim "quick". */
const THREAT_PERIOD = 2.5;
const THREAT_ANIM_WINDOW = 0.6;

/** Tipos de CombatEvent que delatan una pelea en curso. */
const FIGHT_EVENT_TYPES = new Set(["attack_started", "attack_landed", "damage_received"]);

const DEFLECTION_ANGLES = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2,
  (3 * Math.PI) / 4, -(3 * Math.PI) / 4];

/** Velocidad angular máxima del facing serializado (rad/s). Sin acotar, un
 *  NPC atascado cuya deflexión aceptada alterna de signo cada tick emitía un
 *  forward saltando 90-135°/tick y el billboard fps parpadeaba entre frames
 *  de dirección a frecuencia de frame. */
const FORWARD_SLEW_RAD_S = Math.PI * 2;
/** Watchdog de atasco: la deflexión produce ciclos límite que el bloqueo
 *  total de stepTowards no detecta — vibración sin avance neto, o "paseo"
 *  de ida y vuelta a lo largo de un muro (el rodeo ±90° de un rumbo que
 *  rota se bloquea en ambos extremos). Cada STUCK_WINDOW_S se compara la
 *  posición con el ancla: avanzar menos de STUCK_DIST_M ⇒ rendirse igual
 *  que en el bloqueo total. A velocidad de paseo (≥1 m/s) un avance real
 *  recorre ≥3× la distancia umbral por ventana. */
const STUCK_WINDOW_S = 3.0;
const STUCK_DIST_M = 1.0;

/** PRESUPUESTO DE PLANES: cuántas rutas se buscan como mucho en un tick, en
 *  todo el sistema. Un plan cuesta de 1 a ~9 ms (tope de expansiones incluido,
 *  medido en la tanda BO); diez NPCs con meta nueva en el mismo tick serían
 *  90 ms en un frame. El que no tiene turno sigue ese tick con el steering
 *  directo y planifica en el siguiente. */
const PLANES_POR_TICK = 1;
/** Segundos antes de poder replanificar la MISMA meta tras un plan que salió
 *  bien (una caja nueva cortando el tramo, el objetivo que se movió) y tras uno
 *  que falló (sin camino, tope): el que falla vuelve a intentarlo, pero sin
 *  pagar un A* por segundo cada uno. */
const ESPERA_TRAS_PLAN_S = 1;
const ESPERA_TRAS_FALLO_S = 1;
/** Planes fallidos SEGUIDOS hacia la misma meta tras los que el NPC se da por
 *  vencido: el primero puede ser mala suerte (una caja a medio poner, el tope
 *  con el mundo a medio cargar); el segundo, un segundo después, es que no hay
 *  camino. Se PARA y deja la meta al motor (`SuspendedGoal` `no_path`). */
const PLANES_FALLIDOS_PARA_RENDIRSE = 2;
/** A cuánto de su META se da por llegado el que va a un LUGAR con ruta. No es
 *  `GOAL_REACHED`: la meta ya es un sitio libre junto al lugar, repartido entre
 *  los vecinos que van (`HOLGURA_ENTRE_METAS_M` cuenta con esta holgura), así
 *  que parar 1,5 m antes volvía a juntarlos. */
const LLEGADA_A_LA_META = WAYPOINT_REACHED;
/** Radio alrededor del destino en el que los demás NPC cuentan para repartir
 *  metas: los que esperan allí o van a llegar. */
const RADIO_DE_VECINOS_M = 16;
/** Cuánto se tiene que mover el destino crudo para que la ruta vieja no valga
 *  (visitar a alguien que anda; un lugar cuyo rect cambió). */
const REPLAN_DESTINO_M = 2;

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
  /** Última deflexión aceptada — se reintenta antes que las demás para que
   *  el rodeo de un obstáculo no alterne de signo entre ticks. */
  lastDeflection: number | null;
  /** Ancla del watchdog de atasco: posición + tiempo acumulado sin avance. */
  stuckAnchor: { x: number; z: number; t: number } | null;
  /** El tick anterior estaba saliendo de un sólido: el primero que ya no
   *  está dentro revisa si su `home` se quedó dentro (`salirSiEstaDentro`). */
  saliendo: boolean;
  /** Dónde lo dejó este sistema al acabar su último tick. Si al empezar el
   *  siguiente el record está en OTRO sitio, lo movió alguien de fuera
   *  (`adoptarSaltoAjeno`). */
  dondeLoDeje: { x: number; z: number };
  /** La ruta que sigue hacia su meta de `goto`/`visit`, o `null` (sin plan, o
   *  el plan falló y va con el steering directo). `i` es el punto al que va.
   *  NO se persiste: tras un resume, el NPC replanifica. */
  ruta: { meta: Punto; puntos: ReadonlyArray<Punto>; i: number; alBorde: boolean } | null;
  /** Para qué meta (`modo|directiveKey`) y hacia qué destino crudo se buscó
   *  la última ruta, saliera bien o no. */
  rutaClave: string;
  rutaDestino: Punto;
  /** Segundos hasta poder replanificar la misma meta. */
  rutaEspera: number;
  /** El watchdog ya le tiró una ruta sin que avanzara de punto: el siguiente
   *  salto es la rendición de siempre. */
  rutaRescatada: boolean;
  /** El último paso NO fue por el rumbo directo: algo cortaba el tramo. */
  desviado: boolean;
  /** Planes fallidos seguidos hacia la meta de `rutaClave`, y por qué falló
   *  el último (el `motivo` de la `Ruta`). */
  rutaFallos: number;
  rutaMotivo: string;
  /** Se quedó SIN CAMINO y dejó su meta al motor: la huella de su zona en
   *  ese momento, para reintentar solo si cambia. `null` si no. */
  sinCamino: { huella: string } | null;
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

/** Clave de la META en curso: directiva + override de tránsito. Un cambio en
 *  CUALQUIERA de los dos (incluida la retirada de in_transit) resetea waypoint/
 *  reachedGoal/mode, evitando reusar un waypoint de goto ya cancelado. */
function goalKeyOf(record: EntityRecord): string {
  return JSON.stringify({
    directive: record.data.directive ?? null,
    in_transit: record.data.in_transit ?? null,
  });
}

class AmbientNpcBehavior implements NpcBehaviorSystem {
  readonly id = "ambient";
  private npcs = new Map<string, NpcRuntime>();
  private rng: SeededRng;
  private world: NpcWorldAdapter;
  private warned = new Set<string>();
  /** Rutas buscadas en el tick en curso (ver `PLANES_POR_TICK`). */
  private planesEsteTick = 0;
  /** Los eventos del tick en curso, para quien los emite desde dentro del
   *  steering (la rendición sin camino). */
  private eventosDelTick: NpcBehaviorEvent[] = [];

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
      directiveKey: goalKeyOf(record),
      reachedGoal: null,
      lastDeflection: null,
      stuckAnchor: null,
      saliendo: false,
      dondeLoDeje: { x: record.position[0], z: record.position[2] },
      ruta: null,
      rutaClave: "",
      rutaDestino: { x: 0, z: 0 },
      rutaEspera: 0,
      rutaRescatada: false,
      desviado: false,
      rutaFallos: 0,
      rutaMotivo: "",
      sinCamino: null,
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
    this.planesEsteTick = 0;
    this.eventosDelTick = events;

    for (const rt of this.npcs.values()) {
      this.adoptarSaltoAjeno(rt);
      this.updateDanger(rt, hotspots, delta, events);
      rt.decideTimer -= delta;
      if (rt.decideTimer <= 0) {
        rt.decideTimer += DECIDE_INTERVAL;
        this.decide(rt, ctx, events);
      }
      this.move(rt, ctx, delta, events);
      this.moverStuckAt(rt);
      rt.dondeLoDeje = { x: rt.record.position[0], z: rt.record.position[2] };
    }
    return events;
  }

  /** SI OTRO LO MOVIÓ, SU CASA ES DONDE LO DEJARON. Este sistema no es el
   *  único que escribe `record.position`: `npc_arrive` lo teletransporta al
   *  lugar al que viajaba (`NpcDirector.arriveNpc`) y una escena que redeclara
   *  su id lo muda a ella (`npc-records.ts`). El re-sync de `addNpc` conserva
   *  el runtime, así que el `home` seguía siendo el del sitio de partida y el
   *  micro-wander le devolvía andando allí: medido, 58 m de vuelta en 60 s
   *  (#618). Tras el salto, su rutina es la del sitio al que llegó; el waypoint
   *  y el watchdog, que eran del sitio viejo, se tiran. */
  private adoptarSaltoAjeno(rt: NpcRuntime): void {
    const x = rt.record.position[0];
    const z = rt.record.position[2];
    if (distXZ(x, z, rt.dondeLoDeje.x, rt.dondeLoDeje.z) < 1e-6) return;
    rt.home = { x, z };
    rt.waypoint = null;
    rt.ruta = null;
    rt.stuckAnchor = null;
    rt.lastDeflection = null;
    rt.dondeLoDeje = { x, z };
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
        const suspended = this.suspenderMeta(rt, nearest);
        rt.mode = "flee";
        rt.waypoint = null;
        rt.anim = undefined;
        events.push({
          type: "npc_fled_combat",
          npcId: rt.record.id,
          fightAt: { x: nearest.x, z: nearest.z },
          ...(suspended ? { suspended } : {}),
        });
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
      if (rt.dangerTimer >= COMBAT_CLEAR_SECONDS && !this.huidaEnCurso(rt)) {
        rt.danger = null;
        rt.anim = undefined;
        if (rt.mode === "flee" || rt.mode === "intervene") {
          // El que huyó se queda DONDE PARÓ (#298, decisión del usuario): con
          // el `home` viejo el micro-wander le devolvía junto a la pelea y
          // volvía a huir. El guardia no: vuelve a su puesto.
          if (rt.mode === "flee") rt.home = { x: px, z: pz };
          rt.mode = "idle";
          rt.pauseTimer = this.pausaTras(rt, 0.5 + this.rng.next() * 1.5);
          rt.waypoint = null;
          events.push({ type: "npc_resumed", npcId: rt.record.id });
        }
      }
    }
  }

  /** ¿SIGUE CORRIENDO HACIA SU META DE HUIDA? Entonces la huida no se cierra
   *  aunque lleve `COMBAT_CLEAR_SECONDS` sin ver la pelea. Se cerraba a los 4 s
   *  de salir de la percepción, o sea a `percepción + 4 s × run_speed`: con un
   *  radio de paseo grande (`wander.radius` 15) eso quedaba antes de
   *  `distanciaDeHuida`, su paseo volvía a alcanzar la pelea y re-huía (QA de
   *  BL, H3). Con esto la cota de `distanciaDeHuida` se cumple para CUALQUIER
   *  radio… mientras pueda correr: el que no avanza (cercado) no huye para
   *  siempre, porque la espera se acota al tiempo de correr la meta entera
   *  desde la pelea, que en campo abierto siempre basta. */
  private huidaEnCurso(rt: NpcRuntime): boolean {
    if (rt.mode !== "flee" || !rt.danger) return false;
    const meta = distanciaDeHuida(rt.params, radioDePaseo(readDirective(rt), rt.params));
    const d = distXZ(rt.record.position[0], rt.record.position[2], rt.danger.x, rt.danger.z);
    if (d >= meta) return false;
    return rt.dangerTimer < COMBAT_CLEAR_SECONDS + meta / rt.params.run_speed;
  }

  /** Retira del record la meta que el NPC estaba EJECUTANDO con el cuerpo y
   *  la deja en `data.suspended_goal` (ver `SuspendedGoal`). Solo la que le
   *  llevaría de vuelta: un `in_transit` o un `goto_place` fuera de alcance
   *  son narrative-paced (el cuerpo no los anda) y un objetivo ya alcanzado no
   *  le mueve. `hold`, `wander` y `patrol` se quedan: son rutina alrededor de
   *  su `home`, y el `home` ya se queda donde para. */
  private suspenderMeta(rt: NpcRuntime, pelea: { x: number; z: number }): SuspendedGoal | null {
    const data = rt.record.data;
    const fight_at: [number, number] = [pelea.x, pelea.z];
    const transitTo = readTransitTo(rt);
    if (transitTo) {
      if (!this.alAlcance(rt, transitTo)) return null;
      const s: SuspendedGoal = { field: "in_transit", value: data.in_transit, reason: "fled_combat", fight_at };
      data.in_transit = null;
      data.suspended_goal = s;
      return s;
    }
    const d = readDirective(rt);
    const va = d?.type === "goto_place" && typeof d.target_place_id === "string" &&
        rt.reachedGoal !== `place:${d.target_place_id}` && this.alAlcance(rt, d.target_place_id)
      || d?.type === "visit_npc" && typeof d.target_npc_id === "string" &&
        rt.reachedGoal !== `npc:${d.target_npc_id}`;
    if (!va) return null;
    const s: SuspendedGoal = { field: "directive", value: data.directive, reason: "fled_combat", fight_at };
    data.directive = null;
    data.suspended_goal = s;
    return s;
  }

  /** La misma regla que `deriveGoto`: el lugar resuelve y está a ≤ `MAX_GOTO_DIST`. */
  private alAlcance(rt: NpcRuntime, placeId: string): boolean {
    const t = this.world.resolvePlaceTarget(placeId);
    return !!t && distXZ(rt.record.position[0], rt.record.position[2], t.x, t.z) <= MAX_GOTO_DIST;
  }

  /** Decisión de baja frecuencia: re-deriva el modo desde la directiva y la
   *  proximidad del jugador. flee/intervene se gestionan en updateDanger. */
  private decide(rt: NpcRuntime, ctx: NpcTickContext, events: NpcBehaviorEvent[]): void {
    if (rt.mode === "flee" || rt.mode === "intervene") return;

    // Cambio de rol en runtime (el LLM puede reescribir data.role).
    if (typeof rt.record.data.role === "string" && rt.record.data.role !== rt.params.role) {
      rt.params = resolveRoleParams(rt.record.data);
    }

    // Cambio de META en curso → resetear. La meta la fijan DOS campos: la
    // directiva (data.directive) Y el override de tránsito (data.in_transit,
    // npc_move_to_place). Serializar solo la directiva dejaba un waypoint de
    // goto (hasta MAX_GOTO_DIST=128 m) VIVO cuando el bridge retiraba in_transit
    // sin tocar la directiva: el NPC seguía caminando al destino ya cancelado en
    // vez de micro-wander. La clave cubre ambos → añadir/retirar in_transit
    // resetea la meta igual que cambiar la directiva.
    this.reintentarSiCambioElMundo(rt, events);
    const goalKey = goalKeyOf(rt.record);
    if (goalKey !== rt.directiveKey) {
      rt.directiveKey = goalKey;
      rt.waypoint = null;
      this.olvidarRuta(rt);
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
        rt.pauseTimer = this.pausaTras(rt, 0.3 + this.rng.next());
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
          `directiva desconocida "${directive.type}" para "${rt.record.id}" — micro-wander (vocabulario: ${NPC_DIRECTIVE_TYPES.join(", ")})`,
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
    if (distXZ(px, pz, target.x, target.z) <= GOAL_REACHED + NPC_RADIUS_M) {
      if (rt.reachedGoal !== `npc:${targetId}`) {
        rt.reachedGoal = `npc:${targetId}`;
        events.push({ type: "npc_reached_npc", npcId: rt.record.id, targetId });
      }
      rt.mode = "idle";
      rt.pauseTimer = Infinity; // quedarse de visita hasta nueva directiva
      // Giro one-shot (en idle no se re-encara): sin slew.
      rt.forward = this.faceTowards(rt, target.x, target.z, Number.POSITIVE_INFINITY);
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

    if (this.salirSiEstaDentro(rt, delta)) return;

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
        rt.forward = this.faceTowards(rt, ctx.playerPos.x, ctx.playerPos.z, delta);
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
        const arrived = this.andarLaRuta(rt, rt.waypoint, delta);
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
        if (dist >= distanciaDeHuida(rt.params, radioDePaseo(readDirective(rt), rt.params))) {
          // A salvo: parar y mirar hacia la pelea desde lejos.
          rt.forward = this.faceTowards(rt, rt.danger.x, rt.danger.z, delta);
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
        rt.forward = this.faceTowards(rt, rt.danger.x, rt.danger.z, delta);
        rt.threatTimer += delta;
        if (rt.threatTimer >= THREAT_PERIOD) rt.threatTimer -= THREAT_PERIOD;
        rt.anim = rt.threatTimer < THREAT_ANIM_WINDOW ? "quick" : undefined;
        return;
      }
    }
  }

  /** HACIA LA META DE `goto`/`visit` POR SU RUTA (#618). Devuelve `true` al
   *  llegar a la META DE LA RUTA —el sitio libre junto al destino, no su centro
   *  ocupado— o, sin ruta, al destino crudo como siempre.
   *
   *  Cuándo se busca ruta: meta nueva (otra `clave`); y, pasada la espera, sin
   *  ruta (el plan anterior falló o el watchdog la tiró), o con el destino
   *  movido más de `REPLAN_DESTINO_M`, o con el tramo cortado (el paso directo
   *  hacia el punto en curso no pasó: una caja nueva). Siempre dentro del
   *  presupuesto de `PLANES_POR_TICK`. */
  private andarLaRuta(rt: NpcRuntime, destino: Punto, delta: number): boolean {
    rt.rutaEspera -= delta;
    const clave = `${rt.mode}|${rt.directiveKey}`;
    if (this.tocaPlanificar(rt, destino, clave)) this.planificar(rt, destino, clave);
    if (!rt.sinCamino && rt.rutaFallos >= PLANES_FALLIDOS_PARA_RENDIRSE) {
      this.rendirseSinCamino(rt, rt.rutaMotivo);
      return false;
    }
    const ruta = rt.ruta;
    const speed = rt.params.walk_speed;
    // Sin ruta y con un plan fallido encima: QUIETO hasta el reintento. El
    // abanico hacia el destino crudo era el síntoma de partida —andar en el
    // sitio contra la pared— (QA de BO, H3). Sin ruta y sin plan todavía (no
    // le tocó presupuesto este tick), el paso directo de siempre.
    if (!ruta) return rt.rutaFallos > 0 ? false : this.stepTowards(rt, destino.x, destino.z, speed, delta, GOAL_REACHED);
    const ultimo = ruta.puntos.length - 1;
    const px = rt.record.position[0];
    const pz = rt.record.position[2];
    while (ruta.i < ultimo && distXZ(px, pz, ruta.puntos[ruta.i].x, ruta.puntos[ruta.i].z) <= WAYPOINT_REACHED) {
      ruta.i++;
      rt.rutaRescatada = false;
    }
    const p = ruta.puntos[ruta.i];
    rt.desviado = false;
    const alFinal = rt.mode === "goto" ? LLEGADA_A_LA_META : GOAL_REACHED;
    const llegado = this.stepTowards(rt, p.x, p.z, speed, delta, ruta.i === ultimo ? alFinal : WAYPOINT_REACHED);
    // Tramo cortado: se suelta la ruta y el tick siguiente busca otra.
    if (rt.desviado && rt.ruta === ruta && rt.rutaEspera <= 0) rt.ruta = null;
    if (!llegado || ruta.i !== ultimo) return false;
    // Al BORDE del mundo generado no se ha llegado al lugar: se queda ahí y
    // se lo dice al motor (QA de BO, H2).
    if (ruta.alBorde) {
      this.rendirseSinCamino(rt, "zona-sin-generar");
      return false;
    }
    return true;
  }

  private tocaPlanificar(rt: NpcRuntime, destino: Punto, clave: string): boolean {
    if (this.planesEsteTick >= PLANES_POR_TICK || rt.sinCamino) return false;
    if (clave !== rt.rutaClave) return true;
    if (rt.rutaEspera > 0) return false;
    return !rt.ruta || distXZ(destino.x, destino.z, rt.rutaDestino.x, rt.rutaDestino.z) > REPLAN_DESTINO_M;
  }

  private planificar(rt: NpcRuntime, destino: Punto, clave: string): void {
    this.planesEsteTick++;
    if (clave !== rt.rutaClave) {
      rt.rutaRescatada = false;
      rt.rutaFallos = 0;
    }
    rt.rutaClave = clave;
    rt.rutaDestino = { x: destino.x, z: destino.z };
    const desde = { x: rt.record.position[0], z: rt.record.position[2] };
    const ruta = this.world.buscarRuta(desde, destino, NPC_RADIUS_M, this.vecinosEn(rt, destino));
    if (ruta.ok) {
      rt.ruta = { meta: ruta.meta, puntos: ruta.puntos, i: 0, alBorde: ruta.alBorde };
      rt.rutaEspera = ESPERA_TRAS_PLAN_S;
      rt.rutaFallos = 0;
      return;
    }
    rt.ruta = null;
    rt.rutaEspera = ESPERA_TRAS_FALLO_S;
    rt.rutaFallos++;
    rt.rutaMotivo = ruta.motivo;
    this.warnOnce(
      `${rt.record.id}:ruta:${ruta.motivo}`,
      `"${rt.record.id}" no encuentra ruta hacia (${destino.x.toFixed(1)}, ${destino.z.toFixed(1)}): ` +
        `${ruta.motivo} (${ruta.expansiones} expansiones) — se para y lo reintenta`,
    );
  }

  /** Dónde esperan o van a esperar los demás junto a `destino`: la meta de
   *  quien lleva ruta y el sitio de quien está quieto. Es lo que reparte la
   *  fachada entre vecinos (QA de BO, H1). El NPC al que se va de visita no
   *  cuenta: a él es a quien se va. */
  private vecinosEn(rt: NpcRuntime, destino: Punto): Punto[] {
    const visitado = readDirective(rt)?.target_npc_id;
    const out: Punto[] = [];
    for (const otro of this.npcs.values()) {
      if (otro === rt || otro.record.id === visitado) continue;
      const p = otro.ruta ? otro.ruta.meta : otro.moving ? null : { x: otro.record.position[0], z: otro.record.position[2] };
      if (p && distXZ(p.x, p.z, destino.x, destino.z) <= RADIO_DE_VECINOS_M) out.push(p);
    }
    return out;
  }

  /** H4 de la QA de BO: la ruta es de UNA meta. Si cambia —otra directiva, la
   *  misma devuelta tras huir—, se busca otra desde donde esté. */
  private olvidarRuta(rt: NpcRuntime): void {
    rt.ruta = null;
    rt.rutaClave = "";
    rt.rutaFallos = 0;
    rt.rutaRescatada = false;
  }

  /** SIN CAMINO: se PARA y deja la meta al motor (QA de BO, H3; decisión del
   *  usuario: «que el estado le llegue al motor de narrativa y él decide»). El
   *  mismo mecanismo que la huida (`SuspendedGoal`), con `reason: "no_path"`:
   *  la meta sale del record, queda en `data.suspended_goal` y viaja en el
   *  contexto del motor. El NPC se queda quieto (`hold` implícito) y solo lo
   *  reintenta solo si cambia el mundo de su zona (`reintentarSiCambioElMundo`)
   *  o si el motor le da otra meta. */
  private rendirseSinCamino(rt: NpcRuntime, why: string): void {
    const data = rt.record.data;
    const x = rt.record.position[0];
    const z = rt.record.position[2];
    const field = readTransitTo(rt) ? "in_transit" : "directive";
    const s: SuspendedGoal = { field, value: data[field], reason: "no_path", stuck_at: [x, z], why };
    data[field] = null;
    data.suspended_goal = s;
    rt.directiveKey = goalKeyOf(rt.record);
    rt.sinCamino = { huella: this.world.huellaDeLaZona(x, z) };
    this.olvidarRuta(rt);
    rt.waypoint = null;
    rt.stuckAnchor = null;
    rt.lastDeflection = null;
    rt.mode = "idle";
    rt.pauseTimer = Infinity;
    rt.moving = false;
    this.warnOnce(`${rt.record.id}:sin-camino:${why}`,
      `"${rt.record.id}" no tiene camino (${why}): se queda parado y deja su meta al motor (suspended_goal no_path)`);
    this.eventosDelTick.push({ type: "npc_no_path", npcId: rt.record.id, suspended: s });
  }

  /** LA PAUSA AL VOLVER DE UNA INTERRUPCIÓN (encarar al jugador, huir): la de
   *  siempre, salvo para el que se quedó SIN CAMINO, que vuelve a su estado
   *  quieto. Con la corta pasaba a `wander` al irse el jugador —el 37 % del
   *  tiempo andando, 4,1 m, en la sonda de la QA de BO (H8)— y el `stuck_at`
   *  que ve el motor dejaba de ser verdad. */
  private pausaTras(rt: NpcRuntime, pausa: number): number {
    return rt.sinCamino ? Infinity : pausa;
  }

  /** Si el que está SIN CAMINO se movió de todos modos (lo sacan de un
   *  sólido, huye, lo teletransportan), su `stuck_at` dice dónde está AHORA:
   *  es lo que lee el motor para decidir (QA de BO, H8). */
  private moverStuckAt(rt: NpcRuntime): void {
    if (!rt.sinCamino) return;
    const s = rt.record.data.suspended_goal as SuspendedGoal | null | undefined;
    if (s?.reason !== "no_path") return;
    const x = rt.record.position[0];
    const z = rt.record.position[2];
    if (s.stuck_at[0] !== x || s.stuck_at[1] !== z) s.stuck_at = [x, z];
  }

  /** El que se quedó sin camino vuelve a su meta SOLO si el mundo de su zona
   *  cambió desde entonces (se generó un tile, el motor puso o quitó algo). Si
   *  el motor ya decidió —otra directiva, o la misma re-emitida—, la meta
   *  suspendida ya no está y no hay nada que reintentar. */
  private reintentarSiCambioElMundo(rt: NpcRuntime, events: NpcBehaviorEvent[]): void {
    if (!rt.sinCamino) return;
    const s = rt.record.data.suspended_goal as SuspendedGoal | null | undefined;
    if (!s || s.reason !== "no_path") {
      rt.sinCamino = null;
      return;
    }
    if (this.world.huellaDeLaZona(rt.record.position[0], rt.record.position[2]) === rt.sinCamino.huella) return;
    rt.record.data[s.field] = s.value;
    delete rt.record.data.suspended_goal;
    rt.sinCamino = null;
    events.push({ type: "npc_path_reopened", npcId: rt.record.id, suspended: s });
  }

  /** Avanza hacia (tx,tz) con evitación por deflexión. Devuelve true si el
   *  destino quedó a menos de `reachedDist`.
   *
   *  QUIÉN MANDA en «por dónde voy», porque hay dos respuestas y dentro de un
   *  mes parecería arbitrario: **la ruta decide; el abanico es el seguidor
   *  local.** Para `goto`/`visit`, `andarLaRuta` llama aquí con el SIGUIENTE
   *  PUNTO de la ruta del A*, no con la meta, y el abanico solo corrige lo que
   *  la ruta no ve (el tramo hasta su celda, una caja recién puesta). El
   *  ESCAPE por caja de `rumboDePaso` solo existe cuando no hay ruta —el plan
   *  falló: un cercado de verdad— y el abanico se agotó. `wander`, `flee` e
   *  `intervene` van sin ruta: puntos cercanos o que se mueven cada tick. */
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
    if (dist <= reachedDist) {
      rt.stuckAnchor = null;
      return true;
    }

    // Watchdog de atasco: al expirar cada ventana, rendirse si no hubo
    // avance neto desde el ancla (el ancla NO se re-ancla antes: un paseo de
    // ida y vuelta junto a un muro debe contar como atasco).
    const anchor = rt.stuckAnchor;
    if (!anchor) {
      rt.stuckAnchor = { x: px, z: pz, t: 0 };
    } else {
      anchor.t += delta;
      if (anchor.t >= STUCK_WINDOW_S) {
        if (distXZ(px, pz, anchor.x, anchor.z) < STUCK_DIST_M) {
          this.giveUpMove(rt);
          return false;
        }
        anchor.x = px;
        anchor.z = pz;
        anchor.t = 0;
      }
    }

    const dir = { x: (tx - px) / dist, z: (tz - pz) / dist };
    const paso = this.darPaso(rt, dir, Math.min(speed * delta, dist), delta);
    if (paso) return distXZ(paso.nx, paso.nz, tx, tz) <= reachedDist;
    // Bloqueado en todas las direcciones: soltar el waypoint y pausar la
    // rutina. flee/intervene conservan su modo (updateDanger los gestiona).
    this.giveUpMove(rt);
    return false;
  }

  /** UN PASO de `step` metros por el rumbo `dir` o, si no pasa, por la mejor
   *  deflexión. Mueve al NPC y devuelve dónde quedó, o `null` si no pasa por
   *  ninguno. Lo comparten el que va a su meta (`stepTowards`) y el que sale de
   *  un sólido (`salirSiEstaDentro`), para que los dos respeten la misma regla
   *  —terreno primero, escape declarado— sin copiarla.
   *
   *  Orden: directa primero (que el rodeo no se eternice en espiral), luego la
   *  última deflexión aceptada (pegajosa: sin ella el rodeo alterna de signo
   *  entre ticks y el NPC vibra sin avanzar), luego el resto. */
  private darPaso(
    rt: NpcRuntime,
    dir: { x: number; z: number },
    step: number,
    delta: number,
  ): { nx: number; nz: number } | null {
    const last = rt.lastDeflection;
    const angles = last !== null && last !== 0
      ? [0, last, ...DEFLECTION_ANGLES.filter((a) => a !== 0 && a !== last)]
      : DEFLECTION_ANGLES;
    const rumbo = this.rumboDePaso(rt, angles, dir, rt.record.position[0], rt.record.position[2], step);
    if (!rumbo) return null;
    rt.record.position[0] = rumbo.nx;
    rt.record.position[2] = rumbo.nz;
    rt.lastDeflection = rumbo.angle;
    rt.desviado = rumbo.angle !== 0;
    rt.forward = this.slewForward(rt, rumbo.d.x, rumbo.d.z, delta);
    rt.moving = true;
    return rumbo;
  }

  /** PRIMERO SALIR, LUEGO LO QUE SEA. Si el NPC está metido en algo sólido
   *  —una caja de runtime que le cayó encima, o desde #616 la geometría del
   *  TILE—, este tick no hace lo que diga su modo: da un paso por la cara más
   *  cercana. Devuelve `true` si lo dio (o lo intentó), y entonces el modo no
   *  corre.
   *
   *  VIVE EN LA CABEZA DE `move()` Y NO EN UN MODO, y ese es todo el arreglo
   *  (#618, pieza B). Hasta aquí estaba dentro de `stepTowards`, así que solo
   *  salía el que ya andaba: el quieto en `idle`, el que tiene `hold`, el que
   *  encara al jugador en `react` y el que ya llegó a su meta se quedaban
   *  dentro para siempre. Y el que paseaba tampoco, en cuanto la caja era más
   *  ancha que su paseo: los ocho waypoints que sortea caían dentro de ella y
   *  volvía a `idle` sin llegar a pisar `stepTowards` (0,00 m en 120 s). La
   *  regla es del CUERPO, no del modo, y un modo que alguien añada mañana nace
   *  con ella. Es también el «salir antes de planificar» que un A* necesita:
   *  ninguna búsqueda arranca desde una celda sólida.
   *
   *  Y AL SALIR, SU `home`: si se quedó dentro del sólido, pasa a ser donde
   *  salió. Sin eso sale y no vuelve a moverse nunca, porque su paseo sortea
   *  alrededor de un `home` enterrado. Solo en ese caso: donde el `home` está
   *  libre, el que salió vuelve a su rutina de siempre.
   *
   *  Velocidad: la de correr en `flee`/`intervene`, la de andar en el resto,
   *  que es la que le daba cada modo cuando la salida vivía en `stepTowards`. */
  private salirSiEstaDentro(rt: NpcRuntime, delta: number): boolean {
    const px = rt.record.position[0];
    const pz = rt.record.position[2];
    const salida = this.world.porDondeSalirDeAqui(px, pz, NPC_RADIUS_M);
    if (!salida) {
      if (rt.saliendo) {
        rt.saliendo = false;
        if (this.world.blocksCircle(rt.home.x, rt.home.z, NPC_RADIUS_M)) rt.home = { x: px, z: pz };
      }
      return false;
    }
    const dentroDe = salida.de === "caja" ? `"${salida.id}" (se la pusieron encima)` : "la geometría del tile";
    this.warnOnce(
      `${rt.record.id}:sale:${salida.de === "caja" ? salida.id : "tile"}`,
      `"${rt.record.id}" quedó DENTRO de ${dentroDe} ` +
        `y sale andando por su cara más cercana antes de seguir a lo suyo`,
    );
    rt.saliendo = true;
    // El watchdog no compara contra una ventana de antes de salir.
    rt.stuckAnchor = null;
    const corre = rt.mode === "flee" || rt.mode === "intervene";
    const speed = corre ? rt.params.run_speed : rt.params.walk_speed;
    this.darPaso(rt, salida.dir, speed * delta, delta);
    rt.running = corre && rt.moving;
    return true;
  }

  /** POR DÓNDE PASA, o `null` si no pasa por ningún rumbo.
   *
   *  DOS CRITERIOS, y el segundo es el escape del encajonado (#583). Primero
   *  gana cualquier rumbo LIBRE, en el orden de siempre. Si no hay ninguno
   *  —las siete deflexiones agotadas, que es lo que aquí significa «no puede
   *  rodear»— se acepta el primero que solo tropezaba con una CAJA DE RUNTIME
   *  y el NPC la atraviesa: dos cosas que el motor pone en el mismo turno
   *  dejan 1,0 m entre caras y el cuerpo del NPC pide 1,5 (#289,
   *  `reparto-de-spawns.ts`), así que el cercado no es hipotético y un NPC
   *  congelado para siempre es peor que uno que cruza un carro.
   *
   *  LO QUE NO ABRE EL ESCAPE: la geometría del tile (muros, agua, huellas del
   *  plan) no se atraviesa nunca, y por eso el impedimento viene con su clase
   *  en vez de un booleano. Tampoco lo abre el WATCHDOG de atasco: ese salta
   *  habiendo movimientos legales —ciclos límite, el paseo de ida y vuelta
   *  junto a un muro—, y atravesar pudiendo rodear es exactamente el defecto
   *  que #583 arregla, del revés.
   *
   *  Y EL QUE YA ESTÁ DENTRO tampoco pasa por aquí, pero no porque «salga
   *  solo»: aquí se leía que la penetración no creciente (#601) bastaba, y era
   *  cierto de la CONSULTA y falso del SISTEMA —el que no empuja no sale, y
   *  este abanico solo empuja hacia la meta: 290 s de 300 dentro de un carro
   *  (#583, QA H-2)—. A ese le saca `salirSiEstaDentro`, en la cabeza de
   *  `move()`, que le da el rumbo de la cara más cercana sea cual sea su modo.
   *
   *  Se atraviesa DICIÉNDOLO. Un NPC cruzando una caja es el síntoma exacto de
   *  #583, así que si no queda dicho por qué pasó, el arreglo se lee como el
   *  defecto. */
  private rumboDePaso(
    rt: NpcRuntime,
    angles: readonly number[],
    dir: { x: number; z: number },
    px: number,
    pz: number,
    step: number,
  ): { angle: number; d: { x: number; z: number }; nx: number; nz: number } | null {
    let escape: { angle: number; d: { x: number; z: number }; nx: number; nz: number } | null = null;
    let cajaDelEscape = "";
    for (const angle of angles) {
      const d = angle === 0 ? dir : rotate(dir, angle);
      const nx = px + d.x * step;
      const nz = pz + d.z * step;
      const impedimento = this.world.queImpideElPaso(px, pz, nx, nz, NPC_RADIUS_M);
      if (impedimento === null) return { angle, d, nx, nz };
      // El primero que solo tropieza con una caja queda de suplente: si
      // ninguno sale libre, es por donde se escapa. Recorrer una vez y
      // recordarlo da el mismo rumbo que dos pasadas y la mitad de consultas.
      if (impedimento.de === "caja" && escape === null) {
        escape = { angle, d, nx, nz };
        cajaDelEscape = impedimento.id;
      }
    }
    if (escape) {
      this.warnOnce(
        `${rt.record.id}:atraviesa:${cajaDelEscape}`,
        `"${rt.record.id}" no tiene por dónde rodear "${cajaDelEscape}" (las siete ` +
          `deflexiones bloqueadas) y la ATRAVIESA`,
      );
      return escape;
    }
    return null;
  }

  /** Rendición del steering (bloqueo total o watchdog): soltar waypoint y
   *  pausar la rutina; flee/intervene conservan su modo. */
  private giveUpMove(rt: NpcRuntime): void {
    // Con ruta, el primer atasco no rinde: la ruta caducó (algo apareció en
    // ella) y se busca otra. Solo el segundo sin haber avanzado de punto es la
    // rendición de siempre.
    if ((rt.mode === "goto" || rt.mode === "visit") && rt.ruta && !rt.rutaRescatada) {
      rt.ruta = null;
      rt.rutaRescatada = true;
      rt.rutaEspera = 0;
      rt.stuckAnchor = null;
      rt.lastDeflection = null;
      return;
    }
    // Con ruta y ya rescatada: la ruta no le lleva a ninguna parte. Andar en el
    // sitio hasta el siguiente plan era el síntoma de partida (QA de BO, H3).
    if ((rt.mode === "goto" || rt.mode === "visit") && rt.ruta) {
      this.rendirseSinCamino(rt, "atasco");
      return;
    }
    rt.ruta = null;
    rt.rutaRescatada = false;
    rt.waypoint = null;
    rt.stuckAnchor = null;
    rt.lastDeflection = null;
    if (rt.mode === "wander" || rt.mode === "goto" || rt.mode === "visit") {
      rt.mode = "idle";
      rt.pauseTimer = 1 + this.rng.next() * 2;
    }
  }

  /** Gira rt.forward hacia (dirX,dirZ) acotado a FORWARD_SLEW_RAD_S. */
  private slewForward(rt: NpcRuntime, dirX: number, dirZ: number, delta: number): Vec3 {
    const cur = Math.atan2(rt.forward.x, rt.forward.z);
    const tgt = Math.atan2(dirX, dirZ);
    let diff = tgt - cur;
    if (diff > Math.PI) diff -= Math.PI * 2;
    else if (diff < -Math.PI) diff += Math.PI * 2;
    const maxStep = FORWARD_SLEW_RAD_S * delta;
    if (Math.abs(diff) <= maxStep) return { x: dirX, y: 0, z: dirZ };
    const yaw = cur + Math.sign(diff) * maxStep;
    return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  }

  private pickWanderWaypoint(rt: NpcRuntime): { x: number; z: number } | null {
    const radius = radioDePaseo(readDirective(rt), rt.params);
    for (let i = 0; i < 8; i++) {
      const angle = this.rng.next() * Math.PI * 2;
      const r = Math.min(1, radius) + this.rng.next() * Math.max(0, radius - 1);
      const x = rt.home.x + Math.cos(angle) * r;
      const z = rt.home.z + Math.sin(angle) * r;
      if (!this.world.blocksCircle(x, z, NPC_RADIUS_M)) return { x, z };
    }
    return null;
  }

  private faceTowards(rt: NpcRuntime, tx: number, tz: number, delta: number): Vec3 {
    const px = rt.record.position[0];
    const pz = rt.record.position[2];
    const d = distXZ(px, pz, tx, tz);
    if (d < 1e-6) return rt.forward;
    return this.slewForward(rt, (tx - px) / d, (tz - pz) / d, delta);
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
