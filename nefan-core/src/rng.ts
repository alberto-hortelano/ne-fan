/** Deterministic randomness utilities — engine-neutral (no node:crypto, runs
 *  in the browser too). Shared by combat AI, scene expansion, blueprint
 *  detail, NPC behavior and the plugin DSL. */

/** Simple seeded PRNG (xoshiro128) for deterministic replay */
export class SeededRng {
  private s: Uint32Array;

  constructor(seed: number = Date.now()) {
    this.s = new Uint32Array(4);
    this.s[0] = seed >>> 0;
    this.s[1] = (seed * 1812433253 + 1) >>> 0;
    this.s[2] = (this.s[1] * 1812433253 + 1) >>> 0;
    this.s[3] = (this.s[2] * 1812433253 + 1) >>> 0;
  }

  next(): number {
    const result = (this.s[0] + this.s[3]) >>> 0;
    const t = (this.s[1] << 9) >>> 0;
    this.s[2] ^= this.s[0];
    this.s[3] ^= this.s[1];
    this.s[1] ^= this.s[2];
    this.s[0] ^= this.s[3];
    this.s[2] ^= t;
    this.s[3] = ((this.s[3] << 11) | (this.s[3] >>> 21)) >>> 0;
    return (result >>> 0) / 4294967296;
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

/** Hash FNV-1a de 32 bits — determinista, para sembrar SeededRng desde claves
 *  estables (tileKey, scene_id, volume id…). */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** RNG determinista sembrado por clave estable. */
export function seededRng(seedKey: string): SeededRng {
  return new SeededRng(fnv1a(seedKey));
}
