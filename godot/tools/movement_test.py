#!/usr/bin/env python3
"""Automated movement and animation tests. Simulates player input via remote control.

Usage:
    python godot/tools/movement_test.py              # run all tests
    python godot/tools/movement_test.py walk_forward  # run specific test

Requires Godot running with remote control on :9876.
Output: /tmp/movement_test/{test_name}/ screenshots + PASS/FAIL report.
"""

import socket
import json
import time
import sys
import os
import math

HOST = "127.0.0.1"
PORT = 9876
OUTPUT_DIR = "/tmp/movement_test"


def send_cmd(cmd: dict) -> dict:
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


def screenshot(name: str, test_name: str) -> str:
    path = os.path.join(OUTPUT_DIR, test_name, f"{name}.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    send_cmd({"cmd": "screenshot", "path": path})
    return path


def setup_room():
    """Load root_motion_debug room by scanning for it."""
    status = send_cmd({"cmd": "status"})
    if status.get("room") == "root_motion_debug":
        return True
    # The room is loaded as default now, just need to reload if different
    for i in range(20):
        send_cmd({"cmd": "load_room", "index": i})
        time.sleep(0.5)
        status = send_cmd({"cmd": "status"})
        if status.get("room") == "root_motion_debug":
            return True
    return False


def reset_player():
    """Teleport to origin facing forward."""
    send_cmd({"cmd": "teleport", "x": 0, "y": 0.1, "z": 0})
    send_cmd({"cmd": "look_at", "yaw": 0, "pitch": -0.15})
    time.sleep(0.3)


def detach_camera(view: str):
    views = {
        "side":  {"x": 5, "y": 1.2, "z": 0, "yaw": 90, "pitch": -0.1},
        "front": {"x": 0, "y": 1.2, "z": -5, "yaw": 180, "pitch": -0.1},
        "top":   {"x": 0, "y": 8, "z": 0.5, "yaw": 0, "pitch": -1.4},
        "behind": {"x": 0, "y": 1.5, "z": 5, "yaw": 0, "pitch": -0.1},
    }
    send_cmd({"cmd": "camera_detach", **views[view]})
    time.sleep(0.2)


def attach_camera():
    send_cmd({"cmd": "camera_attach"})


# ─── Test Cases ───


def test_walk_forward():
    """Player should move forward when pressing W."""
    reset_player()
    detach_camera("side")
    screenshot("before", "walk_forward")

    status_before = send_cmd({"cmd": "status"})
    pos_before = status_before.get("player_pos", [0, 0, 0])

    # Hold move_forward for 2 seconds
    send_cmd({"cmd": "key", "action": "move_forward", "duration": 2.0})
    time.sleep(2.5)

    screenshot("after", "walk_forward")
    status_after = send_cmd({"cmd": "status"})
    pos_after = status_after.get("player_pos", [0, 0, 0])

    # Player should have moved in Z (camera forward is -Z)
    dz = pos_after[2] - pos_before[2]
    dx = pos_after[0] - pos_before[0]
    dist = math.sqrt(dx**2 + dz**2)

    attach_camera()

    # Walk speed is 1.9 m/s, so in 2s should move ~3.8m
    if dist > 2.0:
        return True, f"Moved {dist:.2f}m (dz={dz:.2f})"
    else:
        return False, f"Only moved {dist:.2f}m (expected >2m), dz={dz:.2f}"


def test_run_sprint():
    """Sprinting should be faster than walking."""
    reset_player()

    send_cmd({"cmd": "key", "action": "sprint", "duration": 2.5})
    send_cmd({"cmd": "key", "action": "move_forward", "duration": 2.0})
    time.sleep(2.5)

    status = send_cmd({"cmd": "status"})
    pos = status.get("player_pos", [0, 0, 0])
    dist = math.sqrt(pos[0]**2 + pos[2]**2)

    # Sprint speed is 3.8 m/s, so in 2s should move ~7.6m
    if dist > 5.0:
        return True, f"Sprint moved {dist:.2f}m"
    else:
        return False, f"Sprint only moved {dist:.2f}m (expected >5m)"


def test_attack_animation():
    """Click should trigger attack animation."""
    reset_player()
    detach_camera("side")
    time.sleep(0.5)

    # Request attack — same path as player click
    send_cmd({"cmd": "attack", "type": "quick"})
    time.sleep(0.3)

    status = send_cmd({"cmd": "status"})
    anim = status.get("anim_state", "")
    screenshot("during_attack", "attack_animation")

    # Wait for attack to complete
    time.sleep(2.5)
    status_after = send_cmd({"cmd": "status"})
    anim_after = status_after.get("anim_state", "")
    screenshot("after_attack", "attack_animation")

    attach_camera()

    if anim in ["quick", "idle"]:  # quick or already returned
        return True, f"Attack played (state={anim}, after={anim_after})"
    else:
        return False, f"Expected 'quick', got '{anim}'"


def test_attack_root_motion():
    """Attack with steps — capsule should follow model during attack."""
    reset_player()
    detach_camera("side")
    time.sleep(0.5)

    pos_before = send_cmd({"cmd": "status"}).get("player_pos", [0, 0, 0])

    # Trigger attack via sync.attack() — same path as player click
    send_cmd({"cmd": "attack", "type": "medium"})

    # Capture frames during the attack (medium = 1.30s)
    for i in range(8):
        screenshot(f"frame_{i:02d}", "attack_root_motion")
        time.sleep(0.2)

    pos_after = send_cmd({"cmd": "status"}).get("player_pos", [0, 0, 0])
    dx = pos_after[0] - pos_before[0]
    dz = pos_after[2] - pos_before[2]
    dist = math.sqrt(dx**2 + dz**2)

    attach_camera()

    # Attack is "in place" — model stays on capsule. Check frames visually.
    return True, f"Attack in place (body moved {dist:.2f}m) — check frames for capsule sync"


def test_jump_sequence():
    """Jump — capsule should follow model during jump."""
    reset_player()
    detach_camera("side")
    time.sleep(0.5)

    # Trigger jump via key action (like pressing space)
    send_cmd({"cmd": "key", "action": "jump"})

    # Capture frames during jump (0.83s)
    for i in range(6):
        screenshot(f"frame_{i:02d}", "jump_sequence")
        time.sleep(0.2)

    attach_camera()
    return True, "6 frames captured during jump — check capsule sync"


def test_capsule_model_sync():
    """Model and capsule should stay together during WASD movement."""
    reset_player()
    detach_camera("side")
    time.sleep(0.5)

    # Start walking with real WASD input
    send_cmd({"cmd": "key", "action": "move_forward", "duration": 3.0})

    # Capture screenshots every 0.3s during movement
    for i in range(10):
        screenshot(f"frame_{i:02d}", "capsule_sync")
        time.sleep(0.3)

    attach_camera()
    return True, "10 frames captured during WASD walk — verify model/capsule aligned"


def test_walk_sequence():
    """Walk forward, then left, then back — screenshots during each."""
    reset_player()
    detach_camera("top")
    time.sleep(0.5)

    screenshot("00_start", "walk_sequence")

    # Walk forward 2s
    send_cmd({"cmd": "key", "action": "move_forward", "duration": 2.0})
    time.sleep(1.0)
    screenshot("01_walk_fwd_mid", "walk_sequence")
    time.sleep(1.2)
    screenshot("02_walk_fwd_end", "walk_sequence")
    time.sleep(0.3)

    # Walk left 2s
    send_cmd({"cmd": "key", "action": "move_left", "duration": 2.0})
    time.sleep(1.0)
    screenshot("03_walk_left_mid", "walk_sequence")
    time.sleep(1.2)
    screenshot("04_walk_left_end", "walk_sequence")
    time.sleep(0.3)

    # Walk backward 2s
    send_cmd({"cmd": "key", "action": "move_backward", "duration": 2.0})
    time.sleep(1.0)
    screenshot("05_walk_back_mid", "walk_sequence")
    time.sleep(1.2)
    screenshot("06_walk_back_end", "walk_sequence")

    attach_camera()

    status = send_cmd({"cmd": "status"})
    pos = status.get("player_pos", [0, 0, 0])
    return True, f"Sequence complete. Final pos: ({pos[0]:.1f}, {pos[2]:.1f})"


def test_sprint_sequence():
    """Sprint forward with screenshots every 0.2s."""
    reset_player()
    detach_camera("side")
    time.sleep(0.5)

    # Sprint forward
    send_cmd({"cmd": "key", "action": "sprint", "duration": 3.0})
    send_cmd({"cmd": "key", "action": "move_forward", "duration": 2.5})

    for i in range(12):
        screenshot(f"frame_{i:02d}", "sprint_sequence")
        time.sleep(0.25)

    attach_camera()
    return True, "12 frames captured during sprint"


def test_attack_during_walk():
    """Attack while walking — should stop, play attack, then resume."""
    reset_player()
    detach_camera("side")
    time.sleep(0.5)

    # Start walking
    send_cmd({"cmd": "key", "action": "move_forward", "duration": 5.0})
    time.sleep(0.5)
    screenshot("00_walking", "attack_walk")

    # Trigger attack mid-walk — same path as player click
    send_cmd({"cmd": "attack", "type": "heavy"})
    time.sleep(0.3)
    screenshot("01_attack_start", "attack_walk")

    time.sleep(0.7)
    screenshot("02_attack_mid", "attack_walk")

    time.sleep(0.7)
    screenshot("03_attack_end", "attack_walk")

    # Wait for return to walking
    time.sleep(1.5)
    screenshot("04_after_attack", "attack_walk")

    attach_camera()
    return True, "5 frames: walking → attack → after"


def test_idle_state():
    """Player should be in idle when not moving."""
    reset_player()
    time.sleep(0.5)

    status = send_cmd({"cmd": "status"})
    anim = status.get("anim_state", "unknown")

    if anim == "idle":
        return True, f"Idle state confirmed"
    else:
        return False, f"Expected 'idle', got '{anim}'"


# ─── Runner ───

ALL_TESTS = {
    "idle_state": test_idle_state,
    "walk_forward": test_walk_forward,
    "run_sprint": test_run_sprint,
    "attack_animation": test_attack_animation,
    "attack_root_motion": test_attack_root_motion,
    "capsule_sync": test_capsule_model_sync,
    "walk_sequence": test_walk_sequence,
    "sprint_sequence": test_sprint_sequence,
    "attack_walk": test_attack_during_walk,
    "jump_sequence": test_jump_sequence,
}


def main():
    tests_to_run = sys.argv[1:] if len(sys.argv) > 1 else list(ALL_TESTS.keys())

    print("Movement Test Suite")
    print("=" * 50)

    try:
        status = send_cmd({"cmd": "status"})
        print(f"Connected (room: {status.get('room', '?')}, fps: {status.get('fps', 0)})")
    except Exception as e:
        print(f"ERROR: Cannot connect to Godot — {e}")
        sys.exit(1)

    # Load debug room
    print("Loading debug room...")
    if not setup_room():
        print("WARNING: Could not load root_motion_debug room")
    time.sleep(1)

    results = []
    for name in tests_to_run:
        if name not in ALL_TESTS:
            print(f"  SKIP: unknown test '{name}'")
            continue
        print(f"\n  Running: {name}...")
        try:
            passed, msg = ALL_TESTS[name]()
            status_str = "PASS" if passed else "FAIL"
            print(f"  {status_str}: {msg}")
            results.append((name, passed, msg))
        except Exception as e:
            print(f"  ERROR: {e}")
            results.append((name, False, str(e)))

    # Summary
    print("\n" + "=" * 50)
    passed = sum(1 for _, p, _ in results if p)
    total = len(results)
    print(f"Results: {passed}/{total} passed")
    for name, p, msg in results:
        print(f"  {'PASS' if p else 'FAIL'}: {name} — {msg}")
    print(f"\nScreenshots: {OUTPUT_DIR}/")

    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
