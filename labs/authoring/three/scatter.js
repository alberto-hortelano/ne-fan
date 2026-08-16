// Scatter procedural declarativo: el AUTOR (motor narrativo) declara zonas
// {kind, shape, density} y una función generadora por kind; este módulo
// muestrea posiciones deterministas (semilla), asienta cada instancia sobre
// el terreno y le da variación estructural llamando al generador con un rng
// propio. No hay catálogo: los generadores se definen en el momento.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// shapes: {type:"rect",x0,z0,x1,z1} | {type:"ellipse",cx,cz,rx,rz} | {type:"poly",pts:[[x,z],...]}
function bounds(s) {
  if (s.type === "rect") return { x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1 };
  if (s.type === "ellipse") return { x0: s.cx - s.rx, z0: s.cz - s.rz, x1: s.cx + s.rx, z1: s.cz + s.rz };
  if (s.type === "poly") {
    const xs = s.pts.map((p) => p[0]), zs = s.pts.map((p) => p[1]);
    return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
  }
  throw new Error(`scatter: shape desconocida '${s.type}'`);
}

function contains(s, x, z) {
  if (s.type === "rect") return x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1;
  if (s.type === "ellipse") {
    const dx = (x - s.cx) / s.rx, dz = (z - s.cz) / s.rz;
    return dx * dx + dz * dz <= 1;
  }
  // poly: ray casting
  let inside = false;
  const p = s.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (((p[i][1] > z) !== (p[j][1] > z)) &&
        (x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0])) {
      inside = !inside;
    }
  }
  return inside;
}

function area(s) {
  if (s.type === "rect") return (s.x1 - s.x0) * (s.z1 - s.z0);
  if (s.type === "ellipse") return Math.PI * s.rx * s.rz;
  let a = 0;
  const p = s.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  }
  return Math.abs(a / 2);
}

// exclusions: {x0,z0,x1,z1} (rect) o {cx,cz,r} (círculo)
function isExcluded(exclusions, x, z) {
  for (const e of exclusions) {
    if (e.r !== undefined) {
      const dx = x - e.cx, dz = z - e.cz;
      if (dx * dx + dz * dz < e.r * e.r) return true;
    } else if (x >= e.x0 && x <= e.x1 && z >= e.z0 && z <= e.z1) {
      return true;
    }
  }
  return false;
}

/**
 * Puebla la escena. zones[i]:
 *   kind        clave en generators (obligatoria; kind sin generador = throw)
 *   shape       rect|ellipse|poly
 *   density     elementos/m²
 *   params?     pasa tal cual al generador
 *   seed?       semilla propia (default: opts.seed)
 *   groundH?    función de altura propia (default: opts.groundH)
 *   minY/maxY?  descarta posiciones cuyo suelo quede fuera del rango
 *   sink?       hundimiento en el suelo (default 0.08)
 *   tilt?       inclinación aleatoria máx en rad (default 0.05)
 * Devuelve conteos por zona: [{kind, wanted, placed}]
 */
export function populate(scene, zones, generators, opts) {
  const { groundH, seed = 1, exclusions = [] } = opts;
  const counts = [];
  zones.forEach((zone, zi) => {
    const gen = generators[zone.kind];
    if (!gen) throw new Error(`scatter: zona ${zi} usa kind '${zone.kind}' sin generador`);
    const hFun = zone.groundH ?? groundH;
    const rng = mulberry32(((zone.seed ?? seed) * 7919 + zi * 331) >>> 0);
    const b = bounds(zone.shape);
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const wanted = Math.round(area(zone.shape) * zone.density);
    // rejilla estratificada con jitter: reparto uniforme sin clones de patrón
    const cols = Math.max(1, Math.round(Math.sqrt(wanted * (w / Math.max(d, 1e-6)))));
    const rows = Math.max(1, Math.ceil(wanted / cols));
    let placed = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (placed >= wanted) break;
        const x = b.x0 + ((c + rng()) / cols) * w;
        const z = b.z0 + ((r + rng()) / rows) * d;
        if (!contains(zone.shape, x, z)) continue;
        if (isExcluded(exclusions, x, z)) continue;
        const y = hFun(x, z);
        if (zone.minY !== undefined && y < zone.minY) continue;
        if (zone.maxY !== undefined && y > zone.maxY) continue;
        const g = gen(rng, zone.params ?? {});
        g.position.set(x, y - (zone.sink ?? 0.08), z);
        g.rotation.y = rng() * Math.PI * 2;
        const tilt = zone.tilt ?? 0.05;
        g.rotation.x = (rng() - 0.5) * 2 * tilt;
        g.rotation.z = (rng() - 0.5) * 2 * tilt;
        scene.add(g);
        placed++;
      }
    }
    counts.push({ kind: zone.kind, wanted, placed });
  });
  return counts;
}
