#!/usr/bin/env python3
"""Animation debug tool — captures screenshot sequences during animations.

Usage:
    python godot/tools/anim_debug.py                    # all animations
    python godot/tools/anim_debug.py kick heavy          # specific anims
    python godot/tools/anim_debug.py --side kick         # side view
    python godot/tools/anim_debug.py --top kick          # top-down view
    python godot/tools/anim_debug.py --fps 15 kick       # 15 screenshots/sec

Requires Godot running with remote control on :9876.
Output: /tmp/anim_debug/{anim_name}/frame_NNNN.png
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
    # Find the room index by loading rooms until we find root_motion_debug
    status = send_cmd({"cmd": "status"})
    if status.get("room") == "root_motion_debug":
        return True

    # Try loading dev rooms (they're at the end of the list)
    for i in range(20):
        result = send_cmd({"cmd": "load_room", "index": i})
        if "error" in result:
            break
        time.sleep(1)
        status = send_cmd({"cmd": "status"})
        if status.get("room") == "root_motion_debug":
            return True

    print("WARNING: Could not find root_motion_debug room, using current room")
    return False


def setup_camera(view: str):
    """Position camera for the desired view."""
    send_cmd({"cmd": "teleport", "x": 0, "y": 0.1, "z": 0})
    time.sleep(0.5)

    if view == "side":
        # Side view: camera to the right, looking slightly down to see floor grid
        send_cmd({"cmd": "look_at", "yaw": 90, "pitch": -0.25})
    elif view == "top":
        send_cmd({"cmd": "look_at", "yaw": 0, "pitch": -1.2})
    elif view == "front":
        send_cmd({"cmd": "look_at", "yaw": 180, "pitch": -0.2})
    else:  # behind (default)
        send_cmd({"cmd": "look_at", "yaw": 0, "pitch": -0.2})

    time.sleep(0.3)


def capture_animation(anim_name: str, fps: int = 10, view: str = "side"):
    """Capture screenshots during an animation playback."""
    out_dir = os.path.join(OUTPUT_DIR, anim_name)
    os.makedirs(out_dir, exist_ok=True)

    # Reset position
    send_cmd({"cmd": "teleport", "x": 0, "y": 0.1, "z": 0})
    time.sleep(0.3)

    # Start animation
    result = send_cmd({"cmd": "play_anim", "name": anim_name})
    if "error" in result:
        print(f"  ERROR: {result['error']}")
        return

    duration = result.get("duration", 2.0)
    num_frames = max(int(duration * fps), 5)
    interval = duration / num_frames

    print(f"  {anim_name}: duration={duration:.2f}s, {num_frames} frames at {fps}fps")

    # Capture frames
    for i in range(num_frames + 2):  # +2 for safety
        path = os.path.join(out_dir, f"frame_{i:04d}.png")
        send_cmd({"cmd": "screenshot", "path": path})
        time.sleep(interval)

    # Get final position
    status = send_cmd({"cmd": "status"})
    pos = status.get("player_pos", [0, 0, 0])
    print(f"  Final pos: x={pos[0]:.3f} z={pos[2]:.3f} (displacement: {(pos[0]**2 + pos[2]**2)**0.5:.3f}m)")
    print(f"  Frames saved to: {out_dir}/")


def main():
    parser = argparse.ArgumentParser(description="Animation debug screenshot tool")
    parser.add_argument("anims", nargs="*", help="Animation names to capture (default: all)")
    parser.add_argument("--side", action="store_true", help="Side view")
    parser.add_argument("--top", action="store_true", help="Top-down view")
    parser.add_argument("--front", action="store_true", help="Front view")
    parser.add_argument("--fps", type=int, default=10, help="Screenshots per second (default: 10)")
    parser.add_argument("--no-room", action="store_true", help="Skip room loading")
    args = parser.parse_args()

    view = "side"
    if args.top:
        view = "top"
    elif args.front:
        view = "front"
    elif not args.side:
        view = "side"

    anims = args.anims if args.anims else ALL_ANIMS

    print(f"Animation Debug Tool — view={view}, fps={args.fps}")
    print(f"Animations: {', '.join(anims)}")
    print()

    # Test connection
    try:
        status = send_cmd({"cmd": "status"})
        print(f"Connected to Godot (room: {status.get('room', '?')}, fps: {status.get('fps', 0)})")
    except Exception as e:
        print(f"ERROR: Cannot connect to Godot on :{PORT} — {e}")
        print("Make sure Godot is running (bash start.sh godot)")
        sys.exit(1)

    # Setup
    if not args.no_room:
        print("Loading debug room...")
        setup_room()
        time.sleep(1)

    setup_camera(view)

    # Capture each animation
    for anim in anims:
        capture_animation(anim, fps=args.fps, view=view)
        time.sleep(0.5)

    print(f"\nDone! Screenshots in {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
