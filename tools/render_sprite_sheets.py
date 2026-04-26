#!/usr/bin/env python3
"""Pre-render Mixamo sprite sheets used by the HTML 2D client.

Drives godot/scenes/dev/sprite_sheet_renderer.tscn under xvfb-run for every
(model × animation × angle) combination requested. Output goes under
nefan-html/public/sprites/ so Vite serves it statically.

Important: the ``--angle`` value MUST match one of ai_server.sprite_generator
.ANGLE_PROMPT_FRAGMENTS so AI-generated world props share projection with the
character sprites. The angle is encoded in the output path (and the meta.json)
so HTML can pick the correct sheet for the active world angle.

Usage:
    python3 tools/render_sprite_sheets.py \
        --models paladin --anims idle walk run --angle isometric_30

    # All models × all default anims × isometric_45:
    python3 tools/render_sprite_sheets.py --angle isometric_45 --all

Run --help for every flag.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GODOT_PROJECT = REPO_ROOT / "godot"
DEFAULT_OUT = REPO_ROOT / "nefan-html" / "public" / "sprites"
DEFAULT_GODOT_BIN = Path.home() / "Downloads" / "Godot_v4.6.1-stable_linux.x86_64"

DEFAULT_MODELS = [
    "paladin",
    "eve",
    "warrok",
    "skeletonzombie",
    "arissa",
    "drake",
]
DEFAULT_ANIMS = [
    "idle",
    "walk",
    "run",
    "quick",
    "heavy",
    "medium",
    "defensive",
    "precise",
    "hit_react",
    "death",
]
SUPPORTED_ANGLES = ["top_down", "isometric_30", "isometric_45", "frontal"]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--models", nargs="+", default=None, help="Mixamo model ids (default: paladin)")
    p.add_argument("--anims", nargs="+", default=None, help="Animation ids (default: idle)")
    p.add_argument("--angle", choices=SUPPORTED_ANGLES, default="isometric_30",
                   help="Camera angle — must match ai_server's sprite angle.")
    p.add_argument("--all", action="store_true",
                   help="Render every default model × default anim combo.")
    p.add_argument("--directions", type=int, default=8, help="Facing directions per anim (default: 8)")
    p.add_argument("--width", type=int, default=256)
    p.add_argument("--height", type=int, default=256)
    p.add_argument("--fps", type=int, default=12)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT, help="Output root")
    p.add_argument("--godot", type=Path, default=DEFAULT_GODOT_BIN,
                   help="Godot binary path (default: ~/Downloads/Godot_v4.6.1-stable_linux.x86_64)")
    p.add_argument("--no-xvfb", action="store_true", help="Skip xvfb-run (only safe in CI / no display)")
    p.add_argument("--dry-run", action="store_true", help="Print commands without running")
    return p.parse_args()


def resolve_jobs(args: argparse.Namespace) -> list[tuple[str, str]]:
    if args.all:
        models = args.models or DEFAULT_MODELS
        anims = args.anims or DEFAULT_ANIMS
    else:
        models = args.models or ["paladin"]
        anims = args.anims or ["idle"]
    return [(m, a) for m in models for a in anims]


def render_one(args: argparse.Namespace, model: str, anim: str) -> bool:
    cmd: list[str] = []
    if not args.no_xvfb:
        if not shutil.which("xvfb-run"):
            print("ERROR: xvfb-run not found in PATH. Install xvfb or pass --no-xvfb.", file=sys.stderr)
            return False
        # Use the same xvfb screen size as the rest of the project (CLAUDE.md);
        # do NOT pass --headless, that flag disables 3D rendering entirely and
        # SubViewport.get_texture() then returns an empty image.
        cmd += ["xvfb-run", "-a", "-s", "-screen 0 1920x1080x24"]
    cmd += [
        str(args.godot),
        "--path", str(GODOT_PROJECT),
        "--rendering-method", "gl_compatibility",
        "res://scenes/dev/sprite_sheet_renderer.tscn",
        "--",
        "--model", model,
        "--anim", anim,
        "--angle", args.angle,
        "--out", str(args.out.resolve()),
        "--directions", str(args.directions),
        "--width", str(args.width),
        "--height", str(args.height),
        "--fps", str(args.fps),
    ]
    print("→", " ".join(cmd))
    if args.dry_run:
        return True
    completed = subprocess.run(cmd, cwd=REPO_ROOT)
    if completed.returncode != 0:
        print(f"FAIL  model={model} anim={anim} angle={args.angle} (exit {completed.returncode})")
        return False
    return True


def main() -> int:
    args = parse_args()
    if not args.godot.exists() and not args.dry_run:
        print(f"ERROR: Godot binary not found at {args.godot}", file=sys.stderr)
        return 2
    args.out.mkdir(parents=True, exist_ok=True)

    jobs = resolve_jobs(args)
    print(f"Rendering {len(jobs)} sheets at angle={args.angle}, "
          f"directions={args.directions}, fps={args.fps}, "
          f"frame={args.width}×{args.height}")
    failures: list[tuple[str, str]] = []
    for model, anim in jobs:
        if not render_one(args, model, anim):
            failures.append((model, anim))

    if failures:
        print(f"\n{len(failures)} job(s) failed:")
        for model, anim in failures:
            print(f"  {model}/{anim}")
        return 1
    print("\nAll sprite sheets rendered.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
