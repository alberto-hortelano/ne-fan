#!/usr/bin/env python3
"""Build a per-character base sprite browser inside skinning_lab/bases/<model>/.

Reads the rendered sprite sheets from `nefan-html/public/sprites/<model>/<anim>/<angle>/`,
**samples keyframes** (sprite-sheet density, not every Mixamo frame), and produces:
  - bases/<model>/<anim>/dir_<N>.gif         (looping GIF per direction, N keyframes)
  - bases/<model>/manifest.json              (anim metadata for the viewer)
  - bases/<model>/index.html                 (dropdowns: anim × direction)

Self-contained — the viewer references only files inside the bases/ tree, so
`./skinning_lab/serve.sh` is enough to inspect everything.

Why keyframes? A Disney 4-pose walk (contact-passing-contact-passing) at 8fps
captures all the motion that matters for a 2D sprite, looks crisp, and matches
what the AI skinning pipeline actually consumes (1 atlas per anim ≈ $0.18).
Showing all 13/44 Mixamo frames in the browser is misleading because it's not
what ends up in the game.

Usage:
  python3 skinning_lab/build_base_browser.py --model y_bot --angle isometric_30
  python3 skinning_lab/build_base_browser.py --model y_bot --keyframes 4 --target-fps 8
  python3 skinning_lab/build_base_browser.py --model y_bot --anims idle walk
  python3 skinning_lab/build_base_browser.py --model y_bot --full   # original Mixamo density
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

LAB_DIR = Path(__file__).resolve().parent
REPO_ROOT = LAB_DIR.parent
SPRITES_ROOT = REPO_ROOT / "nefan-html" / "public" / "sprites"

from PIL import Image  # noqa: E402


# Friendly cardinal labels for the 8 directions.
# Convention from godot/scripts/dev/sprite_sheet_renderer.gd: dir_0 faces the
# camera and the rest rotate clockwise in 45° increments around the up axis.
DIR_LABELS = {
    0: "S — frente",
    1: "SO — frente-izq",
    2: "O — perfil izq",
    3: "NO — espalda-izq",
    4: "N — espalda",
    5: "NE — espalda-der",
    6: "E — perfil der",
    7: "SE — frente-der",
}

# Per-anim sprite-sheet profile: (n_keyframes, target_loop_fps).
#
# Each tuple captures BOTH the count (sprite-sheet density) AND the playback
# speed (so the loop feels natural for that motion type, regardless of the
# Mixamo source duration). Edit this table and re-run to iterate.
#
# Reasoning per row:
#  - locomotion (walk/run): Disney 4-pose, fps = 4/original_duration → preserves duration
#  - attacks: 3-5 keyframes depending on wind-up complexity, slight speed-up (≤25%)
#    so they feel punchier than the Mixamo source
#  - idle: 4 frames of breathing at low fps to preserve the slow original feel
#  - death: 5 frames covering multi-stage fall
#  - defensive (block): just raise + hold (2 frames)
ANIM_PROFILES: dict[str, tuple[int, float]] = {
    # anim:        (n_keyframes, fps)
    "idle":        (8, 2.2),
    "walk":        (4, 3.6),
    "run":         (4, 6.0),
    "quick":       (3, 4.0),
    "heavy":       (8, 6.0),
    "medium":      (4, 3.5),
    "defensive":   (2, 3.5),
    "precise":     (6, 4.5),
    "hit_react":   (3, 4.0),
    "death":       (8, 4.0),
}
# Fallback for anims not in the table (ambient, future).
DEFAULT_PROFILE: tuple[int, float] = (4, 4.0)


def keyframe_indices(src_count: int, n: int) -> list[int]:
    """Pick n indices evenly distributed across the WHOLE cycle.
    Same algorithm as skinning_lab/run.py:keyframe_indices()."""
    if n <= 0 or src_count <= 0:
        return []
    out: list[int] = []
    for i in range(n):
        idx = int(round(i * src_count / n))
        if idx >= src_count:
            idx = src_count - 1
        if not out or idx != out[-1]:
            out.append(idx)
    return out


def discover_anims(model: str, angle: str, requested: list[str] | None) -> list[str]:
    base = SPRITES_ROOT / model
    if not base.exists():
        raise SystemExit(f"ERROR: sprites root missing: {base}")
    anims = []
    for anim_dir in sorted(base.iterdir()):
        if not anim_dir.is_dir():
            continue
        meta = anim_dir / angle / "meta.json"
        if not meta.exists():
            continue
        if requested and anim_dir.name not in requested:
            continue
        anims.append(anim_dir.name)
    if not anims:
        raise SystemExit(f"ERROR: no anims found under {base} (angle={angle})")
    return anims


def build_gif_for_dir(anim_dir: Path, direction: int, frame_indices: list[int],
                      fps: float, out_path: Path) -> int:
    """Build a looping GIF from a chosen subset of dir_{N}_frame_*.png.

    `frame_indices` selects which source frames to include (in order). `fps` is
    the playback rate of the resulting GIF — independent of the source fps."""
    frames: list[Image.Image] = []
    for i in frame_indices:
        p = anim_dir / f"dir_{direction}_frame_{i:03d}.png"
        if not p.exists():
            print(f"  WARN: missing {p.name} in {anim_dir.name}")
            continue
        frames.append(Image.open(p).convert("RGBA"))
    if not frames:
        return 0
    duration_ms = max(1, int(round(1000 / max(fps, 0.1))))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(out_path, save_all=True, append_images=frames[1:],
                   duration=duration_ms, loop=0, disposal=2)
    return len(frames)


def build_for_anim(model: str, anim: str, angle: str, out_root: Path,
                   override_keyframes: int | None = None,
                   override_fps: float | None = None,
                   full_density: bool = False) -> dict:
    """Build all 8 directional GIFs for one animation using the keyframe profile.

    Selection priority for (n, fps):
      1. CLI override (--keyframes / --target-fps)
      2. ANIM_PROFILES[anim]
      3. DEFAULT_PROFILE
    Or if `full_density=True`, use every source frame at source fps (legacy mode).
    """
    src_dir = SPRITES_ROOT / model / anim / angle
    meta = json.loads((src_dir / "meta.json").read_text())
    src_fps = int(meta["fps"])
    src_frame_count = int(meta.get("frame_count", 0))
    src_duration = float(meta.get("duration", 0))
    dirs = int(meta["directions"])

    if full_density:
        n_keyframes = src_frame_count
        play_fps: float = float(src_fps)
        indices = list(range(src_frame_count))
        mode = "full"
    else:
        n_default, fps_default = ANIM_PROFILES.get(anim, DEFAULT_PROFILE)
        n_keyframes = override_keyframes if override_keyframes is not None else n_default
        play_fps = override_fps if override_fps is not None else fps_default
        indices = keyframe_indices(src_frame_count, n_keyframes)
        mode = "keyframes"

    loop_duration_s = (len(indices) / play_fps) if play_fps > 0 else 0.0

    anim_out = out_root / anim
    per_dir = []
    for d in range(dirs):
        gif_path = anim_out / f"dir_{d}.gif"
        n_built = build_gif_for_dir(src_dir, d, indices, play_fps, gif_path)
        if n_built == 0:
            print(f"  WARN: {anim} dir {d}: no frames built")
            continue
        per_dir.append({
            "direction": d,
            "label": DIR_LABELS.get(d, f"dir {d}"),
            "frames": n_built,
            "gif": f"{anim}/dir_{d}.gif",
        })
    return {
        "anim": anim,
        "angle": angle,
        "mode": mode,
        "src_fps": src_fps,
        "src_frame_count": src_frame_count,
        "src_duration_s": src_duration,
        "keyframes": len(indices),
        "keyframe_indices": indices,
        "play_fps": play_fps,
        "loop_duration_s": round(loop_duration_s, 3),
        "directions": per_dir,
    }


_HTML = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>{model} · base + character generator</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ font: 14px system-ui, sans-serif; background: #1b1b1f; color: #e8e8ec;
         margin: 0; padding: 24px; min-height: 100vh; }}
  h1 {{ margin: 0 0 4px; font-weight: 600; }}
  h2 {{ margin: 24px 0 8px; font-weight: 500; color: #c5c5cc; }}
  h3 {{ margin: 16px 0 6px; font-weight: 500; font-size: 13px;
       text-transform: uppercase; color: #9b9ba0; letter-spacing: 1px; }}
  p.meta {{ color: #9b9ba0; margin: 4px 0 16px; }}
  .controls {{ display: flex; gap: 16px; flex-wrap: wrap; align-items: center; margin: 16px 0; }}
  .control {{ display: flex; flex-direction: column; gap: 4px; }}
  .control label {{ font-size: 11px; text-transform: uppercase; color: #9b9ba0; letter-spacing: 1px; }}
  select, button, input, textarea {{ font: inherit; background: #25252b; color: #e8e8ec;
                   border: 1px solid #2c2c34; border-radius: 6px;
                   padding: 8px 12px; max-width: 100%; }}
  /* min-width applied only at the top controls bar where we have room */
  .controls > .control select {{ min-width: 180px; }}
  select:focus, button:focus, textarea:focus, input:focus {{ outline: 2px solid #6c8cd5; }}
  button {{ cursor: pointer; }}
  button.primary {{ background: #2d4f8c; border-color: #6c8cd5; }}
  button.primary:hover {{ background: #3a609c; }}
  button:disabled {{ opacity: 0.4; cursor: not-allowed; }}
  textarea {{ width: 100%; min-height: 80px; resize: vertical; font-family: inherit; }}
  .layout {{ display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 32px; align-items: flex-start; }}
  @media (max-width: 1180px) {{ .layout {{ grid-template-columns: minmax(0, 1fr); }} }}
  .stage {{ display: flex; gap: 32px; flex-wrap: wrap; align-items: flex-start; }}
  .viewer {{ background: #0f0f12; border: 1px solid #2c2c34; border-radius: 8px;
            padding: 16px; flex-shrink: 0; }}
  .viewer img {{ width: 384px; height: 384px; image-rendering: pixelated;
                background: repeating-conic-gradient(#222 0% 25%, #2a2a2a 0% 50%) 50% / 24px 24px;
                border-radius: 4px; display: block; }}
  .info {{ flex: 1; min-width: 220px; max-width: 380px; }}
  .info code {{ background: #25252b; padding: 1px 6px; border-radius: 3px; }}
  .info .row {{ display: flex; justify-content: space-between; gap: 12px; padding: 6px 0;
               border-bottom: 1px dashed #2c2c34; }}
  .info .row:last-child {{ border-bottom: 0; }}
  .info .label {{ color: #9b9ba0; flex-shrink: 0; }}
  .info .row > span:last-child {{ text-align: right; word-break: break-word; }}
  .grid-all {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 8px; }}
  .grid-all .cell {{ background: #0f0f12; border: 1px solid #2c2c34; border-radius: 4px;
                    padding: 4px; text-align: center; cursor: pointer; }}
  .grid-all .cell.active {{ border-color: #6c8cd5; }}
  .grid-all .cell img {{ width: 100%; height: 96px; object-fit: contain; image-rendering: pixelated; }}
  .grid-all .cell .lbl {{ font-size: 10px; color: #9b9ba0; margin-top: 2px; }}
  /* Right panel: character generator */
  .gen {{ background: #0f0f12; border: 1px solid #2c2c34; border-radius: 8px;
         padding: 18px; position: sticky; top: 24px; min-width: 0; overflow: hidden; }}
  .gen h2 {{ margin: 0 0 4px; }}
  .gen-row {{ display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }}
  .gen-row > * {{ min-width: 0; }}
  .gen input[type=text], .gen select {{ flex: 1 1 140px; min-width: 0; }}
  .gen input[type=text], .gen select, .gen textarea {{ width: 100%; }}
  .gen-stack {{ display: flex; flex-direction: column; gap: 8px; }}
  .hero-frame {{ width: 100%; aspect-ratio: 1; background: repeating-conic-gradient(#222 0% 25%, #2a2a2a 0% 50%) 50% / 16px 16px;
                border: 1px solid #2c2c34; border-radius: 6px;
                display: flex; align-items: center; justify-content: center;
                color: #6c6c75; font-size: 12px; margin: 8px 0; overflow: hidden; }}
  .hero-frame img {{ width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }}
  .history {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 6px 0; }}
  .history img {{ width: 100%; aspect-ratio: 1; object-fit: contain; image-rendering: pixelated;
                 background: #25252b; border: 1px solid #2c2c34; border-radius: 3px; cursor: pointer; }}
  .history img:hover {{ border-color: #6c8cd5; }}
  .anim-list {{ display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }}
  .anim-list label {{ display: flex; align-items: center; gap: 6px; font-size: 12px;
                     padding: 4px 6px; background: #25252b; border-radius: 4px; cursor: pointer;
                     min-width: 0; }}
  .anim-list label span {{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
  .dir-list {{ display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0; }}
  .dir-list label {{ font-size: 12px; padding: 4px 8px; background: #25252b;
                    border-radius: 4px; cursor: pointer; }}
  .row-end {{ display: flex; gap: 8px; align-items: center; justify-content: space-between;
             flex-wrap: wrap; margin-top: 10px; }}
  .cost {{ color: #e8b86c; font-weight: 500; font-variant-numeric: tabular-nums; }}
  .log {{ font-family: monospace; font-size: 11px; color: #9b9ba0;
         max-height: 140px; overflow-y: auto; background: #25252b;
         padding: 6px 8px; border-radius: 4px; margin-top: 12px; white-space: pre-wrap; }}
  .log > div {{ padding: 2px 0; }}
  .log .ok {{ color: #8aca8a; }}
  .log .err {{ color: #ca8a8a; }}
  hr {{ border: 0; border-top: 1px solid #2c2c34; margin: 18px 0; }}
  .gen-section {{ margin-top: 6px; }}
  .small {{ font-size: 11px; color: #6c6c75; }}
</style>
</head>
<body>
  <h1>{model} · base + character generator</h1>
  <p class="meta">
    Sprites Mixamo renderizados, densidad sprite-sheet 2D (Disney 4-pose, etc.).
    Panel derecho: enfoque A — hero-shot anchor para consistencia entre animaciones.
    <br>Ángulo: <code>{angle}</code> · {n_anims} anims · 8 dirs
  </p>

  <div class="controls">
    <div class="control">
      <label for="character">vista</label>
      <select id="character"><option value="__base__">base ({model})</option></select>
    </div>
    <div class="control">
      <label for="anim">animación</label>
      <select id="anim"></select>
    </div>
    <div class="control">
      <label for="dir">dirección</label>
      <select id="dir"></select>
    </div>
    <div class="control">
      <label>&nbsp;</label>
      <button id="prev-anim">← anim</button>
    </div>
    <div class="control">
      <label>&nbsp;</label>
      <button id="next-anim">anim →</button>
    </div>
  </div>

  <div class="layout">
    <div>
      <div class="stage">
        <div class="viewer">
          <img id="player" alt="">
        </div>
        <div class="info">
          <div class="row"><span class="label">vista</span><span id="info-character"></span></div>
          <div class="row"><span class="label">animación</span><span id="info-anim"></span></div>
          <div class="row"><span class="label">dirección</span><span id="info-dir"></span></div>
          <div class="row"><span class="label">keyframes</span><span id="info-keyframes"></span></div>
          <div class="row"><span class="label">índices Mixamo</span><span id="info-indices"></span></div>
          <div class="row"><span class="label">fps loop</span><span id="info-fps"></span></div>
          <div class="row"><span class="label">duración loop</span><span id="info-dur"></span></div>
          <div class="row"><span class="label">original Mixamo</span><span id="info-original"></span></div>
        </div>
      </div>

      <h2>Las 8 direcciones de esta animación</h2>
      <div class="grid-all" id="grid-all"></div>
    </div>

    <!-- Character generator -->
    <aside class="gen">
      <h2>Generador de personajes</h2>

      <h3>1 · Personaje</h3>
      <div class="gen-stack">
        <input type="text" id="char-name" placeholder="nombre (ej: campesino_arapiento)">
        <select id="char-model">
          <option value="nano-banana-pro" selected>banana-pro · $0.18 / img</option>
          <option value="nano-banana-2">banana-2 · $0.12 / img</option>
          <option value="nano-banana">banana · $0.06 / img</option>
        </select>
        <textarea id="char-prompt" placeholder="describe al personaje: 'campesino arapiento, andrajos marrones, capucha tosca, cara sucia, sin armadura, mismo encuadre y misma pose'"></textarea>
      </div>

      <div class="row-end">
        <span class="cost">hero-shot: <span id="cost-hero">$0.18</span></span>
        <div class="gen-row">
          <button id="btn-upload" type="button" title="subir imagen ya hecha — sin coste">subir imagen</button>
          <button id="btn-hero" class="primary">generar</button>
        </div>
      </div>
      <input type="file" id="hero-upload" accept="image/png,image/jpeg,image/webp" style="display:none">
      <p class="small" style="margin:4px 0 0">
        "subir" pone la imagen como hero-shot sin pasar por Meshy (gratis).
        "generar" hace img2img desde el frame T-pose de Y Bot.
      </p>

      <h3>Hero-shot actual</h3>
      <div class="hero-frame" id="hero-frame">(sin referencia)</div>
      <h3>Historial (clic para restaurar)</h3>
      <div class="history" id="history"></div>

      <hr>
      <h3>2 · Animaciones a generar</h3>
      <div class="anim-list" id="anim-list"></div>

      <h3>Direcciones</h3>
      <div class="dir-list" id="dir-list"></div>
      <div class="gen-row">
        <button id="btn-dirs-all" type="button">todas</button>
        <button id="btn-dirs-front" type="button">sólo dir 0</button>
        <button id="btn-dirs-cardinal" type="button">cardinales</button>
      </div>

      <div class="row-end">
        <span class="cost">total: <span id="cost-skin">$0.00</span></span>
        <button id="btn-skin" class="primary" disabled>skin animations</button>
      </div>

      <div class="log" id="log"><div>listo.</div></div>
    </aside>
  </div>

  <p class="meta" style="margin-top:32px">
    <a href="../../index.html" style="color:#6c8cd5">← skinning_lab</a>
  </p>

<script>
const MANIFEST = {manifest_json};
const BASE_LABEL = "base ({model})";
const animSel = document.getElementById('anim');
const dirSel = document.getElementById('dir');
const player = document.getElementById('player');
const charSel = document.getElementById('character');
const gridAll = document.getElementById('grid-all');
const charName = document.getElementById('char-name');
const charPrompt = document.getElementById('char-prompt');
const charModel = document.getElementById('char-model');
const heroFrame = document.getElementById('hero-frame');
const historyDiv = document.getElementById('history');
const animList = document.getElementById('anim-list');
const dirList = document.getElementById('dir-list');
const log = document.getElementById('log');
const btnHero = document.getElementById('btn-hero');
const btnSkin = document.getElementById('btn-skin');
const costHero = document.getElementById('cost-hero');
const costSkin = document.getElementById('cost-skin');

const MODEL_PRICES = {{ "nano-banana": 0.06, "nano-banana-2": 0.12, "nano-banana-pro": 0.18 }};

// Per-character skinned overlays. Map character_slug → {{ anim: {{ direction: gif_url }} }}
let CHARACTERS = {{}};
let activeCharacter = "__base__";  // "__base__" or character slug

function logLine(text, cls) {{
  const span = document.createElement('div');
  if (cls) span.className = cls;
  span.textContent = `${{new Date().toLocaleTimeString()}} · ${{text}}`;
  log.appendChild(span);
  log.scrollTop = log.scrollHeight;
}}

// Animation dropdown init
for (const a of MANIFEST.anims) {{
  const opt = document.createElement('option');
  opt.value = a.anim;
  opt.textContent = `${{a.anim}} (${{a.keyframes}}f @ ${{a.play_fps.toFixed(1)}}fps · ${{a.loop_duration_s.toFixed(2)}}s)`;
  animSel.appendChild(opt);
}}

// Anim multi-select
for (const a of MANIFEST.anims) {{
  const lbl = document.createElement('label');
  lbl.innerHTML = `<input type="checkbox" value="${{a.anim}}" data-cost-mult="1"> ${{a.anim}}`;
  animList.appendChild(lbl);
}}

// Direction checkboxes
for (let d = 0; d < 8; d++) {{
  const lbl = document.createElement('label');
  lbl.innerHTML = `<input type="checkbox" value="${{d}}" checked> ${{d}}`;
  dirList.appendChild(lbl);
}}

function getSelectedAnims() {{
  return Array.from(animList.querySelectorAll('input:checked')).map(c => c.value);
}}
function getSelectedDirs() {{
  return Array.from(dirList.querySelectorAll('input:checked')).map(c => parseInt(c.value));
}}
function updateCost() {{
  const price = MODEL_PRICES[charModel.value];
  costHero.textContent = '$' + price.toFixed(2);
  const anims = getSelectedAnims();
  const dirs = getSelectedDirs();
  const total = anims.length * dirs.length * price;
  costSkin.textContent = '$' + total.toFixed(2);
  btnSkin.disabled = !(anims.length && dirs.length && hasHeroShot());
}}

function hasHeroShot() {{
  const slug = activeCharacter !== "__base__" ? activeCharacter : null;
  if (slug && CHARACTERS[slug]?.hero_shot_url) return true;
  return Boolean(heroFrame.dataset.url);
}}

charModel.addEventListener('change', updateCost);
animList.addEventListener('change', updateCost);
dirList.addEventListener('change', updateCost);

document.getElementById('btn-dirs-all').onclick = () => {{
  dirList.querySelectorAll('input').forEach(c => c.checked = true);
  updateCost();
}};
document.getElementById('btn-dirs-front').onclick = () => {{
  dirList.querySelectorAll('input').forEach((c, i) => c.checked = (i === 0));
  updateCost();
}};
document.getElementById('btn-dirs-cardinal').onclick = () => {{
  dirList.querySelectorAll('input').forEach((c, i) => c.checked = ([0,2,4,6].includes(i)));
  updateCost();
}};

function setHeroShot(url, history) {{
  if (url) {{
    heroFrame.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    heroFrame.appendChild(img);
    heroFrame.dataset.url = url;
  }} else {{
    heroFrame.innerHTML = '(sin referencia)';
    delete heroFrame.dataset.url;
  }}
  historyDiv.innerHTML = '';
  for (const h of (history || [])) {{
    const img = document.createElement('img');
    img.src = h;
    img.title = h.split('/').pop();
    img.onclick = () => {{ heroFrame.innerHTML = ''; const i2 = document.createElement('img'); i2.src = h; heroFrame.appendChild(i2); heroFrame.dataset.url = h; updateCost(); }};
    historyDiv.appendChild(img);
  }}
  updateCost();
}}

async function loadCharacters() {{
  try {{
    const r = await fetch('/api/characters');
    if (!r.ok) return;
    const list = await r.json();
    CHARACTERS = {{}};
    // Rebuild dropdown
    charSel.innerHTML = '';
    const baseOpt = document.createElement('option');
    baseOpt.value = '__base__';
    baseOpt.textContent = BASE_LABEL;
    charSel.appendChild(baseOpt);
    for (const c of list) {{
      // Map skinned anims+dirs into URL lookup
      const skinned = {{}};
      for (const anim of c.skinned_anims) {{
        skinned[anim] = {{}};
      }}
      CHARACTERS[c.slug] = {{
        name: c.name, slug: c.slug, prompt: c.prompt,
        hero_shot_url: c.hero_shot_url, skinned,
      }};
      const opt = document.createElement('option');
      opt.value = c.slug;
      opt.textContent = c.name + (c.skinned_anims.length ? ` (${{c.skinned_anims.length}} anims)` : ' (sólo hero-shot)');
      charSel.appendChild(opt);
    }}
    if (activeCharacter !== '__base__' && !CHARACTERS[activeCharacter]) {{
      activeCharacter = '__base__';
    }}
    charSel.value = activeCharacter;
  }} catch (e) {{
    logLine('error /api/characters: ' + e, 'err');
  }}
}}

charSel.onchange = () => {{
  activeCharacter = charSel.value;
  if (activeCharacter !== '__base__') {{
    const c = CHARACTERS[activeCharacter];
    if (c) {{
      charName.value = c.slug;
      charPrompt.value = c.prompt || '';
      setHeroShot(c.hero_shot_url, []);
    }}
  }} else {{
    setHeroShot(null, []);
  }}
  update();
}};

const btnUpload = document.getElementById('btn-upload');
const heroUpload = document.getElementById('hero-upload');

btnUpload.onclick = () => {{
  const name = (charName.value || '').trim();
  if (!name) {{ alert('pon un nombre al personaje primero'); return; }}
  heroUpload.click();
}};

heroUpload.onchange = async () => {{
  const file = heroUpload.files[0];
  if (!file) return;
  const name = (charName.value || '').trim();
  if (!name) {{ alert('pon un nombre al personaje'); return; }}
  const fd = new FormData();
  fd.append('file', file);
  logLine(`subiendo ${{file.name}}...`);
  btnUpload.disabled = true;
  try {{
    const r = await fetch(`/api/characters/${{encodeURIComponent(name)}}/hero_shot/upload`, {{
      method: 'POST', body: fd,
    }});
    if (!r.ok) {{
      logLine(`HTTP ${{r.status}}: ${{await r.text()}}`, 'err');
      return;
    }}
    const data = await r.json();
    setHeroShot(data.hero_shot_url, data.history);
    logLine(`✓ subido: ${{file.name}}`, 'ok');
    await loadCharacters();
    activeCharacter = data.character;
    charSel.value = data.character;
    update();
  }} catch (e) {{
    logLine('error: ' + e, 'err');
  }} finally {{
    btnUpload.disabled = false;
    heroUpload.value = '';
  }}
}};

btnHero.onclick = async () => {{
  const name = (charName.value || '').trim();
  const prompt = (charPrompt.value || '').trim();
  if (!name) {{ alert('pon un nombre al personaje'); return; }}
  if (prompt.length < 4) {{ alert('el prompt necesita al menos 4 caracteres'); return; }}
  btnHero.disabled = true;
  logLine(`generando hero-shot para "${{name}}"...`);
  try {{
    const r = await fetch(`/api/characters/${{encodeURIComponent(name)}}/hero_shot`, {{
      method: 'POST', headers: {{'Content-Type':'application/json'}},
      body: JSON.stringify({{ prompt, model: charModel.value }}),
    }});
    if (!r.ok) {{
      const t = await r.text();
      logLine(`HTTP ${{r.status}}: ${{t}}`, 'err');
      return;
    }}
    const data = await r.json();
    setHeroShot(data.hero_shot_url, data.history);
    logLine(`✓ hero-shot listo · ${{data.cost_usd.toFixed(2)}}$ · ${{data.latency_s}}s`, 'ok');
    await loadCharacters();
    activeCharacter = data.character;
    charSel.value = data.character;
    update();
  }} catch (e) {{
    logLine('error: ' + e, 'err');
  }} finally {{
    btnHero.disabled = false;
  }}
}};

btnSkin.onclick = async () => {{
  const slug = activeCharacter !== '__base__' ? activeCharacter : (charName.value || '').trim();
  if (!slug) {{ alert('selecciona o crea un personaje primero'); return; }}
  const anims = getSelectedAnims();
  const dirs = getSelectedDirs();
  if (!anims.length || !dirs.length) {{ alert('selecciona al menos una anim y una dirección'); return; }}
  btnSkin.disabled = true;
  logLine(`skinning ${{anims.length}} anims × ${{dirs.length}} dirs (${{anims.length*dirs.length}} llamadas)...`);
  try {{
    const r = await fetch(`/api/characters/${{encodeURIComponent(slug)}}/skin`, {{
      method: 'POST', headers: {{'Content-Type':'application/json'}},
      body: JSON.stringify({{ anims, directions: dirs, model: charModel.value }}),
    }});
    if (!r.ok) {{
      const t = await r.text();
      logLine(`HTTP ${{r.status}}: ${{t}}`, 'err');
      return;
    }}
    const data = await r.json();
    let nOk = 0, nErr = 0;
    for (const res of data.results) {{
      if (res.ok) {{
        nOk++;
        // Stash in CHARACTERS for view swap
        if (!CHARACTERS[data.character]) CHARACTERS[data.character] = {{ slug: data.character, skinned: {{}} }};
        if (!CHARACTERS[data.character].skinned[res.anim]) CHARACTERS[data.character].skinned[res.anim] = {{}};
        CHARACTERS[data.character].skinned[res.anim][res.direction] = res.gif_url;
      }} else {{
        nErr++;
        logLine(`✗ ${{res.anim}} dir ${{res.direction}}: ${{res.error}}`, 'err');
      }}
    }}
    logLine(`✓ ${{nOk}} OK / ${{nErr}} fail · total ${{data.total_cost_usd.toFixed(2)}}$`, 'ok');
    await loadCharacters();
    activeCharacter = data.character;
    charSel.value = data.character;
    // Re-stash skinned URLs (loadCharacters wipes them)
    for (const res of data.results) {{
      if (res.ok) {{
        if (!CHARACTERS[data.character].skinned) CHARACTERS[data.character].skinned = {{}};
        if (!CHARACTERS[data.character].skinned[res.anim]) CHARACTERS[data.character].skinned[res.anim] = {{}};
        CHARACTERS[data.character].skinned[res.anim][res.direction] = res.gif_url;
      }}
    }}
    update();
  }} catch (e) {{
    logLine('error: ' + e, 'err');
  }} finally {{
    btnSkin.disabled = false;
    updateCost();
  }}
}};

function gifUrlForDir(animName, direction) {{
  // Resolve URL based on active character
  if (activeCharacter !== '__base__') {{
    const c = CHARACTERS[activeCharacter];
    const skinnedAnim = c?.skinned?.[animName];
    if (skinnedAnim && skinnedAnim[direction]) return skinnedAnim[direction];
    // If anim folder exists but no direct URL, try the canonical (absolute) path
    if (c?.skinned && Object.prototype.hasOwnProperty.call(c.skinned, animName)) {{
      return `/characters/${{c.slug}}/skinned/${{animName}}/dir_${{direction}}.gif?t=` + Date.now();
    }}
  }}
  const anim = MANIFEST.anims.find(x => x.anim === animName);
  const dir = anim?.directions?.find(d => d.direction === direction);
  return dir?.gif;  // these are relative to /bases/<model>/, OK because the page lives there
}}

function update() {{
  const animName = animSel.value;
  const anim = MANIFEST.anims.find(x => x.anim === animName);
  if (!anim) return;
  const prevDir = parseInt(dirSel.value || '0');
  dirSel.innerHTML = '';
  for (const d of anim.directions) {{
    const opt = document.createElement('option');
    opt.value = d.direction;
    opt.textContent = `${{d.direction}} · ${{d.label}}`;
    dirSel.appendChild(opt);
  }}
  const dirIdx = anim.directions.findIndex(d => d.direction === prevDir);
  dirSel.value = dirIdx >= 0 ? prevDir : (anim.directions[0]?.direction ?? 0);
  const dir = anim.directions.find(d => d.direction === parseInt(dirSel.value));
  if (!dir) return;
  const url = gifUrlForDir(anim.anim, dir.direction);
  player.src = url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now();
  document.getElementById('info-character').textContent = activeCharacter === '__base__' ? BASE_LABEL : (CHARACTERS[activeCharacter]?.name || activeCharacter);
  document.getElementById('info-anim').textContent = anim.anim;
  document.getElementById('info-dir').textContent = `${{dir.direction}} (${{dir.label}})`;
  document.getElementById('info-keyframes').textContent = anim.keyframes;
  document.getElementById('info-indices').textContent = '[' + anim.keyframe_indices.join(', ') + ']';
  document.getElementById('info-fps').textContent = anim.play_fps.toFixed(2);
  document.getElementById('info-dur').textContent = anim.loop_duration_s.toFixed(2) + ' s';
  document.getElementById('info-original').textContent =
      `${{anim.src_frame_count}}f / ${{anim.src_duration_s.toFixed(2)}}s @ ${{anim.src_fps}}fps`;
  gridAll.innerHTML = '';
  for (const d of anim.directions) {{
    const cell = document.createElement('div');
    cell.className = 'cell' + (d.direction === dir.direction ? ' active' : '');
    const u = gifUrlForDir(anim.anim, d.direction);
    cell.innerHTML = `<img src="${{u}}"><div class="lbl">${{d.direction}} · ${{d.label}}</div>`;
    cell.onclick = () => {{ dirSel.value = d.direction; update(); }};
    gridAll.appendChild(cell);
  }}
}}

animSel.onchange = update;
dirSel.onchange = update;
document.getElementById('prev-anim').onclick = () => {{
  const i = animSel.selectedIndex;
  animSel.selectedIndex = (i - 1 + MANIFEST.anims.length) % MANIFEST.anims.length;
  update();
}};
document.getElementById('next-anim').onclick = () => {{
  const i = animSel.selectedIndex;
  animSel.selectedIndex = (i + 1) % MANIFEST.anims.length;
  update();
}};

document.addEventListener('keydown', (e) => {{
  if (['SELECT','TEXTAREA','INPUT'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowRight') {{ animSel.selectedIndex = (animSel.selectedIndex + 1) % animSel.options.length; update(); }}
  else if (e.key === 'ArrowLeft') {{ animSel.selectedIndex = (animSel.selectedIndex - 1 + animSel.options.length) % animSel.options.length; update(); }}
  else if (e.key === 'ArrowUp') {{ dirSel.selectedIndex = (dirSel.selectedIndex - 1 + dirSel.options.length) % dirSel.options.length; update(); }}
  else if (e.key === 'ArrowDown') {{ dirSel.selectedIndex = (dirSel.selectedIndex + 1) % dirSel.options.length; update(); }}
}});

loadCharacters().then(update);
updateCost();
</script>
</body>
</html>
"""


def render_index_html(model: str, angle: str, manifest: dict, out_path: Path) -> None:
    out_path.write_text(_HTML.format(
        model=model,
        angle=angle,
        n_anims=len(manifest["anims"]),
        manifest_json=json.dumps(manifest),
    ))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True, help="model id (e.g. y_bot, paladin)")
    p.add_argument("--angle", default="isometric_30", help="camera angle subdir")
    p.add_argument("--anims", nargs="*", default=None,
                   help="restrict to these anim ids (default: all rendered for this model)")
    p.add_argument("--out", type=Path, default=None,
                   help="override output dir (default: skinning_lab/bases/<model>)")
    p.add_argument("--keyframes", type=int, default=None,
                   help="override keyframe count for ALL anims (default: per-anim from ANIM_PROFILES)")
    p.add_argument("--target-fps", type=float, default=None,
                   help="override loop fps for ALL anims (default: per-anim from ANIM_PROFILES)")
    p.add_argument("--full", action="store_true",
                   help="legacy: every Mixamo source frame at source fps (no reduction)")
    args = p.parse_args()

    out_root = args.out or (LAB_DIR / "bases" / args.model)
    out_root.mkdir(parents=True, exist_ok=True)

    anims = discover_anims(args.model, args.angle, args.anims)
    mode_str = "FULL Mixamo density" if args.full else \
               (f"override n={args.keyframes} fps={args.target_fps}" if args.keyframes or args.target_fps
                else "per-anim ANIM_PROFILES")
    print(f"Building base browser for {args.model} · {args.angle} · {len(anims)} anims · {mode_str}")

    manifest_anims = []
    for anim in anims:
        info = build_for_anim(
            args.model, anim, args.angle, out_root,
            override_keyframes=args.keyframes,
            override_fps=args.target_fps,
            full_density=args.full,
        )
        idxs = info["keyframe_indices"]
        print(f"  · {anim:11} {info['keyframes']}f @ {info['play_fps']:.2f}fps "
              f"loop={info['loop_duration_s']:.2f}s "
              f"(from {info['src_frame_count']}f/{info['src_duration_s']:.2f}s) "
              f"indices={idxs}")
        manifest_anims.append(info)

    manifest = {
        "model": args.model,
        "angle": args.angle,
        "mode": "full" if args.full else "keyframes",
        "anims": manifest_anims,
    }
    (out_root / "manifest.json").write_text(json.dumps(manifest, indent=2))

    index_path = out_root / "index.html"
    render_index_html(args.model, args.angle, manifest, index_path)
    print(f"\n✓ {index_path}")
    print(f"  serve: ./skinning_lab/serve.sh → http://localhost:8911/bases/{args.model}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
