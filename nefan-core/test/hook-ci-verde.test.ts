/** El hook `Stop` `.claude/hooks/ci-verde.sh`, en negativo (#709).
 *
 *  El guardia que impide dar una tarea por terminada con el CI en rojo no
 *  tenía un solo test, y tenía un agujero medido: una PR ABIERTA sin ningún
 *  check (`statusCheckRollup: []`) salía con 0, igual que «no hay CI que
 *  esperar». Es justo lo que ve una PR con `mergeable_state: dirty`: GitHub no
 *  lanza el workflow `pull_request` de una rama en conflicto, así que el CI no
 *  sale ROJO, sale AUSENTE, y el guardia lo dejaba pasar (tanda AB, #426).
 *
 *  Cómo se prueba sin red: un repo git de usar y tirar con la rama subida a un
 *  remoto desnudo (el hook exige upstream), y un `gh` FALSO en el `PATH` que
 *  imprime el JSON de `GH_FALSO_JSON` y aplica `--jq` si se lo pasan, como el
 *  de verdad. Con `GH_FALSO_SALE` ≠ vacío sale con ese código (sin PR, sin red).
 *
 *  Depende de `git`, `jq` y `timeout` (coreutils) en la máquina: el runner
 *  `ubuntu-latest` trae los tres. Si falta `jq`, esto NO se salta: el primer
 *  test lo afirma y se pone rojo diciendo qué falta.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOK = join(repoRoot, ".claude", "hooks", "ci-verde.sh");

const GH_FALSO = `#!/usr/bin/env bash
[ -n "\${GH_FALSO_SALE:-}" ] && exit "$GH_FALSO_SALE"
filtro=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--jq" ]; then filtro=$2; shift; fi
  shift
done
if [ -n "$filtro" ]; then printf '%s' "$GH_FALSO_JSON" | jq -c "$filtro"; else printf '%s\\n' "$GH_FALSO_JSON"; fi
`;

let dir = "";
let trabajo = "";
let bin = "";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

type Check = { name: string; status: string; conclusion: string };
function pr(state: string, checks: Check[], mergeable = "MERGEABLE"): string {
  return JSON.stringify({
    state,
    mergeable,
    statusCheckRollup: checks.map((c) => ({ __typename: "CheckRun", ...c })),
  });
}
const OK: Check = { name: "nefan-core", status: "COMPLETED", conclusion: "SUCCESS" };

/** Corre el hook en `cwd` con el `gh` falso delante en el PATH. */
function hook(env: Record<string, string>, cwd = trabajo): { code: number; out: string } {
  const r = spawnSync("bash", [HOOK], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, GH_FALSO_SALE: "", ...env },
  });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, out: r.stdout.trim() };
}

function decision(out: string): unknown {
  assert.notEqual(out, "", "el hook no dijo nada: dejó pasar");
  return (JSON.parse(out) as { decision?: unknown }).decision;
}

/** Olvida los avisos previos: el backstop cuenta por sha. */
function nuevoCommit(): void {
  git(trabajo, "commit", "-q", "--allow-empty", "-m", "otro");
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), "hook-ci-verde-"));
  bin = join(dir, "bin");
  execFileSync("mkdir", [bin]);
  writeFileSync(join(bin, "gh"), GH_FALSO);
  chmodSync(join(bin, "gh"), 0o755);
  const remoto = join(dir, "remoto.git");
  trabajo = join(dir, "trabajo");
  git(dir, "init", "-q", "--bare", remoto);
  git(dir, "init", "-q", "-b", "main", trabajo);
  git(trabajo, "commit", "-q", "--allow-empty", "-m", "raíz");
  git(trabajo, "remote", "add", "origin", remoto);
  git(trabajo, "checkout", "-q", "-b", "feature/x");
  git(trabajo, "push", "-q", "-u", "origin", "feature/x");
});

after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("ci-verde.sh — el guardia del hook Stop", () => {
  it("la máquina tiene jq (el hook lo usa; sin él esto no se salta, se pone rojo)", () => {
    const r = spawnSync("jq", ["--version"], { encoding: "utf8" });
    assert.equal(r.status, 0, `jq no está instalado: el hook ci-verde.sh lo necesita (${r.error?.message ?? r.stderr})`);
  });

  it("PR ABIERTA sin ningún check → BLOQUEA (la rama en conflicto no lanza CI: ausente no es verde)", () => {
    nuevoCommit();
    const r = hook({ GH_FALSO_JSON: pr("OPEN", [], "CONFLICTING") });
    assert.equal(r.code, 0);
    assert.equal(decision(r.out), "block");
    assert.match(r.out, /CONFLICTING/, "el motivo nombra el mergeable leído");
  });

  it("PR abierta con todo en verde → deja pasar en silencio", () => {
    nuevoCommit();
    const r = hook({ GH_FALSO_JSON: pr("OPEN", [OK, { ...OK, name: "ai-server" }]) });
    assert.deepEqual(r, { code: 0, out: "" });
  });

  it("un check en ROJO → bloquea nombrándolo", () => {
    nuevoCommit();
    const r = hook({
      GH_FALSO_JSON: pr("OPEN", [OK, { name: "ai-server", status: "COMPLETED", conclusion: "FAILURE" }]),
    });
    assert.equal(decision(r.out), "block");
    assert.match(r.out, /EN ROJO: ai-server/);
  });

  it("un check corriendo → bloquea (espera)", () => {
    nuevoCommit();
    const r = hook({ GH_FALSO_JSON: pr("OPEN", [OK, { name: "ai-server", status: "IN_PROGRESS", conclusion: "" }]) });
    assert.equal(decision(r.out), "block");
    assert.match(r.out, /sigue corriendo \(1 checks/);
  });

  it("PR ya mergeada o cerrada sin checks → nada que esperar", () => {
    nuevoCommit();
    assert.deepEqual(hook({ GH_FALSO_JSON: pr("MERGED", []) }), { code: 0, out: "" });
    assert.deepEqual(hook({ GH_FALSO_JSON: pr("CLOSED", []) }), { code: 0, out: "" });
  });

  it("gh falla (sin PR, sin red, sin auth) → fail-open", () => {
    nuevoCommit();
    assert.deepEqual(hook({ GH_FALSO_SALE: "1", GH_FALSO_JSON: "" }), { code: 0, out: "" });
  });

  it("en main no hay nada que esperar, aunque gh dijera rojo", () => {
    const rojo = pr("OPEN", [{ name: "x", status: "COMPLETED", conclusion: "FAILURE" }]);
    git(trabajo, "checkout", "-q", "main");
    try {
      assert.deepEqual(hook({ GH_FALSO_JSON: rojo }), { code: 0, out: "" });
    } finally {
      git(trabajo, "checkout", "-q", "feature/x");
    }
  });

  it("backstop: tras 6 bloqueos sobre el mismo sha, el 7.º avisa y deja pasar", () => {
    nuevoCommit();
    const env = { GH_FALSO_JSON: pr("OPEN", []) };
    for (let i = 1; i <= 6; i++) assert.equal(decision(hook(env).out), "block", `llamada ${i}`);
    const r = hook(env);
    assert.equal(r.code, 0);
    const msg = JSON.parse(r.out) as { decision?: unknown; systemMessage?: unknown };
    assert.equal(msg.decision, undefined);
    assert.match(String(msg.systemMessage), /ya ha avisado 6 veces/);
  });
});
