/** Manifest `commerce v1` del ejemplo de next.md §7.7, con el amendment
 *  `writes` (los efectos tocan player.gold / player.inventory). Compartido por
 *  los tests de tipos (F1), DSL (F2) y loader (F3). */

export const COMMERCE_MANIFEST = {
  name: "Sistema de comercio",
  description:
    "Mercados, precios dinámicos, préstamos. Activar cuando el jugador comercia repetidamente.",
  version: 1,
  origin: {
    author: "narrative_engine" as const,
    session_id: "1736...-3a2f",
    triggered_by_event: "evt_0042",
    rationale:
      "El jugador ha hecho 5 trueques con el herrero; el motor genérico no modela inventarios de NPCs.",
  },
  slice: {
    schema: {
      type: "object",
      properties: {
        markets: { type: "object" },
        loans: { type: "array" },
      },
    },
    initial: { markets: {}, loans: [] },
  },
  reads: ["entities[*].data", "player.gold", "player.inventory"],
  writes: ["player.gold", "player.inventory"],
  events_consumed: [
    {
      type: "trade_offered",
      when: {
        all: [
          { op: "has" as const, path: "event.market_id" },
          {
            op: "gt" as const,
            path: "slice.markets.{event.market_id}.stock.{event.item_id}",
            value: 0,
          },
          { op: "gte" as const, path: "player.gold", value: "event.price" },
        ],
      },
      do: [
        {
          op: "dec" as const,
          path: "slice.markets.{event.market_id}.stock.{event.item_id}",
          value: 1,
        },
        { op: "dec" as const, path: "player.gold", value: "event.price" },
        {
          op: "push" as const,
          path: "player.inventory",
          value: { id: "event.item_id", from: "event.market_id" },
        },
        {
          op: "emit_event" as const,
          value: {
            type: "trade_completed",
            payload: {
              market_id: "event.market_id",
              item_id: "event.item_id",
              price: "event.price",
            },
          },
        },
      ],
    },
  ],
  events_produced: ["trade_completed", "loan_defaulted"],
  projections: [
    {
      source: "entities",
      rule: {
        filter: { op: "eq" as const, path: "entity.data.role", value: "merchant" },
        for_each: {
          set: "slice.markets.{entity.id}",
          value: {
            owner_id: "entity.id",
            name: "entity.data.name",
            stock: "entity.data.inventory",
            prices: { $lit: {} },
          },
        },
      },
    },
  ],
  derived_views: [
    {
      name: "active_markets",
      rule: {
        map: "slice.markets[*]",
        to: { id: "_.owner_id", name: "_.name", items: "len(_.stock)" },
      },
    },
  ],
  fixtures: [
    {
      before: { markets: { blacksmith_01: { stock: { iron_sword: 2 } } }, loans: [] },
      event: {
        type: "trade_offered",
        market_id: "blacksmith_01",
        item_id: "iron_sword",
        price: 50,
      },
      context: { player: { gold: 100, inventory: [] } },
      after: { markets: { blacksmith_01: { stock: { iron_sword: 1 } } }, loans: [] },
    },
  ],
};
