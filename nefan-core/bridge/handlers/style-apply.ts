/** Soporte del batch "aplicar estilo a un juego" (el batch corre en el
 *  CLIENTE contra remote-gen; aquí solo lo que toca el directorio del juego,
 *  del que el bridge es el único escritor): lectura del snapshot + vocabulario
 *  para computar celdas/roster, y persistencia del registro de aplicación. */
import { createHash } from "node:crypto";

import { loadGameMeta, loadWorldDoc, WORLD_VIEWS } from "../../src/games/loader.js";
import {
  branchForView,
  loadWorldSnapshot,
  worldSnapshotStatus,
} from "../../src/games/world-snapshot.js";
import { loadWorldVocabulary } from "../../src/games/vocabulary.js";
import {
  StyleApplicationRecordSchema,
  writeStyleApplication,
} from "../../src/games/style-application.js";
import type {
  GetWorldSnapshotMessage,
  RecordStyleApplicationMessage,
} from "../../src/protocol/messages.js";
import type { BridgeContext, ClientSocket } from "../context.js";

export function handleGetWorldSnapshot(
  msg: GetWorldSnapshotMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): void {
  try {
    const meta = loadGameMeta(ctx.gamesDir, msg.gameId);
    const view = msg.view || meta.view || "overworld";
    if (!(WORLD_VIEWS as readonly string[]).includes(view)) {
      throw new Error(`vista desconocida "${view}" (esperaba ${WORLD_VIEWS.join("|")})`);
    }
    const branch = branchForView(view);
    const worldDocHash = createHash("sha256")
      .update(loadWorldDoc(ctx.gamesDir, msg.gameId), "utf-8")
      .digest("hex");
    const snapshot = loadWorldSnapshot(ctx.gamesDir, msg.gameId, branch, worldDocHash);
    const status = snapshot
      ? "ready"
      : worldSnapshotStatus(ctx.gamesDir, msg.gameId, branch, worldDocHash);
    const vocabulary = snapshot
      ? loadWorldVocabulary(ctx.gamesDir, msg.gameId, worldDocHash)
      : null;
    ctx.send(ws, {
      type: "world_snapshot",
      requestId: msg.requestId,
      ok: true,
      status,
      snapshot: snapshot as Record<string, unknown> | null,
      vocabulary: vocabulary as Record<string, unknown> | null,
    });
  } catch (err) {
    console.error(`Bridge: get_world_snapshot("${msg.gameId}") failed:`, err);
    ctx.send(ws, {
      type: "world_snapshot",
      requestId: msg.requestId,
      ok: false,
      error: (err as Error).message ?? String(err),
    });
  }
}

export function handleRecordStyleApplication(
  msg: RecordStyleApplicationMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): void {
  const fail = (error: string): void => {
    console.error(`Bridge: record_style_application failed: ${error}`);
    ctx.send(ws, { type: "style_application_recorded", requestId: msg.requestId, ok: false, error });
  };
  const parsed = StyleApplicationRecordSchema.safeParse(msg.record);
  if (!parsed.success) {
    return fail(`registro inválido: ${parsed.error.message.slice(0, 500)}`);
  }
  try {
    // El juego debe existir (el registro vive en su directorio).
    loadGameMeta(ctx.gamesDir, parsed.data.game_id);
    writeStyleApplication(ctx.gamesDir, parsed.data);
    console.log(
      `Bridge: estilo "${parsed.data.style_id}" aplicado a "${parsed.data.game_id}" ` +
        `(${parsed.data.view}): ${parsed.data.summary.atlas_cells_painted} celdas, ` +
        `${parsed.data.summary.skins_painted} skins, $${parsed.data.summary.cost_usd}`,
    );
    ctx.send(ws, { type: "style_application_recorded", requestId: msg.requestId, ok: true });
  } catch (err) {
    fail((err as Error).message ?? String(err));
  }
}
