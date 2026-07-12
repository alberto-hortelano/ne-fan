/** Lectura del snapshot de config de nefan-core (runtime_config.json).
 *
 *  narrative-mcp no es TypeScript-del-monorepo: no importa CONFIG, lee el
 *  snapshot que genera `nefan-core/scripts/dump-config.ts` (igual que
 *  ai_server). Fail-loud si no existe: regenerar con `npm run build` en
 *  nefan-core. Las env vars de cada consumidor siguen mandando. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

interface RuntimeConfig {
  ports: { bridge: number; state_api: number; narrative_ws: number };
}

function findSnapshot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, 'nefan-core', 'data', 'runtime_config.json');
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, '..');
  }
  throw new Error(
    'runtime_config.json no encontrado — regenerar con `cd nefan-core && npx tsx scripts/dump-config.ts`',
  );
}

export const RUNTIME_CONFIG: RuntimeConfig = JSON.parse(readFileSync(findSnapshot(), 'utf-8'));
