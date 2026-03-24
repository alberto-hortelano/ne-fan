#!/usr/bin/env python3
"""Animation debug tool — multi-angle screenshot captures for root motion tuning.

Captures each animation from 3 angles (side, front, top) at start/mid/end,
with detached camera for fixed viewpoints. Reports displacement.

Usage:
    python godot/tools/anim_debug.py                    # all animations
    python godot/tools/anim_debug.py kick heavy          # specific anims
    python godot/tools/anim_debug.py --fps 15 kick       # more frames
    python godot/tools/anim_debug.py --angles side kick   # single angle

Requires Godot running with remote control on :9876.
Output: /tmp/anim_debug/{anim_name}/{angle}_{moment}.png
"""

import socket
import json
import time
import sys
import os
import argparse

HOST = "127.0.0.1"
PORT = 9876
OUTPUT_DIR = "/tmp/anim_debug"

ALL_ANIMS = [
    "idle", "walk", "run", "turn",
    "quick", "heavy", "medium", "defensive", "precise",
    "kick", "casting", "hit", "death", "block_idle",
    "power_up", "jump", "draw_sword_1", "draw_sword_2",
]

# Camera positions for each angle (x, y, z, yaw_deg, pitch_rad)
CAMERA_VIEWS = {
    "side":  {"x": 4, "y": 1.5, "z": 0, "yaw": -90, "pitch": -0.1},
    "front": {"x": 0, "y": 1.5, "z": 4, "yaw": 180, "pitch": -0.1},
    "top":   {"x": 0, "y": 6,   "z": 0, "yaw": 0,   "pitch": -1.4},
}


def send_cmd(cmd: dict) -> dict:
    """Send a command to Godot remote control and return response."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(5.0)
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


def setup_room():
    """Load the root motion debug room."""
    status = send_cmd({"cmd": "status"})
    if status.get("room") == "root_motion_debug":
        return True
    for i in range(20):
        send_cmd({"cmd": "load_room", "index": i})
        time.sleep(1.5)
        status = send_cmd({"cmd": "status"})
        if status.get("room") == "root_motion_debug":
            return True
    print("WARNING: Could not find root_motion_debug room")
    return False


def capture_animation(anim_name: str, angles: list[str], fps: int = 10):
    """Capture screenshots of an animation from multiple angles."""
    out_dir = os.path.join(OUTPUT_DIR, anim_name)
    os.makedirs(out_dir, exist_ok=True)

    # Reset player position to origin
    send_cmd({"cmd": "teleport", "x": 0, "y": 0.1, "z": 0})
    time.sleep(0.3)

    # Start animation
    result = send_cmd({"cmd": "play_anim", "name": anim_name})
    if "error" in result:
        print(f"  ERROR: {result['error']}")
        return
    duration = result.get("duration", 2.0)
    print(f"  {anim_name}: duration={duration:.2f}s")

    # For each angle, capture start/mid/end
    for angle in angles:
        view = CAMERA_VIEWS[angle]
        send_cmd({
            "cmd": "camera_detach",
            "x": view["x"], "y": view["y"], "z": view["z"],
            "yaw": view["yaw"], "pitch": view["pitch"],
        })
        time.sleep(0.2)

        # Reset and replay for each angle
        send_cmd({"cmd": "teleport", "x": 0, "y": 0.1, "z": 0})
        time.sleep(0.2)
        send_cmd({"cmd": "play_anim", "name": anim_name})
        time.sleep(0.1)

        # Capture frames throughout the animation
        num_frames = max(int(duration * fps), 3)
        interval = duration / num_frames
        for i in range(num_frames + 1):
            path = os.path.join(out_dir, f"{angle}_{i:03d}.png")
            send_cmd({"cmd": "screenshot", "path": path})
            if i < num_frames:
                time.sleep(interval)

    # Get final displacement
    status = send_cmd({"cmd": "status"})
    pos = status.get("player_pos", [0, 0, 0])
    disp = (pos[0]**2 + pos[2]**2)**0.5
    print(f"  Displacement: x={pos[0]:.3f} z={pos[2]:.3f} total={disp:.3f}m")
    print(f"  Frames: {out_dir}/")

    # Restore camera follow
    send_cmd({"cmd": "camera_attach"})


def main():
    parser = argparse.ArgumentParser(description="Animation debug multi-angle capture")
    parser.add_argument("anims", nargs="*", help="Animation names (default: all)")
    parser.add_argument("--fps", type=int, default=10, help="Frames per second (default: 10)")
    parser.add_argument("--angles", nargs="+", default=["side", "front", "top"],
                        choices=["side", "front", "top"], help="Angles to capture")
    parser.add_argument("--no-room", action="store_true", help="Skip room loading")
    args = parser.parse_args()

    anims = args.anims if args.anims else ALL_ANIMS

    print(f"Animation Debug — angles={args.angles}, fps={args.fps}")
    print(f"Animations: {', '.join(anims)}")
    print()

    try:
        status = send_cmd({"cmd": "status"})
        print(f"Connected (room: {status.get('room', '?')}, fps: {status.get('fps', 0)})")
    except Exception as e:
        print(f"ERROR: Cannot connect to Godot — {e}")
        sys.exit(1)

    if not args.no_room:
        print("Loading debug room...")
        setup_room()
        time.sleep(1)

    for anim in anims:
        capture_animation(anim, args.angles, fps=args.fps)
        time.sleep(0.5)

    print(f"\nDone! Screenshots in {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
