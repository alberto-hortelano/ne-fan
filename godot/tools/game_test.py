#!/usr/bin/env python3
"""Automated game lifecycle, pause, and combat visual tests.
Complements movement_test.py with higher-level game flow tests.

Usage:
    python godot/tools/game_test.py                    # run all tests
    python godot/tools/game_test.py pause_freezes_game # run specific test
    python godot/tools/game_test.py lifecycle pause     # run groups

Requires Godot running with remote control on :9876.
Output: /tmp/game_test/ screenshots + PASS/FAIL report.
"""

import socket
import json
import time
import sys
import os

HOST = "127.0.0.1"
PORT = 9876
OUTPUT_DIR = "/tmp/game_test"


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


def screenshot(name: str, test_name: str) -> str:
    path = os.path.join(OUTPUT_DIR, test_name, f"{name}.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    send_cmd({"cmd": "screenshot", "path": path})
    return path


def status() -> dict:
    return send_cmd({"cmd": "status"})


def load_arena():
    """Load combat_arena dev room (has 1 enemy)."""
    send_cmd({"cmd": "load_game", "game_id": "tavern_intro",
              "scene_path": "res://test_rooms/dev/combat_arena.json"})
    time.sleep(2)
    send_cmd({"cmd": "load_room_path",
              "path": "res://test_rooms/dev/combat_arena.json"})
    time.sleep(1.5)


def load_game_tavern():
    """Load tavern_intro game via load_game (simulates title screen)."""
    send_cmd({"cmd": "load_game", "game_id": "tavern_intro"})
    time.sleep(3)


# ─── Lifecycle Tests ───


def test_title_screen_on_startup():
    """Player should have HP > 0 and be in a valid state."""
    s = status()
    hp = s.get("combat_hp", 0)
    anim = s.get("anim_state", "?")
    ok = hp > 0 and anim in ["idle", "walk", "run"]
    return ok, f"hp={hp}, anim='{anim}' (expect hp>0, valid anim)"


def test_load_game_sets_room():
    """Loading a game via load_game should set room and reset HP."""
    load_arena()
    s = status()
    room = s.get("room", "")
    hp = s.get("combat_hp", 0)
    ok = room == "combat_arena" and hp == 100.0
    return ok, f"room='{room}', hp={hp}"


def test_room_switch_clears_state():
    """Switching rooms should reset player state."""
    load_arena()
    # Attack to change combat state
    send_cmd({"cmd": "attack", "type": "heavy"})
    time.sleep(0.5)
    # Switch to a different room
    for i in range(20):
        send_cmd({"cmd": "load_room", "index": i})
        time.sleep(0.5)
        s = status()
        if s.get("room", "") != "combat_arena":
            break
    s = status()
    hp = s.get("combat_hp", 0)
    ok = hp == 100.0
    return ok, f"hp={hp} after room switch (expect 100)"


def test_dev_room_deactivates_scenario():
    """Loading a dev room via F-key/load_room_path should deactivate scenario."""
    # Load tavern (scenario active)
    load_game_tavern()
    s1 = status()
    # Now load a dev room
    send_cmd({"cmd": "load_room_path",
              "path": "res://test_rooms/dev/combat_arena.json"})
    time.sleep(2)
    s2 = status()
    # After 2 more seconds, check no scenario events changed the room
    time.sleep(2)
    s3 = status()
    room2 = s2.get("room", "")
    room3 = s3.get("room", "")
    ok = room2 == "combat_arena" and room3 == "combat_arena"
    return ok, f"room stayed '{room3}' (expect combat_arena, no scenario interference)"


# ─── Pause Tests ───


def test_pause_freezes_combat():
    """When paused, enemy should not deal damage."""
    load_arena()
    send_cmd({"cmd": "teleport", "x": 0, "y": 1, "z": -4})
    time.sleep(1)
    s_before = status()
    hp_before = s_before.get("combat_hp", 100)

    # Simulate ESC press to pause (ui_cancel action)
    send_cmd({"cmd": "key", "action": "ui_cancel"})
    time.sleep(0.3)

    # Wait 3 seconds while paused — HP should NOT drop
    hp_during_pause = status().get("combat_hp", 0)
    time.sleep(3)
    hp_after_pause = status().get("combat_hp", 0)

    # Unpause
    send_cmd({"cmd": "key", "action": "ui_cancel"})
    time.sleep(0.3)

    # HP should be same during and after pause (before unpause damage)
    ok = abs(hp_during_pause - hp_after_pause) < 0.1
    return ok, f"HP during pause: {hp_during_pause:.1f} → {hp_after_pause:.1f} (expect no change)"


def test_pause_freezes_player():
    """When paused, player movement should not work."""
    load_arena()
    send_cmd({"cmd": "teleport", "x": 0, "y": 1, "z": 0})
    time.sleep(0.5)

    # Pause
    send_cmd({"cmd": "key", "action": "ui_cancel"})
    time.sleep(0.3)

    pos_before = status().get("player_pos", [0, 0, 0])
    # Try to move
    send_cmd({"cmd": "key", "action": "move_forward", "duration": 1.0})
    time.sleep(1.2)
    pos_after = status().get("player_pos", [0, 0, 0])

    # Unpause
    send_cmd({"cmd": "key", "action": "ui_cancel"})
    time.sleep(0.3)

    dx = abs(pos_after[0] - pos_before[0])
    dz = abs(pos_after[2] - pos_before[2])
    moved = dx + dz
    ok = moved < 0.1
    return ok, f"Moved {moved:.2f}m during pause (expect ~0)"


def test_unpause_resumes():
    """After unpausing, player should be able to move again."""
    load_arena()
    send_cmd({"cmd": "teleport", "x": 0, "y": 1, "z": 0})
    time.sleep(0.5)

    # Pause then unpause
    send_cmd({"cmd": "key", "action": "ui_cancel"})
    time.sleep(0.3)
    send_cmd({"cmd": "key", "action": "ui_cancel"})
    time.sleep(0.3)

    pos_before = status().get("player_pos", [0, 0, 0])
    send_cmd({"cmd": "key", "action": "move_forward", "duration": 1.0})
    time.sleep(1.2)
    pos_after = status().get("player_pos", [0, 0, 0])

    dx = abs(pos_after[0] - pos_before[0])
    dz = abs(pos_after[2] - pos_before[2])
    moved = (dx**2 + dz**2) ** 0.5
    ok = moved > 1.0
    return ok, f"Moved {moved:.2f}m after unpause (expect >1)"


# ─── NPC Attack Visual Tests ───


def test_npc_attack_visual_position():
    """NPC attack visual should appear near the NPC, not at world origin."""
    load_arena()
    # Enemy is at approximately (0, 0.9, -6)
    # Force NPC attack
    resp = send_cmd({"cmd": "npc_attack", "type": "heavy"})
    if "error" in resp:
        return False, f"npc_attack failed: {resp}"
    time.sleep(0.1)
    screenshot("npc_arc", "npc_attack_visual")
    # The visual test is screenshot-based — we just verify the command works
    ok = resp.get("ok", False)
    return ok, f"NPC attack triggered: {resp.get('id', '?')}"


# ─── Animation Blending Tests ───


def test_attack_during_walk():
    """Player should be able to attack while walking (upper/lower body split)."""
    load_arena()
    send_cmd({"cmd": "teleport", "x": 0, "y": 1, "z": 0})
    send_cmd({"cmd": "look_at", "yaw": 0, "pitch": -0.15})
    time.sleep(0.3)

    # Start walking
    send_cmd({"cmd": "key", "action": "move_forward", "duration": 2.0})
    time.sleep(0.3)

    pos_before = status().get("player_pos", [0, 0, 0])

    # Attack mid-walk
    send_cmd({"cmd": "attack", "type": "quick"})
    time.sleep(0.5)

    # Check player is still moving during attack
    s = status()
    anim = s.get("anim_name", "")
    pos_during = s.get("player_pos", [0, 0, 0])

    time.sleep(1.0)
    pos_after = status().get("player_pos", [0, 0, 0])

    dist_during = ((pos_during[0]-pos_before[0])**2 + (pos_during[2]-pos_before[2])**2)**0.5
    dist_total = ((pos_after[0]-pos_before[0])**2 + (pos_after[2]-pos_before[2])**2)**0.5

    # Player should have moved significantly even during attack
    ok = dist_total > 2.0
    return ok, f"Moved {dist_total:.2f}m during walk+attack (expect >2), anim={anim}"


def test_attack_returns_to_idle():
    """After attack, combat layer should return to idle."""
    load_arena()
    send_cmd({"cmd": "teleport", "x": 0, "y": 1, "z": 0})
    send_cmd({"cmd": "look_at", "yaw": 0, "pitch": -0.15})
    time.sleep(0.5)  # Let player settle to idle

    send_cmd({"cmd": "attack", "type": "quick"})
    time.sleep(0.3)  # Give state machine time to transition
    s_attack = status()
    anim_attack = s_attack.get("anim_name", "")

    # Wait for attack to finish
    time.sleep(3.0)
    s_after = status()
    anim_after = s_after.get("anim_name", "")

    ok = anim_attack == "quick" and anim_after == "idle"
    return ok, f"During attack: '{anim_attack}', after: '{anim_after}'"


# ─── Death & Respawn Tests ───


def test_respawn_resets_hp():
    """Respawn command should restore HP to max."""
    load_arena()
    # Teleport near enemy to take damage
    send_cmd({"cmd": "teleport", "x": 0, "y": 1, "z": -4.5})
    time.sleep(2)
    s = status()
    hp = s.get("combat_hp", 100)
    # Respawn
    send_cmd({"cmd": "respawn"})
    time.sleep(1)
    s2 = status()
    hp2 = s2.get("combat_hp", 0)
    ok = hp2 == 100.0
    return ok, f"HP before respawn: {hp:.1f}, after: {hp2:.1f}"


# ─── Test Runner ───


ALL_TESTS = {
    "lifecycle": [
        ("title_screen_on_startup", test_title_screen_on_startup),
        ("load_game_sets_room", test_load_game_sets_room),
        ("room_switch_clears_state", test_room_switch_clears_state),
        ("dev_room_deactivates_scenario", test_dev_room_deactivates_scenario),
    ],
    "pause": [
        ("pause_freezes_combat", test_pause_freezes_combat),
        ("pause_freezes_player", test_pause_freezes_player),
        ("unpause_resumes", test_unpause_resumes),
    ],
    "combat_visual": [
        ("npc_attack_visual_position", test_npc_attack_visual_position),
    ],
    "animation": [
        ("attack_during_walk", test_attack_during_walk),
        ("attack_returns_to_idle", test_attack_returns_to_idle),
    ],
    "death": [
        ("respawn_resets_hp", test_respawn_resets_hp),
    ],
}


def main():
    args = sys.argv[1:]
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Check connection
    try:
        s = status()
        print("Game Test Suite")
        print("=" * 60)
        print(f"Connected (room: {s.get('room', '?')}, fps: {s.get('fps', 0):.0f})")
    except Exception as e:
        print(f"ERROR: Cannot connect to Godot \u2014 {e}")
        sys.exit(1)

    # Select tests
    tests_to_run = []
    if not args:
        # Run all
        for group in ALL_TESTS.values():
            tests_to_run.extend(group)
    else:
        for arg in args:
            if arg in ALL_TESTS:
                tests_to_run.extend(ALL_TESTS[arg])
            else:
                for group in ALL_TESTS.values():
                    for name, func in group:
                        if name == arg:
                            tests_to_run.append((name, func))

    if not tests_to_run:
        print(f"No tests matched: {args}")
        print(f"Available groups: {', '.join(ALL_TESTS.keys())}")
        print(f"Available tests: {', '.join(n for g in ALL_TESTS.values() for n, _ in g)}")
        sys.exit(1)

    results = []
    for name, func in tests_to_run:
        print(f"\n  Running: {name}...")
        try:
            ok, msg = func()
            tag = "PASS" if ok else "FAIL"
            print(f"  {tag}: {msg}")
            results.append((name, ok, msg))
        except Exception as e:
            print(f"  ERROR: {e}")
            results.append((name, False, str(e)))

    # Summary
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{'=' * 60}")
    print(f"Results: {passed}/{total} passed")
    for name, ok, msg in results:
        tag = "PASS" if ok else "FAIL"
        print(f"  {tag}: {name} \u2014 {msg}")
    print(f"\nScreenshots: {OUTPUT_DIR}/")

    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
