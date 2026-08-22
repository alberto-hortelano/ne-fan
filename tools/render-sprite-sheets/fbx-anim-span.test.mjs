/** Pruebas del lector de intervalos de `fbx-anim-span.mjs`.
 *
 * Los FBX de verdad son de Mixamo y están fuera del repositorio por licencia,
 * así que aquí se construye uno sintético en memoria con el mínimo del formato
 * binario: cabecera + Objects > AnimationStack > Properties70 > P. Eso deja el
 * parser probado en un clon limpio y sin descargar 1,5 GB.
 *
 *   node --test tools/render-sprite-sheets/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { declaredClipDuration, readAnimStacks } from "./fbx-anim-span.mjs";

const TICKS_PER_SECOND = 46186158000;

const propStr = (s) => {
  const b = Buffer.from(s, "utf8");
  const out = Buffer.alloc(5 + b.length);
  out.write("S", 0, "latin1");
  out.writeUInt32LE(b.length, 1);
  b.copy(out, 5);
  return out;
};

const propI64 = (v) => {
  const out = Buffer.alloc(9);
  out.write("L", 0, "latin1");
  out.writeBigInt64LE(BigInt(v), 1);
  return out;
};

/** Codifica un registro FBX en su offset absoluto. `children` son funciones que
 *  reciben su propio offset, porque `endOffset` es absoluto dentro del fichero. */
function encodeNode(name, props, children) {
  return (start) => {
    const propBuf = Buffer.concat(props);
    const nameBuf = Buffer.from(name, "utf8");
    const headLen = 8 * 3 + 1 + nameBuf.length;
    let off = start + headLen + propBuf.length;
    const childBufs = [];
    for (const child of children) {
      const buf = child(off);
      childBufs.push(buf);
      off += buf.length;
    }
    if (children.length > 0) {
      childBufs.push(Buffer.alloc(25)); // registro nulo que cierra los hermanos
      off += 25;
    }
    const head = Buffer.alloc(headLen);
    head.writeBigUInt64LE(BigInt(off), 0);
    head.writeBigUInt64LE(BigInt(props.length), 8);
    head.writeBigUInt64LE(BigInt(propBuf.length), 16);
    head.writeUInt8(nameBuf.length, 24);
    nameBuf.copy(head, 25);
    return Buffer.concat([head, propBuf, ...childBufs]);
  };
}

const timeProp = (key, seconds) =>
  encodeNode("P", [propStr(key), propStr("KTime"), propStr("Time"), propStr(""),
    propI64(Math.round(seconds * TICKS_PER_SECOND))], []);

/** `stacks`: [{ name, start, stop }] — un fichero FBX binario v7700 completo. */
function synthFbx(stacks) {
  const header = Buffer.alloc(27);
  header.write("Kaydara FBX Binary  \0", 0, "latin1");
  header.writeUInt8(0x1a, 21);
  header.writeUInt8(0x00, 22);
  header.writeUInt32LE(7700, 23);

  const objects = encodeNode(
    "Objects",
    [],
    stacks.map((s) =>
      encodeNode("AnimationStack", [propI64(1234), propStr(s.name), propStr("")], [
        encodeNode("Properties70", [], [
          timeProp("LocalStart", s.start),
          timeProp("LocalStop", s.stop),
        ]),
      ]),
    ),
  );
  return Buffer.concat([header, objects(header.length), Buffer.alloc(25)]);
}

test("lee el intervalo declarado del AnimationStack", () => {
  const buf = synthFbx([{ name: "mixamo.com", start: 0, stop: 11 / 3 }]);
  const stacks = readAnimStacks(buf);
  assert.equal(stacks.length, 1);
  assert.equal(stacks[0].name, "mixamo.com");
  assert.ok(Math.abs(stacks[0].stop - 11 / 3) < 1e-9, `stop=${stacks[0].stop}`);
  assert.ok(Math.abs(declaredClipDuration(buf, "mixamo.com", "test") - 11 / 3) < 1e-9);
});

test("recorta el sufijo de clase que añaden Maya y Blender", () => {
  const buf = synthFbx([{ name: "Take 001\0\x01AnimStack", start: 0, stop: 1.1 }]);
  assert.equal(readAnimStacks(buf)[0].name, "Take 001");
});

test("con varios stacks elige el que casa por nombre", () => {
  const buf = synthFbx([
    { name: "otra", start: 0, stop: 9 },
    { name: "mixamo.com", start: 0, stop: 1.5 },
  ]);
  assert.equal(declaredClipDuration(buf, "mixamo.com", "test"), 1.5);
});

test("falla fuerte si ningún stack casa y hay ambigüedad", () => {
  const buf = synthFbx([
    { name: "a", start: 0, stop: 1 },
    { name: "b", start: 0, stop: 2 },
  ]);
  assert.throws(() => declaredClipDuration(buf, "mixamo.com", "test"), /ninguno se llama/);
});

test("falla fuerte si no hay intervalo declarado", () => {
  const buf = synthFbx([{ name: "mixamo.com", start: 0, stop: 0 }]);
  assert.throws(() => declaredClipDuration(buf, "mixamo.com", "test"), /ningún AnimationStack/);
});

test("falla fuerte si no es un FBX binario", () => {
  assert.throws(() => readAnimStacks(Buffer.from("; FBX 7.7.0 project file\n")), /no es un FBX binario/);
});
