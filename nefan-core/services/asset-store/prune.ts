/** Prune LRU por grupos (type, hash) — port de AssetManifest.prune con la
 *  keep-list de world-state (F2, decisión abierta 2 → tomada: pull S6→S2).
 *
 *  Si world-state no responde, el CALLER (http-server) ABORTA el prune: los
 *  saves post-F2 referencian assets por hash, así que podar sin keep-list
 *  borraría assets en uso. `keep === null` aquí solo se da en tests/CLI que
 *  asumen explícitamente ese riesgo. */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { ManifestDb } from "./manifest-db.js";

export interface PruneSummary {
  pruned: number;
  freed_bytes: number;
  total_bytes: number;
}

/** Hashes referenciados por algún save vivo, o null si world-state no
 *  respondió (→ prune sin protección, con warning). */
export async function fetchKeepList(worldStateUrl: string): Promise<Set<string> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3_000);
  try {
    const res = await fetch(`${worldStateUrl}/sessions/asset_refs`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { refs?: unknown };
    if (!Array.isArray(body.refs)) return null;
    return new Set(body.refs.filter((r): r is string => typeof r === "string"));
  } catch {
    return null;
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
