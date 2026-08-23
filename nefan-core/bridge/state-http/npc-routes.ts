/** Movimiento de alto nivel de los NPCs por el mapa (NpcDirector): el motor
 *  narrativo los manda de viaje, declara su llegada y les fija directivas. */
import {
  NpcDirectiveRequestSchema,
  NpcMoveToPlaceRequestSchema,
} from "../../src/contracts/request-schemas.js";
import type { ResponseOf } from "../../src/contracts/http.js";
import type { NpcsInTransitResponse, WorldStateApi } from "../../src/contracts/world-state.js";
import { bad, mutated, notFound, ok, parseBody } from "./context.js";
import type { RouteGroup } from "./routes.js";

export const npcRoutes = {
  npcsInTransit: (ctx) =>
    ok({ npcs: ctx.npcDirector.getNpcsInTransit() } satisfies NpcsInTransitResponse),

  getNpc: (ctx, { params }) => {
    const info = ctx.npcDirector.getNpcPlace(params.id);
    if (!info) return notFound(`npc "${params.id}" not found`);
    return ok(info satisfies ResponseOf<typeof WorldStateApi.getNpc>);
  },

  moveNpcToPlace: (ctx, { params, body }) => {
    const parsed = parseBody(NpcMoveToPlaceRequestSchema, body);
    if (!parsed.ok) return parsed.result;
    const result = ctx.npcDirector.moveNpcToPlace(params.id, parsed.data.place_id);
    if (!result.ok) return bad(result.error ?? "move failed");
    return mutated(result satisfies ResponseOf<typeof WorldStateApi.moveNpcToPlace>);
  },

  arriveNpc: (ctx, { params }) => {
    const result = ctx.npcDirector.arriveNpc(params.id);
    if (!result.ok) return bad(result.error ?? "arrive failed");
    return mutated(result satisfies ResponseOf<typeof WorldStateApi.arriveNpc>);
  },

  setNpcDirective: (ctx, { params, body }) => {
    const parsed = parseBody(NpcDirectiveRequestSchema, body);
    if (!parsed.ok) return parsed.result;
    const result = ctx.npcDirector.setDirective(params.id, parsed.data.directive);
    if (!result.ok) return bad(result.error ?? "set directive failed");
    return mutated(result satisfies ResponseOf<typeof WorldStateApi.setNpcDirective>);
  },
} satisfies RouteGroup;
