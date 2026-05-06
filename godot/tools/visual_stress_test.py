#!/usr/bin/env python3
"""Visual stress test for the room generation system.

Tests 7 rooms of increasing complexity, capturing screenshots from
multiple angles before and after AI textures load.

Usage:
    python godot/tools/visual_stress_test.py              # run all levels
    python godot/tools/visual_stress_test.py 1 3 5         # run specific levels
    python godot/tools/visual_stress_test.py --no-textures # skip texture wait

Requires:
    - Godot running with remote control on :9876
    - AI server on :8765 (for texture generation; optional with --no-textures)

Output: /tmp/visual_stress_test/{room_name}/ screenshots + report.md
"""

import socket
import json
import time
import sys
import os
import datetime

HOST = "127.0.0.1"
PORT = 9876
OUTPUT_DIR = "/tmp/visual_stress_test"
TEXTURE_POLL_INTERVAL = 2.0
TEXTURE_TIMEOUT = 120.0


def send_cmd(cmd: dict, timeout: float = 5.0) -> dict:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    sock.connect((HOST, PORT))
    sock.sendall((json.dumps(cmd) + "\n").encode())
    data = b""
    while True:
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk
        if b"\n" in data or len(data) > 10000:
            break
    sock.close()
    try:
        return json.loads(data.decode().strip())
    except json.JSONDecodeError:
        return {"raw": data.decode()}


def screenshot(name: str, room_name: str) -> str:
    path = os.path.join(OUTPUT_DIR, room_name, f"{name}.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    result = send_cmd({"cmd": "screenshot", "path": path})
    if result.get("ok"):
        return path
    print(f"    [WARN] Screenshot failed: {result}")
    return ""


def detach_camera(pos: dict):
    send_cmd({"cmd": "camera_detach", **pos})
    time.sleep(0.4)


def wait_for_textures() -> tuple[float, int]:
    """Poll texture_status until pending=0. Returns (wait_time_s, peak_pending)."""
    start = time.time()
    peak = 0
    while True:
        elapsed = time.time() - start
        if elapsed > TEXTURE_TIMEOUT:
            print(f"    [WARN] Texture timeout after {TEXTURE_TIMEOUT}s")
            return elapsed, peak
        result = send_cmd({"cmd": "texture_status"})
        pending = result.get("pending_textures", -1)
        if pending == -1:
            print("    [WARN] texture_status command not available")
            time.sleep(10)
            return time.time() - start, 0
        peak = max(peak, pending)
        if pending == 0:
            # Extra wait for sprites/models to finish
            time.sleep(3)
            return time.time() - start, peak
        print(f"    Textures pending: {pending} ({elapsed:.1f}s)", end="\r")
        time.sleep(TEXTURE_POLL_INTERVAL)


# ─── Room Definitions ───

LEVELS = [
    {
        "level": 1,
        "name": "stress_01_celda",
        "title": "Celda Simple",
        "path": "res://test_rooms/stress/stress_01_celda.json",
        "description": "Sala 5x3x5, 2 objetos, 1 luz. Baseline.",
        "cameras": {
            "corner_overview":  {"x": 3, "y": 2.5, "z": 3, "yaw": -135, "pitch": -0.3},
            "exit_view":        {"x": 0, "y": 1.5, "z": 3, "yaw": 0, "pitch": -0.1},
            "top_down":         {"x": 0, "y": 4.5, "z": 0, "yaw": 0, "pitch": -1.45},
            "object_closeup":   {"x": -0.5, "y": 1.0, "z": -1.0, "yaw": 145, "pitch": -0.05},
        },
    },
    {
        "level": 2,
        "name": "stress_02_cripta",
        "title": "Cripta",
        "path": "res://test_rooms/stress/stress_02_cripta.json",
        "description": "Sala 10x4x8, 4 objetos, 1 NPC, 3 luces, 1 generate_3d.",
        "cameras": {
            "wide_establishing": {"x": 0, "y": 3, "z": 5, "yaw": 0, "pitch": -0.25},
            "pillar_detail":     {"x": -1.5, "y": 1.5, "z": 0, "yaw": 60, "pitch": -0.1},
            "sarcophagus_npc":   {"x": 2, "y": 1.5, "z": -1, "yaw": -120, "pitch": -0.15},
            "lighting_atmos":    {"x": 0, "y": 1.0, "z": 1, "yaw": 0, "pitch": 0.1},
        },
    },
    {
        "level": 3,
        "name": "stress_03_taberna",
        "title": "Taberna",
        "path": "res://test_rooms/stress/stress_03_taberna.json",
        "description": "Sala 14x3.5x10, 6 objetos, 1 NPC, 4 luces, 1 generate_3d.",
        "cameras": {
            "entry_view":        {"x": 0, "y": 2.0, "z": 5.5, "yaw": 0, "pitch": -0.15},
            "bar_area":          {"x": 4.0, "y": 1.5, "z": -1.0, "yaw": -30, "pitch": -0.1},
            "fireplace_closeup": {"x": -4.0, "y": 1.2, "z": -2.0, "yaw": -110, "pitch": -0.05},
            "table_detail":      {"x": -1.0, "y": 1.3, "z": 1.5, "yaw": 160, "pitch": -0.2},
        },
    },
    {
        "level": 4,
        "name": "stress_04_catedral",
        "title": "Catedral",
        "path": "res://test_rooms/stress/stress_04_catedral.json",
        "description": "Sala 20x8x20, 8 objetos, 2 NPCs, 6 luces (3 spot), 1 generate_3d.",
        "cameras": {
            "grand_entry":       {"x": 0, "y": 2.0, "z": 11, "yaw": 0, "pitch": -0.1},
            "altar_colored":     {"x": 0, "y": 3.0, "z": -3, "yaw": 0, "pitch": -0.15},
            "pillar_row_side":   {"x": -9, "y": 2.0, "z": 0, "yaw": 90, "pitch": 0.1},
            "top_down":          {"x": 0, "y": 10, "z": 0, "yaw": 0, "pitch": -1.45},
        },
    },
    {
        "level": 5,
        "name": "stress_05_claro_bosque",
        "title": "Claro del Bosque (outdoor)",
        "path": "res://test_rooms/stress/stress_05_claro_bosque.json",
        "description": "Sala 25x8x25, 8 objetos, 1 NPC. Techo=cielo, paredes=bosque.",
        "cameras": {
            "entry_panoramic":   {"x": 0, "y": 2.5, "z": 13, "yaw": 0, "pitch": -0.05},
            "campfire_closeup":  {"x": 2.0, "y": 1.3, "z": 1.5, "yaw": -150, "pitch": -0.1},
            "wall_ceiling_seam": {"x": -10, "y": 4, "z": 0, "yaw": 80, "pitch": 0.2},
            "rock_area":         {"x": 10, "y": 1.5, "z": -5, "yaw": -130, "pitch": -0.1},
        },
    },
    {
        "level": 6,
        "name": "stress_06_ruinas",
        "title": "Ruinas al Aire Libre",
        "path": "res://test_rooms/stress/stress_06_ruinas.json",
        "description": "Sala 25x8x25, 10 objetos, 1 NPC, torus mesh, mezcla interior/exterior.",
        "cameras": {
            "grand_ruin_view":   {"x": 0, "y": 3, "z": 13, "yaw": 0, "pitch": -0.05},
            "well_interior":     {"x": -2, "y": 1.5, "z": 2, "yaw": 20, "pitch": -0.1},
            "sky_wall_junction": {"x": 10, "y": 5, "z": 0, "yaw": -90, "pitch": 0.3},
            "ground_detail":     {"x": 0, "y": 0.8, "z": 0.5, "yaw": 0, "pitch": -0.4},
        },
    },
    {
        "level": 7,
        "name": "stress_07_batalla",
        "title": "Campo de Batalla (max stress)",
        "path": "res://test_rooms/stress/stress_07_batalla.json",
        "description": "Sala 25x8x25, 10 objetos (3 criaturas), 3 NPCs, 6 luces, 4 salidas.",
        "cameras": {
            "battlefield_pan":   {"x": 0, "y": 4, "z": 13, "yaw": 0, "pitch": -0.15},
            "combat_zone":       {"x": 0, "y": 2, "z": -4, "yaw": 0, "pitch": -0.05},
            "npc_chaos":         {"x": 5, "y": 1.5, "z": 7, "yaw": -150, "pitch": -0.1},
            "detail_corner":     {"x": 10, "y": 1.3, "z": -9, "yaw": -150, "pitch": -0.1},
        },
    },
]


def run_level(level_cfg: dict, skip_textures: bool = False) -> dict:
    """Run a single level test. Returns timing/results dict."""
    name = level_cfg["name"]
    title = level_cfg["title"]
    cameras = level_cfg["cameras"]

    print(f"\n{'='*60}")
    print(f"  Level {level_cfg['level']}: {title}")
    print(f"  {level_cfg['description']}")
    print(f"{'='*60}")

    result = {
        "level": level_cfg["level"],
        "name": name,
        "title": title,
        "load_time_s": 0,
        "texture_wait_s": 0,
        "peak_pending": 0,
        "fps": 0,
        "screenshots": [],
        "errors": [],
    }

    # Load room
    print(f"  Loading {level_cfg['path']}...")
    t0 = time.time()
    resp = send_cmd({"cmd": "load_room_path", "path": level_cfg["path"]})
    if not resp.get("ok"):
        error = f"Failed to load room: {resp}"
        print(f"  [ERROR] {error}")
        result["errors"].append(error)
        return result
    time.sleep(1.5)  # Wait for geometry build
    result["load_time_s"] = round(time.time() - t0, 2)
    print(f"  Room loaded in {result['load_time_s']}s")

    # Teleport player to safe position
    send_cmd({"cmd": "teleport", "x": 0, "y": 0.5, "z": 4})
    time.sleep(0.3)

    # Phase 1: Primitive screenshots (before textures)
    print("  Capturing primitive phase...")
    for cam_name, cam_pos in cameras.items():
        detach_camera(cam_pos)
        path = screenshot(f"{cam_name}_primitive", name)
        if path:
            result["screenshots"].append(path)

    # Phase 2: Wait for textures
    if not skip_textures:
        print("  Waiting for textures...")
        tex_time, peak = wait_for_textures()
        result["texture_wait_s"] = round(tex_time, 2)
        result["peak_pending"] = peak
        print(f"  Textures done in {result['texture_wait_s']}s (peak pending: {peak})")

        # Phase 3: Textured screenshots
        print("  Capturing textured phase...")
        for cam_name, cam_pos in cameras.items():
            detach_camera(cam_pos)
            path = screenshot(f"{cam_name}_textured", name)
            if path:
                result["screenshots"].append(path)

    # Get FPS
    status = send_cmd({"cmd": "status"})
    result["fps"] = status.get("fps", 0)
    result["room_confirmed"] = status.get("room", "unknown")
    print(f"  FPS: {result['fps']}, Room: {result['room_confirmed']}")

    # Reattach camera
    send_cmd({"cmd": "camera_attach"})

    return result


def generate_report(results: list[dict]):
    """Generate markdown report."""
    report_path = os.path.join(OUTPUT_DIR, "report.md")
    timing_path = os.path.join(OUTPUT_DIR, "timing.json")

    lines = []
    lines.append("# Visual Stress Test Results")
    lines.append(f"Date: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("System: Never Ending Fantasy — Room Generation")
    lines.append("AI Server: SD 1.5 + LCM-LoRA, 512x512, 4 steps")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("| Level | Room | Load | Tex Time | Peak Pending | FPS | Errors |")
    lines.append("|-------|------|------|----------|-------------|-----|--------|")
    for r in results:
        errors = len(r["errors"])
        err_str = f"{errors} error(s)" if errors else "OK"
        lines.append(
            f"| {r['level']} | {r['title']} | {r['load_time_s']}s | "
            f"{r['texture_wait_s']}s | {r['peak_pending']} | {r['fps']} | {err_str} |"
        )
    lines.append("")

    for r in results:
        lines.append(f"## Level {r['level']}: {r['title']}")
        lines.append("")
        if r["errors"]:
            for e in r["errors"]:
                lines.append(f"**ERROR:** {e}")
            lines.append("")

        # Group screenshots by phase
        primitives = [s for s in r["screenshots"] if "primitive" in s]
        textured = [s for s in r["screenshots"] if "textured" in s]

        if primitives:
            lines.append("### Primitive Phase (no textures)")
            for p in primitives:
                fname = os.path.basename(p)
                lines.append(f"- `{fname}`")
            lines.append("")

        if textured:
            lines.append("### Textured Phase")
            for p in textured:
                fname = os.path.basename(p)
                lines.append(f"- `{fname}`")
            lines.append("")

        lines.append("### Evaluation")
        lines.append("- Surface quality: /5")
        lines.append("- Lighting: /5")
        lines.append("- Objects: /5")
        lines.append("- NPCs: /5")
        lines.append("- Spatial coherence: /5")
        lines.append("- **Overall: /5**")
        lines.append("")
        lines.append("### Notes")
        lines.append("_(manual observations)_")
        lines.append("")

    lines.append("## Conclusions")
    lines.append("")
    lines.append("### System Strengths")
    lines.append("- ...")
    lines.append("")
    lines.append("### System Weaknesses")
    lines.append("- ...")
    lines.append("")
    lines.append("### Recommended Limits for Narrative Engine")
    lines.append("- Maximum room size: ...")
    lines.append("- Maximum objects: ...")
    lines.append("- Outdoor viability: ...")
    lines.append("- Texture prompt guidelines: ...")
    lines.append("")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(report_path, "w") as f:
        f.write("\n".join(lines))
    print(f"\nReport saved to: {report_path}")

    # Save timing JSON
    timing = {
        "test_date": datetime.datetime.now().isoformat(),
        "levels": results,
    }
    with open(timing_path, "w") as f:
        json.dump(timing, f, indent=2)
    print(f"Timing saved to: {timing_path}")


def main():
    skip_textures = "--no-textures" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    # Filter levels if specified
    if args:
        selected = set(int(a) for a in args)
        levels = [l for l in LEVELS if l["level"] in selected]
    else:
        levels = LEVELS

    if not levels:
        print("No levels selected.")
        return

    # Verify connection
    try:
        status = send_cmd({"cmd": "status"})
        print(f"Connected to Godot. Current room: {status.get('room', 'unknown')}, FPS: {status.get('fps', '?')}")
    except Exception as e:
        print(f"Cannot connect to Godot on {HOST}:{PORT}: {e}")
        print("Start Godot first: ./start.sh -> preset 2 (Automated tests)")
        return

    print(f"\nRunning {len(levels)} level(s), skip_textures={skip_textures}")
    print(f"Output: {OUTPUT_DIR}/")

    results = []
    for level_cfg in levels:
        try:
            result = run_level(level_cfg, skip_textures)
            results.append(result)

            # If there were load errors, the room might be unusable
            if result["errors"]:
                print(f"\n  [!] Level {level_cfg['level']} had errors. Continuing anyway...")

        except Exception as e:
            print(f"\n  [FATAL] Level {level_cfg['level']} crashed: {e}")
            results.append({
                "level": level_cfg["level"],
                "name": level_cfg["name"],
                "title": level_cfg["title"],
                "load_time_s": 0,
                "texture_wait_s": 0,
                "peak_pending": 0,
                "fps": 0,
                "screenshots": [],
                "errors": [str(e)],
            })

    generate_report(results)

    # Print quick summary
    print(f"\n{'='*60}")
    print("  SUMMARY")
    print(f"{'='*60}")
    for r in results:
        status_icon = "OK" if not r["errors"] else "ERR"
        print(f"  L{r['level']} {r['title']:30s} {status_icon:4s} tex={r['texture_wait_s']:6.1f}s fps={r['fps']}")
    print(f"\nScreenshots: {OUTPUT_DIR}/")
    print("Review screenshots and fill in report.md evaluations.")


if __name__ == "__main__":
    main()
