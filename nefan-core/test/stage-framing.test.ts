import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  frameStage,
  parallaxPanX,
  viewToScreen,
  bandPlanFor,
  type ViewBoxRect,
} from "../src/scene/stage/framing.js";
import { scaleAt, stageToView, type StageProjParams } from "../src/scene/stage/projection.js";

/** Proyección de un plató interior 16×9 m (como el salón de la posada). */
const P: StageProjParams = {
  focal_m: 12,
  depth_m: 9,
  width_m: 16,
  px_per_m: 10,
  horizon_y: 0,
  ground_y: 100,
};
/** viewBox interior (VIEW_TOP_INTERIOR=-28, pad 10, margen 8). */
const VB: ViewBoxRect = { minX: -88, minY: -28, width: 176, height: 138 };

const projFor = (widthM: number, depthM = 9): StageProjParams => ({ ...P, width_m: widthM, depth_m: depthM });

describe("frameStage", () => {
  it("zoom adaptativo: platós pequeños acercan, grandes clampan a minZoom", () => {
    const f16 = frameStage(projFor(16), VB, 1280, 720);
    assert.ok(f16.zoom > 2 && f16.zoom <= 2.8, `16 m acerca fuerte (${f16.zoom})`);
    // Un plató enano SÍ clampa a maxZoom.
    const f10 = frameStage(projFor(10), { ...VB, minX: -58, width: 116 }, 1280, 720);
    assert.equal(f10.zoom, 2.8);
    const f80 = frameStage(projFor(80), { ...VB, minX: -408, width: 816 }, 1280, 720);
    assert.equal(f80.zoom, 1);
    // 24 m cae entre clamps.
    const f24 = frameStage(projFor(24), { ...VB, minX: -128, width: 256 }, 1280, 720);
    assert.ok(f24.zoom > 1 && f24.zoom < 2.8, `zoom intermedio ${f24.zoom}`);
  });

  it("el raíl SIEMPRE tiene recorrido en platós medianos (el bug que motiva esto)", () => {
    const f = frameStage(projFor(16), VB, 1280, 720);
    assert.ok(f.railHalfM > 0.5, `railHalfM ${f.railHalfM} > 0`);
    // El viewport cubre ≤ ~coverFraction del ancho jugable.
    const viewportM = 1280 / (f.fit * P.px_per_m);
    assert.ok(viewportM <= 16 * 0.75, `viewport ${viewportM}m ≤ 70% de 16m (+margen)`);
  });

  it("un plató de 80 m a zoom 1 también tiene raíl (fit0 no lo abarca)", () => {
    const f = frameStage(projFor(80), { ...VB, minX: -408, width: 816 }, 1280, 720);
    assert.ok(f.railHalfM > 10, `railHalfM ${f.railHalfM}`);
  });

  it("guardia del raíl con proyección descentrada: recorta por la asimetría", () => {
    const sym = frameStage(projFor(16), VB, 1280, 720);
    const asym = frameStage({ ...projFor(16), center_x: -12, cam_x_m: 0.8 }, VB, 1280, 720);
    const expected = Math.max(0, sym.railHalfM - 0.8 - 12 / P.px_per_m);
    assert.ok(Math.abs(asym.railHalfM - expected) < 1e-9, `${asym.railHalfM} ≈ ${expected}`);
    // Defaults 0 ⇒ fórmula original intacta.
    const zeros = frameStage({ ...projFor(16), center_x: 0, cam_x_m: 0 }, VB, 1280, 720);
    assert.equal(zeros.railHalfM, sym.railHalfM);
  });

  it("cobertura total: la placa llena el canvas aunque el zoom adaptativo se quede corto", () => {
    // Caso real (salón calibrado): ppm alto ⇒ zoomRaw≈1, pero el viewBox a
    // ese fit no llega al ancho del canvas — sin la cláusula de cobertura
    // quedaban bandas vacías en los flancos (ya no hay marco que las tape).
    const calibrated = { ...projFor(16), px_per_m: 19.7 };
    const f = frameStage(calibrated, VB, 1600, 1000);
    assert.ok(VB.width * f.fit >= 1600 - 1e-6, `placa ${VB.width * f.fit}px ≥ canvas 1600px`);
    assert.ok(f.railHalfM >= 0);
  });

  it("centerVertical: cover centrado — cobertura en ambos ejes y recorte simétrico", () => {
    // Interior profundo 24×16 (posada_salon): con el encuadre viejo
    // (groundAnchor 0.98 + maxZoom del renderer) quedaba un +8% del canvas
    // sin pintar arriba (franja negra) y el delantal cortado por abajo.
    const p = projFor(24, 16);
    const vb: ViewBoxRect = { ...VB, minX: -128, width: 256, height: 160 };
    const f = frameStage(p, vb, 1280, 720, { centerVertical: true, maxZoom: 1 });
    const destYof = (vy: number): number => f.groundScreenY + (vy - p.ground_y) * f.fit;
    // Cobertura: el viewBox tapa el canvas entero en ambos ejes.
    assert.ok(destYof(vb.minY) <= 1e-9, `techo del vb en ${destYof(vb.minY)} ≤ 0`);
    assert.ok(destYof(vb.minY + vb.height) >= 720 - 1e-9, "suelo del vb ≥ borde inferior");
    assert.ok(vb.width * f.fit >= 1280 - 1e-6, "cubre el ancho");
    // Centrado: recorte simétrico arriba/abajo.
    const cropTop = -destYof(vb.minY);
    const cropBottom = destYof(vb.minY + vb.height) - 720;
    assert.ok(Math.abs(cropTop - cropBottom) < 1e-6, `recorte ${cropTop} ≈ ${cropBottom}`);
    // Sin zoom de raíl: el zoom es el mínimo que cubre (aquí manda el ancho).
    assert.ok(Math.abs(f.zoom - 1280 / (vb.width * (720 / vb.height))) < 1e-9);
  });

  it("centerVertical con viewBox del aspect del canvas: cero recorte (zoom 1)", () => {
    const p = projFor(16);
    const vb: ViewBoxRect = { minX: -88, minY: -28, width: 1280 / (720 / 138), height: 138 };
    const f = frameStage(p, vb, 1280, 720, { centerVertical: true, maxZoom: 1 });
    assert.equal(f.zoom, 1);
    const top = f.groundScreenY + (vb.minY - p.ground_y) * f.fit;
    assert.ok(Math.abs(top) < 1e-9, `borde superior clavado a 0 (${top})`);
  });

  it("ancla la línea de suelo al 78% del canvas", () => {
    const f = frameStage(projFor(16), VB, 1280, 720);
    assert.equal(f.groundScreenY, 0.78 * 720);
    // Invariante del anclaje: el techo del viewBox queda EN o sobre el techo
    // del canvas (nunca franja vacía por encima del contenido a zoom 1).
    assert.ok(0.78 <= (P.ground_y - VB.minY) / VB.height);
  });
});

describe("parallaxPanX / viewToScreen", () => {
  const F = frameStage(P, VB, 1280, 720);

  it("sin desplazamiento de cámara no hay paneo", () => {
    assert.equal(parallaxPanX(P, 0, 0), 0);
    assert.equal(parallaxPanX(P, 5, 0), 0);
  });

  it("el paneo decrece con la profundidad (lo cercano corre más)", () => {
    const near = parallaxPanX(P, 0, 2);
    const mid = parallaxPanX(P, 4, 2);
    const far = parallaxPanX(P, 9, 2);
    assert.ok(near > mid && mid > far, `${near} > ${mid} > ${far}`);
    assert.equal(near, 2 * P.px_per_m); // s(0) = 1 ⇒ paneo completo
  });

  it("identidad proyectiva: panear ≡ proyectar respecto a la cámara", () => {
    // Para cualquier punto de plató (xs, z) y cámara camOffsetM:
    // viewToScreen(stageToView(xs, z), z, cam) === proyección de (xs − cam, z).
    for (const [xs, z, cam] of [[3, 2, 1.5], [-5, 7, -2], [0, 0.5, 3]] as const) {
      const [vx, vy] = stageToView(P, xs, z);
      const [sx] = viewToScreen(P, F, 1280, vx, vy, z, cam);
      const expected = 1280 / 2 + (xs - cam) * P.px_per_m * scaleAt(P, z) * F.fit;
      assert.ok(Math.abs(sx - expected) < 1e-9, `${sx} ≈ ${expected}`);
    }
  });

  it("la vertical ancla ground_y en groundScreenY", () => {
    const [, sy] = viewToScreen(P, F, 1280, 0, P.ground_y, 0, 0);
    assert.equal(sy, F.groundScreenY);
  });
});

describe("bandPlanFor", () => {
  const F = frameStage(P, VB, 1280, 720);
  const plan = bandPlanFor(P, VB, F, 1280, 720);

  it("bandas contiguas sin huecos ni solapes cubriendo hasta el borde inferior", () => {
    let y = plan.backdrop.destY + plan.backdrop.destH;
    for (const b of plan.ground) {
      assert.equal(b.destY, y, `banda arranca donde acabó la anterior (${b.destY} vs ${y})`);
      assert.ok(b.destH >= 1);
      y += b.destH;
    }
    assert.equal(plan.apron.destY, y);
    assert.equal(plan.apron.destY + plan.apron.destH, 720);
  });

  it("z estrictamente decreciente hacia la embocadura; backdrop=depth, apron=0", () => {
    assert.equal(plan.backdrop.z, P.depth_m);
    assert.equal(plan.apron.z, 0);
    let prev = Infinity;
    for (const b of plan.ground) {
      assert.ok(b.z < prev, `z ${b.z} < ${prev}`);
      prev = b.z;
    }
  });

  it("presupuesto: Δdx dentro de cada banda ≤ maxShiftPx en el extremo del raíl", () => {
    const maxShift = 0.75;
    for (const b of plan.ground) {
      const zTop = Math.min(P.depth_m, Math.max(0, topZ(b)));
      const zBot = Math.min(P.depth_m, Math.max(0, bottomZ(b)));
      const d = Math.abs(
        F.railHalfM * P.px_per_m * F.fit * (scaleAt(P, zTop) - scaleAt(P, zBot)),
      );
      // +epsilon: el presupuesto se evalúa al AMPLIAR (frontera del bucle).
      assert.ok(d <= maxShift + 0.4, `banda en ${b.destY} Δdx=${d.toFixed(2)}`);
    }
    function topZ(b: { srcVy: number }): number {
      return inverseZ(b.srcVy);
    }
    function bottomZ(b: { srcVy: number; srcVh: number }): number {
      return inverseZ(b.srcVy + b.srcVh);
    }
    function inverseZ(vy: number): number {
      const s = (vy - P.horizon_y) / (P.ground_y - P.horizon_y);
      return s <= 0 ? P.depth_m : (P.focal_m * (1 - s)) / s;
    }
  });

  it("las bandas son finas cerca y gruesas lejos", () => {
    const first = plan.ground[0];
    const last = plan.ground[plan.ground.length - 1];
    assert.ok(first.destH >= last.destH, `lejos ${first.destH}px ≥ cerca ${last.destH}px`);
  });

  it("las fuentes quedan dentro del viewBox", () => {
    const bottom = VB.minY + VB.height;
    for (const b of [plan.backdrop, ...plan.ground, plan.apron]) {
      assert.ok(b.srcVy >= VB.minY - 1e-9 && b.srcVy + b.srcVh <= bottom + 1e-9,
        `fuente [${b.srcVy}, ${b.srcVy + b.srcVh}] dentro de [${VB.minY}, ${bottom}]`);
    }
  });

  it("sin raíl (railHalfM=0) el plan degenera a pocas bandas grandes", () => {
    const wide: ViewBoxRect = { ...VB, minX: -88, width: 176 };
    const noRail = { ...F, railHalfM: 0 };
    const p2 = bandPlanFor(P, wide, noRail, 1280, 720);
    assert.ok(p2.ground.length <= Math.ceil((0.78 * 720) / 8) + 2);
  });
});

describe("cámara de runtime (StageCam): pan + dolly", () => {
  const F = frameStage(P, VB, 1280, 720, { centerVertical: true, maxZoom: 1 });

  it("dolly 0 ≡ viewToScreen actual (regresión término a término)", async () => {
    const { viewToScreenCam } = await import("../src/scene/stage/framing.js");
    for (const [vx, vy, z, cam] of [
      [0, 100, 0, 0], [40, 60, 4, 1.2], [-70, 20, 9, -2], [15, 0, 5, 0.4],
    ] as Array<[number, number, number, number]>) {
      const a = viewToScreen(P, F, 1280, vx, vy, z, cam);
      const b = viewToScreenCam(P, F, 1280, vx, vy, z, { camXM: cam, dollyM: 0 });
      assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9);
    }
  });

  it("identidad pinhole: dolly d ≡ proyectar con la cámara adelantada", async () => {
    const { viewToScreenCam, sCamAt } = await import("../src/scene/stage/framing.js");
    const { stageToViewAt } = await import("../src/scene/stage/projection.js");
    const d = 1.8;
    // Cámara adelantada d: misma lente (F_px = ppm·focal se conserva), mismo
    // plano z=0 (su retroceso es focal−d) ⇒ focal' = focal−d,
    // ppm' = ppm·focal/(focal−d), y ground_y' ajustado para conservar eyeM.
    const ppmAdv = (P.px_per_m * P.focal_m) / (P.focal_m - d);
    const eyeM = (P.ground_y - P.horizon_y) / P.px_per_m;
    const pAdv: StageProjParams = {
      ...P,
      focal_m: P.focal_m - d,
      px_per_m: ppmAdv,
      ground_y: P.horizon_y + eyeM * ppmAdv,
    };
    for (const [x, h, z] of [
      [0, 0, 0.5], [3, 1.7, 4], [-5, 0, 8.5], [2.5, 6, 2],
    ] as Array<[number, number, number]>) {
      // El punto de mundo (x, h, z) visto por la cámara base + dolly runtime:
      const [vx, vy] = stageToViewAt(P, x, z, h);
      const got = viewToScreenCam(P, F, 1280, vx, vy, z, { camXM: 0, dollyM: d });
      // Y visto directamente por la cámara adelantada (mismo z), mapeado con
      // el anclaje de pantalla BASE:
      const [vx2, vy2] = stageToViewAt(pAdv, x, z, h);
      const want = viewToScreen(P, F, 1280, vx2, vy2, z, 0);
      assert.ok(Math.abs(got[0] - want[0]) < 1e-6, `x: ${got[0]} vs ${want[0]} en z=${z}`);
      assert.ok(Math.abs(got[1] - want[1]) < 1e-6, `y: ${got[1]} vs ${want[1]} en z=${z}`);
      // Y la escala del dolly es la del pinhole adelantado:
      assert.ok(
        Math.abs(sCamAt(P, { camXM: 0, dollyM: d }, z) * P.px_per_m - ppmAdv * (pAdv.focal_m / (pAdv.focal_m + z))) < 1e-9,
      );
    }
  });

  it("el horizonte queda fijo en pantalla bajo cualquier dolly", async () => {
    const { viewToScreenCam } = await import("../src/scene/stage/framing.js");
    const base = viewToScreenCam(P, F, 1280, 30, P.horizon_y, 9, { camXM: 0, dollyM: 0 });
    for (const d of [0.5, 1.5, 2.8]) {
      const y = viewToScreenCam(P, F, 1280, 30, P.horizon_y, 9, { camXM: 0, dollyM: d })[1];
      assert.ok(Math.abs(y - base[1]) < 1e-9, `horizonte se mueve con dolly ${d}`);
    }
  });

  it("camRatio ≥ 1 y maxDollyFor acota la ampliación de la embocadura", async () => {
    const { camRatio, maxDollyFor, sCamAt, MAX_NEAR_ZOOM } = await import("../src/scene/stage/framing.js");
    const d = maxDollyFor(P, 0.2);
    assert.ok(d > 0 && d <= 0.2 * P.depth_m);
    for (const z of [0, 2, 5, 9]) {
      assert.ok(camRatio(P, { camXM: 0, dollyM: d }, z) >= 1);
    }
    assert.ok(sCamAt(P, { camXM: 0, dollyM: d }, 0) <= MAX_NEAR_ZOOM + 1e-9, "zoom de embocadura acotado");
  });

  it("stageFollow: convergencia, clamps y dolly nunca negativo", async () => {
    const { stageFollow } = await import("../src/scene/stage/camera.js");
    const opts = { rate: 5, railHalfM: 1.0, maxDollyM: 1.6 };
    let cam = { camXM: 0, dollyM: 0 };
    for (let i = 0; i < 200; i++) cam = stageFollow(cam, { camXM: 0.6, dollyM: 1.2 }, 1 / 60, opts);
    assert.ok(Math.abs(cam.camXM - 0.6) < 1e-3 && Math.abs(cam.dollyM - 1.2) < 1e-3, "converge al target");
    for (let i = 0; i < 200; i++) cam = stageFollow(cam, { camXM: 5, dollyM: 9 }, 1 / 60, opts);
    assert.ok(cam.camXM <= 1.0 + 1e-9 && cam.dollyM <= 1.6 + 1e-9, "clamps");
    for (let i = 0; i < 200; i++) cam = stageFollow(cam, { camXM: -5, dollyM: -3 }, 1 / 60, opts);
    assert.ok(cam.camXM >= -1.0 - 1e-9 && cam.dollyM >= 0, "dolly ≥ 0");
    // Independencia de framerate: dos pasos de dt/2 ≈ un paso de dt.
    const one = stageFollow({ camXM: 0, dollyM: 0 }, { camXM: 0.5, dollyM: 0.5 }, 0.1, opts);
    let two = stageFollow({ camXM: 0, dollyM: 0 }, { camXM: 0.5, dollyM: 0.5 }, 0.05, opts);
    two = stageFollow(two, { camXM: 0.5, dollyM: 0.5 }, 0.05, opts);
    assert.ok(Math.abs(one.camXM - two.camXM) < 1e-6, "frame-rate independence");
  });
});
