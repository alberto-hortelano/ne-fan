/** Entidades del mundo y su inventario (tools MCP entity_*, inventory_*). */
import {
  InventoryAddRequestSchema,
  InventoryRemoveRequestSchema,
} from "../../src/contracts/request-schemas.js";
import type { ResponseOf } from "../../src/contracts/http.js";
import type { WorldStateApi } from "../../src/contracts/world-state.js";
import type {
  EntityListResponse,
  InventoryGetResponse,
  InventoryMutationResponse,
  PlayerEntityResponse,
} from "../../src/contracts/world-state.js";
import { mutated, notFound, ok, parseBody } from "./context.js";
import type { RouteGroup } from "./routes.js";

export const entityRoutes = {
  listEntities: (ctx) =>
    ok({
      entities: ctx.narrative.entities.map((e) => ({
        id: e.id,
        type: e.type,
        name: typeof e.data.name === "string" ? e.data.name : undefined,
        scene_id: e.scene_id,
        position: e.position,
        spawn_reason: e.spawn_reason,
      })),
    } satisfies EntityListResponse),

  getEntity: (ctx, { params }) => {
    // El jugador no es una EntityRecord: viaja con su propio shape.
    if (params.id === "player") {
      return ok({ id: "player", type: "player", player: ctx.narrative.player } satisfies PlayerEntityResponse);
    }
    const entity = ctx.narrative.getEntity(params.id);
    if (!entity) return notFound(`entity "${params.id}" not found`);
    return ok(entity satisfies ResponseOf<typeof WorldStateApi.getEntity>);
  },

  getInventory: (ctx, { params }) =>
    ok({
      entity_id: params.id,
      inventory: ctx.narrative.getInventory(params.id),
    } satisfies InventoryGetResponse),

  addInventoryItem: (ctx, { params, body }) => {
    const parsed = parseBody(InventoryAddRequestSchema, body);
    if (!parsed.ok) return parsed.result;
    const added = ctx.narrative.addInventoryItem(params.id, parsed.data.item);
    if (!added) return notFound(`entity "${params.id}" not found`);
    return mutated({
      ok: true,
      entity_id: params.id,
      inventory: ctx.narrative.getInventory(params.id),
    } satisfies InventoryMutationResponse);
  },

  removeInventoryItem: (ctx, { params, body }) => {
    const parsed = parseBody(InventoryRemoveRequestSchema, body);
    if (!parsed.ok) return parsed.result;
    const removed = ctx.narrative.removeInventoryItem(params.id, parsed.data.item_id);
    if (!removed) {
      return notFound(
        `entity "${params.id}" not found or no inventory item with id "${parsed.data.item_id}"`,
      );
    }
    return mutated({
      ok: true,
      entity_id: params.id,
      inventory: ctx.narrative.getInventory(params.id),
    } satisfies InventoryMutationResponse);
  },
} satisfies RouteGroup;
