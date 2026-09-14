/** El turno exclusivo de los candados de `qa/` (#572).
 *
 *  El sujeto es `qa/lib/turno-exclusivo.mjs`, y este fichero existe por lo
 *  mismo que `test/esperas-de-qa.test.ts`: el CI corre los candados headless
 *  pero **nunca dos a la vez**, así que la rama que más importa —«hay otra
 *  corrida viva, no toques nada»— no la ejercería nadie hasta que volviera a
 *  morder. Y ya mordió: el 2026-09-10 dos instancias del candado de reparto se
 *  restauraron mutuamente la mutación de un probe y dejaron en el árbol
 *  `fusionar` SIN verificar el sello, sin un solo error de tipos.
 *
 *  El import cruzado es la regla (#357): la dirección es test → banco. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Turno =
  | { ok: true; fichero: string; soltar: () => void; reclamado: number | null }
  | { ok: false; fichero: string; pid: number | null; porque: string };

const { tomarTurno, estaVivo } = (await import(join(repoRoot, "qa", "lib", "turno-exclusivo.mjs"))) as {
  tomarTurno: (
    nombre: string,
    opciones?: { dir?: string; vivo?: (pid: number) => boolean; pid?: number },
  ) => Turno;
  estaVivo: (pid: number) => boolean;
};

const enUnDirNuevo = (): string => mkdtempSync(join(tmpdir(), "nefan-turnos-test-"));

describe("turno exclusivo · quién puede romper las fuentes", () => {
  it("el turno libre se toma, y queda con el pid dentro", () => {
    const dir = enUnDirNuevo();
    try {
      const t = tomarTurno("reparto", { dir, pid: 4242 });
      assert.equal(t.ok, true);
      if (!t.ok) return;
      assert.equal(readFileSync(t.fichero, "utf8").trim(), "4242", "el pid es lo que distingue vivo de huérfano");
      assert.equal(t.reclamado, null, "no se le quitó a nadie");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("con el dueño VIVO se rechaza, y el consejo dice que NO se toque nada", () => {
    // La rama que importa: es la que el 2026-09-10 no existía, y por eso el
    // mensaje de entonces («míralo y bórralo a mano») invitaba justo a lo peor.
    const dir = enUnDirNuevo();
    try {
      assert.equal(tomarTurno("reparto", { dir, pid: 1, vivo: () => true }).ok, true);
      const otra = tomarTurno("reparto", { dir, pid: 2, vivo: () => true });
      assert.equal(otra.ok, false);
      if (otra.ok) return;
      assert.equal(otra.pid, 1, "dice QUIÉN lo tiene");
      assert.match(otra.porque, /EN MARCHA/);
      assert.match(otra.porque, /NO toques el árbol/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("un turno HUÉRFANO se reclama, y se dice de quién era", () => {
    // La otra mitad: si reclamar fuera igual de silencioso que tomar, una
    // corrida que murió a mitad se vería como una máquina limpia.
    const dir = enUnDirNuevo();
    try {
      assert.equal(tomarTurno("reparto", { dir, pid: 7, vivo: () => true }).ok, true);
      const mia = tomarTurno("reparto", { dir, pid: 9, vivo: () => false });
      assert.equal(mia.ok, true);
      if (!mia.ok) return;
      assert.equal(mia.reclamado, 7, "el huérfano se nombra: su corrida murió y puede haber dejado el árbol sucio");
      assert.equal(readFileSync(mia.fichero, "utf8").trim(), "9");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pedirlo DOS VECES desde el mismo proceso es un error, no un turno", () => {
    // Sin esto, el segundo `soltar()` abriría la puerta mientras el primero
    // cree tenerla cerrada — la misma carrera, un nivel más abajo.
    const dir = enUnDirNuevo();
    try {
      assert.equal(tomarTurno("reparto", { dir, pid: 5, vivo: () => true }).ok, true);
      const otra = tomarTurno("reparto", { dir, pid: 5, vivo: () => true });
      assert.equal(otra.ok, false);
      if (otra.ok) return;
      assert.match(otra.porque, /se ha pedido dos veces/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("un turno con basura dentro se reclama en vez de bloquear para siempre", () => {
    // Un fichero truncado —una corrida matada entre el `wx` y el `write`— no
    // puede dejar los candados inutilizables hasta que alguien lo borre.
    const dir = enUnDirNuevo();
    try {
      const primero = tomarTurno("reparto", { dir, pid: 1, vivo: () => true });
      assert.equal(primero.ok, true);
      if (!primero.ok) return;
      writeFileSync(primero.fichero, "");
      const mia = tomarTurno("reparto", { dir, pid: 3, vivo: () => true });
      assert.equal(mia.ok, true);
      if (!mia.ok) return;
      assert.equal(mia.reclamado, null, "no había dueño que nombrar");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dos turnos con NOMBRES distintos no se estorban", () => {
    const dir = enUnDirNuevo();
    try {
      assert.equal(tomarTurno("reparto", { dir, pid: 1, vivo: () => true }).ok, true);
      assert.equal(tomarTurno("cableado", { dir, pid: 2, vivo: () => true }).ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("`estaVivo` dice la verdad sobre este proceso y miente lo justo sobre uno muerto", () => {
    assert.equal(estaVivo(process.pid), true);
    // El pid 0 es el grupo de procesos, no un proceso: `kill(0, 0)` no sirve de
    // control. Se usa uno imposible.
    assert.equal(estaVivo(0x7ffffff), false);
  });
});
