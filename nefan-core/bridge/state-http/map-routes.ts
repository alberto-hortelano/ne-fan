/** Mapa multinivel: lugares, enlaces y triggers (tools MCP map_*). */
import { LinkSpecSchema, MapTriggerRequestSchema, PlaceUpsertSchema } from "../../src/contracts/request-schemas.js";
import type { ResponseOf } from "../../src/contracts/http.js";
import type { WorldStateApi } from "../../src/contracts/world-state.js";
import type {
  MapLinkResponse,
  MapTriggerResponse,
  PlaceDetailResponse,
  PlaceUpsertResponse,
} from "../../src/contracts/world-state.js";
import { bad, mutated, notFound, ok, parseBody } from "./context.js";
import type { RouteGroup } from "./routes.js";

export const mapRoutes = {
  getMap: (ctx) => ok(ctx.narrative.worldMap.serialize() satisfies ResponseOf<typeof WorldStateApi.getMap>),

  getPlace: (ctx, { params }) => {
    const wm = ctx.narrative.worldMap;
    const place = wm.get(params.id);
    if (!place) return notFound(`place "${params.id}" not found`);
    return ok({
      place,
      children: wm.getChildren(place.id),
      ancestors: wm.getAncestors(place.id).slice(1), // drop self
      outgoing_links: wm.getOutgoingLinks(place.id),
      npcs: ctx.npcDirector.getNpcsAtPlace(place.id),
    } satisfies PlaceDetailResponse);
  },

  upsertPlace: (ctx, { body }) => {
    const parsed = parseBody(PlaceUpsertSchema, body);
    if (!parsed.ok) return parsed.result;
    try {
      const place = ctx.narrative.worldMap.upsertPlace(parsed.data);
      return mutated({ ok: true, place } satisfies PlaceUpsertResponse);
    } catch (err) {
      return bad((err as Error).message);
    }
  },

  addLink: (ctx, { body }) => {
    const parsed = parseBody(LinkSpecSchema, body);
    if (!parsed.ok) return parsed.result;
    try {
      const link = ctx.narrative.worldMap.addLink(parsed.data);
      return mutated({ ok: true, link } satisfies MapLinkResponse);
    } catch (err) {
      return bad((err as Error).message);
    }
  },

  addTrigger: (ctx, { body }) => {
    const parsed = parseBody(MapTriggerRequestSchema, body);
    if (!parsed.ok) return parsed.result;
    const { place_id: placeId, trigger } = parsed.data;
    try {
      ctx.narrative.worldMap.addTrigger(placeId, trigger);
      return mutated({ ok: true, place_id: placeId, trigger_id: trigger.id } satisfies MapTriggerResponse);
    } catch (err) {
      return bad((err as Error).message);
    }
  },
} satisfies RouteGroup;
