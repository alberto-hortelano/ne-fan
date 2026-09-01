/** Prune LRU por grupos (type, hash) — port de AssetManifest.prune con la
 *  keep-list de world-state (F2, decisión abierta 2 → tomada: pull S6→S2).
 *
 *  Si world-state no responde, el CALLER (http-server) ABORTA el prune: los
 *  saves post-F2 referencian assets por hash, así que podar sin keep-list
 *  borraría assets en uso. `keep === null` en `prune()` solo se da en
 *  tests/CLI que asumen explícitamente ese riesgo. */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { ManifestDb } from "./manifest-db.js";

export interface PruneSummary {
  pruned: number;
  freed_bytes: number;
  total_bytes: number;
}

const KEEP_LIST_TIMEOUT_MS = 3_000;

/** Resultado de pedir la keep-list: los hashes referenciados por algún save
 *  vivo, o la causa EXACTA de no tenerla. Es el caso-libro del `Result<T,E>`
 *  de CLAUDE.md: antes esto era `Set | null`, y timeout, DNS, un 500 y un
 *  JSON corrupto colapsaban en el mismo null — el 503 con el que el caller
 *  aborta el prune no podía decir por qué, y la causa se perdía entera. */
export type KeepListResult =
  | { ok: true; keep: Set<string> }
  | { ok: false; error: string };

export async function fetchKeepList(worldStateUrl: string): Promise<KeepListResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), KEEP_LIST_TIMEOUT_MS);
  try {
    const res = await fetch(`${worldStateUrl}/sessions/asset_refs`, { signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, error: `world-state contestó HTTP ${res.status}` };
    }
    let body: { refs?: unknown };
    try {
      body = (await res.json()) as { refs?: unknown };
    } catch (err) {
      return {
        ok: false,
        error: `world-state contestó 200 con JSON ilegible (${(err as Error).message})`,
      };
    }
    if (!Array.isArray(body.refs)) {
      return { ok: false, error: "world-state contestó 200 sin refs[] — ¿cambió el contrato?" };
    }
    return { ok: true, keep: new Set(body.refs.filter((r): r is string => typeof r === "string")) };
  } catch (err) {
    const causa = ctrl.signal.aborted
      ? `timeout tras ${KEEP_LIST_TIMEOUT_MS} ms`
      : ((err as Error)?.message ?? String(err));
    return { ok: false, error: `world-state inalcanzable en ${worldStateUrl} (${causa})` };
  } finally {
    clearTimeout(timer);
  }
}

export function prune(
  db: ManifestDb,
  dirsByType: Record<string, string>,
  maxBytes: number,
  keep: Set<string> | null,
): PruneSummary {
  if (maxBytes <= 0) return { pruned: 0, freed_bytes: 0, total_bytes: db.totalBytes() };

  const groups = db.pruneGroups();
  let total = groups.reduce((acc, g) => acc + g.size, 0);
  if (total <= maxBytes) return { pruned: 0, freed_bytes: 0, total_bytes: total };

  let pruned = 0;
  let freed = 0;
  // ISO-8601 ordena lexicográficamente: el más antiguo primero.
  groups.sort((a, b) => (a.last < b.last ? -1 : a.last > b.last ? 1 : 0));
  for (const g of groups) {
    if (total <= maxBytes) break;
    if (keep?.has(g.hash)) continue; // referenciado por un save vivo
    const root = dirsByType[g.type];
    if (root === undefined) continue; // type sin dir conocido — no tocar
    const blobDir = join(root, g.hash);
    try {
      if (existsSync(blobDir)) rmSync(blobDir, { recursive: true });
    } catch (err) {
      console.warn(`asset-store prune: cannot remove ${blobDir}:`, err);
      continue; // no desindexar lo que sigue en disco
    }
    db.deleteGroup(g.type, g.hash);
    total -= g.size;
    freed += g.size;
    pruned += 1;
  }
  return { pruned, freed_bytes: freed, total_bytes: total };
}
