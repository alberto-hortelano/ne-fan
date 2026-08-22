/** Lee el intervalo declarado del `AnimationStack` de un FBX binario.
 *
 * Por qué existe: `FBXLoader` construye el `AnimationClip` con duración -1, o
 * sea el instante del último keyframe. El importador de Godot usaba el
 * intervalo que el propio FBX declara (`LocalStart`/`LocalStop` del
 * AnimationStack), y en las animaciones de Mixamo NO coinciden: "sword and
 * shield idle" tiene su última clave en 3,600 s pero declara 3,666667 s. Esos
 * 0,0667 s son un fotograma de la hoja a 12 fps — con la duración de three la
 * hoja sale con 43 frames en vez de 44 y el bucle se salta el último.
 *
 * El formato binario es una lista de registros anidados; aquí solo se baja a
 * `Objects → AnimationStack → Properties70 → P`, saltando el resto por su
 * `endOffset` (un FBX de Mixamo son 2 MB casi todos de geometría).
 * Referencia del formato: https://code.blender.org/2013/08/fbx-binary-file-format-specification/
 *
 * Fail-loud: si el fichero no es FBX binario, o no declara ningún
 * AnimationStack, se lanza. Nunca se devuelve una duración inventada.
 */

/** Ticks de FBX por segundo (KTime). Constante del formato. */
const FBX_TICKS_PER_SECOND = 46186158000;

const MAGIC = "Kaydara FBX Binary  \0";
const HEADER_LEN = 27;
/** Bytes por elemento de cada tipo de propiedad-array, para saltarla sin
 *  descomprimir cuando viene sin codificar. */
const ARRAY_ELEM_BYTES = { f: 4, d: 8, l: 8, i: 4, b: 1 };

/** Cabecera de un registro. A partir de FBX 7500 los offsets son de 64 bits. */
function readRecord(buf, off, wide) {
  const size = wide ? 8 : 4;
  const num = (o) => (wide ? Number(buf.readBigUInt64LE(o)) : buf.readUInt32LE(o));
  const endOffset = num(off);
  if (endOffset === 0) return null; // registro nulo: fin de la lista de hermanos
  const numProps = num(off + size);
  const propListLen = num(off + size * 2);
  const nameLen = buf.readUInt8(off + size * 3);
  const nameAt = off + size * 3 + 1;
  return {
    endOffset,
    numProps,
    name: buf.toString("utf8", nameAt, nameAt + nameLen),
    propsAt: nameAt + nameLen,
    childrenAt: nameAt + nameLen + propListLen,
  };
}

function readProps(buf, off, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const type = String.fromCharCode(buf.readUInt8(off));
    off += 1;
    switch (type) {
      case "Y": out.push(buf.readInt16LE(off)); off += 2; break;
      case "C": out.push(Boolean(buf.readUInt8(off))); off += 1; break;
      case "I": out.push(buf.readInt32LE(off)); off += 4; break;
      case "F": out.push(buf.readFloatLE(off)); off += 4; break;
      case "D": out.push(buf.readDoubleLE(off)); off += 8; break;
      case "L": out.push(Number(buf.readBigInt64LE(off))); off += 8; break;
      case "S":
      case "R": {
        const len = buf.readUInt32LE(off);
        off += 4;
        out.push(type === "S" ? buf.toString("utf8", off, off + len) : null);
        off += len;
        break;
      }
      case "f": case "d": case "l": case "i": case "b": {
        const arrayLength = buf.readUInt32LE(off);
        const encoding = buf.readUInt32LE(off + 4);
        const compressedLength = buf.readUInt32LE(off + 8);
        // No hace falta el contenido: aquí solo aparecen en nodos que se saltan.
        off += 12 + (encoding === 0 ? arrayLength * ARRAY_ELEM_BYTES[type] : compressedLength);
        out.push(null);
        break;
      }
      default:
        throw new Error(`tipo de propiedad FBX desconocido: "${type}" en el byte ${off - 1}`);
    }
  }
  return out;
}

/** Itera los hermanos de una lista de registros llamando a `visit(record)`.
 *  `visit` decide si baja o no; aquí siempre se salta al `endOffset`. */
function eachSibling(buf, start, limit, wide, visit) {
  let off = start;
  while (off < limit) {
    const rec = readRecord(buf, off, wide);
    if (!rec) return;
    visit(rec);
    off = rec.endOffset;
  }
}

/** Devuelve `[{ name, start, stop }]` (segundos) por cada AnimationStack del
 *  fichero, en orden de aparición. */
export function readAnimStacks(buf) {
  if (buf.toString("binary", 0, MAGIC.length) !== MAGIC) {
    throw new Error("no es un FBX binario (cabecera Kaydara ausente)");
  }
  const version = buf.readUInt32LE(23);
  const wide = version >= 7500;

  const stacks = [];
  eachSibling(buf, HEADER_LEN, buf.length, wide, (top) => {
    if (top.name !== "Objects") return;
    eachSibling(buf, top.childrenAt, top.endOffset, wide, (obj) => {
      if (obj.name !== "AnimationStack") return;
      const props = readProps(buf, obj.propsAt, obj.numProps);
      // Propiedades de un objeto FBX: [uid, "nombre\x00\x01Clase", "SubClase"].
      // Mixamo escribe el nombre a secas; Maya y Blender sí ponen el sufijo.
      const label = String(props[1] ?? "").split("\0")[0];
      const span = { name: label, start: 0, stop: 0 };
      eachSibling(buf, obj.childrenAt, obj.endOffset, wide, (child) => {
        if (child.name !== "Properties70") return;
        eachSibling(buf, child.childrenAt, child.endOffset, wide, (p) => {
          if (p.name !== "P") return;
          const pp = readProps(buf, p.propsAt, p.numProps);
          const ticks = pp[4];
          if (typeof ticks !== "number") return;
          if (pp[0] === "LocalStart") span.start = ticks / FBX_TICKS_PER_SECOND;
          if (pp[0] === "LocalStop") span.stop = ticks / FBX_TICKS_PER_SECOND;
        });
      });
      stacks.push(span);
    });
  });
  return stacks;
}

/** Duración declarada del AnimationStack que casa con `clipName`. Si el nombre
 *  no aparece y solo hay un stack, se usa ese. */
export function declaredClipDuration(buf, clipName, sourceLabel) {
  const stacks = readAnimStacks(buf).filter((s) => s.stop > s.start);
  if (stacks.length === 0) {
    throw new Error(`${sourceLabel}: ningún AnimationStack con intervalo declarado`);
  }
  const match = stacks.find((s) => s.name === clipName) ?? (stacks.length === 1 ? stacks[0] : null);
  if (!match) {
    throw new Error(
      `${sourceLabel}: hay ${stacks.length} AnimationStacks y ninguno se llama "${clipName}"` +
        ` (${stacks.map((s) => s.name).join(", ")})`,
    );
  }
  return match.stop - match.start;
}
