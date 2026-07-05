import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sanitizeMapSvg, MAP_SVG_MAX_BYTES } from "../src/scene/map-svg.js";

/** SVG mínimo válido con las 4 capas obligatorias. */
function validSvg(extra = ""): string {
  return (
    '<svg viewBox="0 0 128 128">' +
    '<g id="ground"><rect width="128" height="128" fill="#3d5a2c"/></g>' +
    '<g id="water"/>' +
    '<g id="solid"><circle cx="30" cy="20" r="0.5" fill="#5a4632"/></g>' +
    '<g id="tall"><circle cx="30" cy="20" r="4" fill="#2c4a22"/></g>' +
    extra +
    "</svg>"
  );
}

describe("sanitizeMapSvg", () => {
  it("acepta un SVG válido con las 4 capas y lo recorta de espacios", () => {
    const res = sanitizeMapSvg(`  ${validSvg()}\n`, 128, 128);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.svg, validSvg());
  });

  it("acepta la capa deck opcional y comillas simples en los ids", () => {
    const svg =
      "<svg viewBox=\"0 0 128 128\"><g id='ground'/><g id='water'/>" +
      "<g id='deck'><rect x=\"50\" y=\"40\" width=\"6\" height=\"3\"/></g>" +
      "<g id='solid'/><g id='tall'/></svg>";
    assert.equal(sanitizeMapSvg(svg, 128, 128).ok, true);
  });

  it("rechaza si falta una capa obligatoria, nombrándola", () => {
    const svg = validSvg().replace('<g id="water"/>', "");
    const res = sanitizeMapSvg(svg, 128, 128);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /water/);
  });

  it("rechaza viewBox distinto del esperado", () => {
    const svg = validSvg().replace('viewBox="0 0 128 128"', 'viewBox="0 0 64 64"');
    const res = sanitizeMapSvg(svg, 128, 128);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /viewBox/);
  });

  it("rechaza contenido peligroso: script, foreignObject, href", () => {
    for (const evil of ["<script>x()</script>", "<foreignObject/>", '<use href="http://x"/>']) {
      const res = sanitizeMapSvg(validSvg(evil), 128, 128);
      assert.equal(res.ok, false, `debería rechazar ${evil}`);
      if (!res.ok) assert.match(res.error, /script\/foreignObject\/href/);
    }
  });

  it("rechaza documentos que superan el cap de bytes", () => {
    const padding = `<g id="tall">${'<circle cx="1" cy="1" r="1"/>'.repeat(2000)}</g>`;
    const svg = validSvg(padding);
    assert.ok(new TextEncoder().encode(svg).length > MAP_SVG_MAX_BYTES);
    const res = sanitizeMapSvg(svg, 128, 128);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /KB/);
  });

  it("rechaza vacío, no-string y no-svg", () => {
    assert.equal(sanitizeMapSvg("", 128, 128).ok, false);
    assert.equal(sanitizeMapSvg(undefined, 128, 128).ok, false);
    assert.equal(sanitizeMapSvg("<div>no</div>", 128, 128).ok, false);
  });
});
