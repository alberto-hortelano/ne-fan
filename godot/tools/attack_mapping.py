#!/usr/bin/env python3
"""Attack animation mapping tool — measures intrinsic attributes of all attack animations.

Captures screenshots (top-down + side) and polls weapon_tip position to automatically
compute visual reach, sweep arc, hips displacement, and impact timing for each animation.

Fixes: forces player orientation to -Z before each measurement, detects multi-hit
animations by finding reach peaks in the weapon_tip trajectory.

Usage:
    python godot/tools/attack_mapping.py                    # all attack animations
    python godot/tools/attack_mapping.py quick heavy        # specific anims
    python godot/tools/attack_mapping.py --no-screenshots   # data only, no screenshots

Requires Godot running with remote control on :9876.
Output: /tmp/attack_mapping/ (screenshots + intrinsics JSON)
"""

import socket
import json
import time
import sys
import os
import math
import argparse

HOST = "127.0.0.1"
PORT = 9876
OUTPUT_DIR = "/tmp/attack_mapping"

ATTACK_ANIMS = [
    "quick", "heavy", "medium", "defensive", "precise",
    "attack_1", "attack_2", "attack_3", "slash_2", "slash_4",
    "kick",
]

MAPPED_ATTACK_TYPES = ["quick", "heavy", "medium", "defensive", "precise"]

CAMERA_VIEWS = {
    "top":  {"x": 0, "y": 5, "z": 0.5, "yaw": 0, "pitch": -1.4},
    "side": {"x": 4, "y": 1.2, "z": 0, "yaw": 90, "pitch": -0.1},
}

POLL_FPS = 20


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


def setup_room() -> bool:
    status = send_cmd({"cmd": "status"})
    if status.get("room") == "root_motion_debug":
        return True
    if not status.get("room"):
        send_cmd({"cmd": "load_game", "game_id": "test"})
        time.sleep(3)
    send_cmd({"cmd": "load_room_path", "path": "res://test_rooms/dev/root_motion_debug.json"})
    time.sleep(3)
    status = send_cmd({"cmd": "status"})
    if status.get("room") == "root_motion_debug":
        return True
    send_cmd({"cmd": "load_room_path", "path": "res://test_rooms/dev/root_motion_debug.json"})
    time.sleep(3)
    status = send_cmd({"cmd": "status"})
    return status.get("room") == "root_motion_debug"


def force_orientation():
    """Force player to face -Z by setting camera yaw=0 and briefly walking forward."""
    send_cmd({"cmd": "look_at", "yaw": 0, "pitch": -0.2})
    time.sleep(0.1)
    send_cmd({"cmd": "key", "action": "move_forward", "duration": 0.15})
    time.sleep(0.3)


def reset_player():
    """Teleport to origin and force consistent -Z orientation."""
    send_cmd({"cmd": "teleport", "x": 0, "y": 0.1, "z": 0})
    force_orientation()
    send_cmd({"cmd": "teleport", "x": 0, "y": 0.1, "z": 0})
    time.sleep(0.2)


def find_reach_peaks(tips: list[dict], min_prominence: float = 0.05) -> list[dict]:
    """Find peaks in reach data to detect individual hits in multi-hit animations.

    Returns list of peaks: [{t, reach, index}, ...]
    """
    reaches = [t["reach"] for t in tips]
    if len(reaches) < 3:
        return [{"t": tips[0]["t"], "reach": reaches[0], "index": 0}] if tips else []

    peaks = []
    for i in range(1, len(reaches) - 1):
        if reaches[i] > reaches[i - 1] and reaches[i] > reaches[i + 1]:
            # Check prominence: must be significantly above surrounding valleys
            left_valley = min(reaches[max(0, i - 5):i])
            right_valley = min(reaches[i + 1:min(len(reaches), i + 6)])
            prominence = reaches[i] - max(left_valley, right_valley)
            if prominence >= min_prominence:
                peaks.append({
                    "t": tips[i]["t"],
                    "reach": round(reaches[i], 3),
                    "index": i,
                })

    # If no peaks found, use overall max
    if not peaks:
        max_idx = reaches.index(max(reaches))
        peaks.append({
            "t": tips[max_idx]["t"],
            "reach": round(reaches[max_idx], 3),
            "index": max_idx,
        })

    return peaks


def compute_sweep_around_peak(tips: list[dict], peak_idx: int, window: int = 5) -> float:
    """Compute sweep angle around a peak within a window of frames."""
    start = max(0, peak_idx - window)
    end = min(len(tips), peak_idx + window + 1)
    angles = []
    for i in range(start, end):
        dx = tips[i]["x"]
        dz = tips[i]["z"]
        if abs(dx) > 0.03 or abs(dz) > 0.03:
            angle = math.degrees(math.atan2(dx, -dz))  # -Z is forward
            angles.append(angle)
    if len(angles) < 2:
        return 0.0
    sweep = max(angles) - min(angles)
    if sweep > 180:
        sweep = 360 - sweep
    return round(sweep, 1)


def measure_animation(anim_name: str, take_screenshots: bool = True) -> dict:
    out_dir = os.path.join(OUTPUT_DIR, anim_name)
    if take_screenshots:
        os.makedirs(out_dir, exist_ok=True)

    result = {
        "key": anim_name,
        "duration": 0.0,
        "num_hits": 1,
        "first_hit_fraction": 0.0,
        "first_hit_reach_m": 0.0,
        "first_hit_sweep_deg": 0.0,
        "max_reach_m": 0.0,
        "total_sweep_deg": 0.0,
        "max_hips_displacement_m": 0.0,
        "has_steps": False,
        "peaks": [],
        "weapon_tip_trajectory": [],
    }

    is_mapped = anim_name in MAPPED_ATTACK_TYPES

    for angle_name, view in CAMERA_VIEWS.items():
        reset_player()

        send_cmd({
            "cmd": "camera_detach",
            "x": view["x"], "y": view["y"], "z": view["z"],
            "yaw": view["yaw"], "pitch": view["pitch"],
        })
        time.sleep(0.2)

        # Record reference position (player should be at origin facing -Z)
        ref_status = send_cmd({"cmd": "status"})
        player_pos = ref_status.get("player_pos", [0, 0, 0])

        # Play animation
        if is_mapped:
            anim_result = send_cmd({"cmd": "attack", "type": anim_name})
        else:
            anim_result = send_cmd({"cmd": "play_anim", "name": anim_name})

        if "error" in anim_result:
            print(f"  ERROR playing {anim_name}: {anim_result['error']}")
            return result

        duration = anim_result.get("duration", 2.0)
        result["duration"] = duration

        if angle_name == "top":
            interval = 1.0 / POLL_FPS
            num_samples = max(int(duration * POLL_FPS), 5)
            tips = []
            max_hips_disp = 0.0

            for i in range(num_samples):
                status = send_cmd({"cmd": "status"})
                tip = status.get("weapon_tip", [0, 0, 0])
                col_offset = status.get("collision_offset", [0, 0.9, 0])
                t = i * interval

                # Position relative to player origin
                dx = tip[0] - player_pos[0]
                dz = tip[2] - player_pos[2]
                reach = math.sqrt(dx * dx + dz * dz)

                tips.append({
                    "t": round(t, 3),
                    "x": round(dx, 3),
                    "y": round(tip[1], 3),
                    "z": round(dz, 3),
                    "reach": round(reach, 3),
                })

                hips_dx = col_offset[0]
                hips_dz = col_offset[2]
                hips_disp = math.sqrt(hips_dx * hips_dx + hips_dz * hips_dz)
                max_hips_disp = max(max_hips_disp, hips_disp)

                if take_screenshots:
                    path = os.path.join(out_dir, f"{angle_name}_{i:03d}.png")
                    send_cmd({"cmd": "screenshot", "path": path})

                if i < num_samples - 1:
                    time.sleep(interval)

            result["weapon_tip_trajectory"] = tips
            result["max_hips_displacement_m"] = round(max_hips_disp, 3)
            result["has_steps"] = max_hips_disp > 0.3

            # Find reach peaks (individual hits)
            peaks = find_reach_peaks(tips)
            result["peaks"] = peaks
            result["num_hits"] = len(peaks)

            if peaks:
                # First hit data
                first = peaks[0]
                result["first_hit_fraction"] = round(first["t"] / duration, 3) if duration > 0 else 0.0
                result["first_hit_reach_m"] = first["reach"]
                result["first_hit_sweep_deg"] = compute_sweep_around_peak(tips, first["index"])

            # Overall max reach
            max_reach = max(t["reach"] for t in tips) if tips else 0.0
            result["max_reach_m"] = round(max_reach, 3)

            # Total sweep (all angles across entire animation)
            all_angles = []
            for tip_data in tips:
                if abs(tip_data["x"]) > 0.03 or abs(tip_data["z"]) > 0.03:
                    angle = math.degrees(math.atan2(tip_data["x"], -tip_data["z"]))
                    all_angles.append(angle)
            if all_angles:
                sweep = max(all_angles) - min(all_angles)
                if sweep > 180:
                    sweep = 360 - sweep
                result["total_sweep_deg"] = round(sweep, 1)

        elif take_screenshots:
            num_frames = max(int(duration * 5), 3)
            frame_interval = duration / num_frames
            for i in range(num_frames + 1):
                path = os.path.join(out_dir, f"{angle_name}_{i:03d}.png")
                send_cmd({"cmd": "screenshot", "path": path})
                if i < num_frames:
                    time.sleep(frame_interval)

        time.sleep(0.5)

    send_cmd({"cmd": "camera_attach"})
    return result


def print_results_table(results: list[dict]):
    print("\n" + "=" * 120)
    print(f"{'Animation':<12} {'Dur':>6} {'Hits':>4} {'1st%':>6} {'1stReach':>9} {'1stSweep':>9} {'MaxReach':>9} {'TotSweep':>9} {'Hips':>7}")
    print("-" * 120)
    for r in results:
        print(f"{r['key']:<12} {r['duration']:>5.2f}s {r['num_hits']:>4} "
              f"{r['first_hit_fraction']*100:>5.0f}% {r['first_hit_reach_m']:>8.3f}m "
              f"{r['first_hit_sweep_deg']:>8.1f}° {r['max_reach_m']:>8.3f}m "
              f"{r['total_sweep_deg']:>8.1f}° {r['max_hips_displacement_m']:>6.3f}m")
    print("=" * 120)


def main():
    parser = argparse.ArgumentParser(description="Attack animation mapping and measurement")
    parser.add_argument("anims", nargs="*", help="Animation names (default: all attack anims)")
    parser.add_argument("--no-screenshots", action="store_true", help="Skip screenshot capture")
    parser.add_argument("--no-room", action="store_true", help="Skip room loading")
    args = parser.parse_args()

    anims = args.anims if args.anims else ATTACK_ANIMS
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Attack Mapping Tool (v2 — orientation fix + multi-hit detection)")
    print(f"Animations: {', '.join(anims)}")
    print()

    try:
        status = send_cmd({"cmd": "status"})
        print(f"Connected (room: {status.get('room', '?')}, fps: {status.get('fps', 0)})")
    except Exception as e:
        print(f"ERROR: Cannot connect to Godot on port {PORT} -- {e}")
        sys.exit(1)

    if not args.no_room:
        print("Loading debug room...")
        setup_room()
        time.sleep(1)

    results = []
    for anim in anims:
        print(f"\nMeasuring: {anim}")
        r = measure_animation(anim, take_screenshots=not args.no_screenshots)
        results.append(r)
        hits_str = f"{r['num_hits']} hits" if r['num_hits'] > 1 else "1 hit"
        print(f"  Dur={r['duration']:.2f}s  {hits_str}  "
              f"1st@{r['first_hit_fraction']*100:.0f}% reach={r['first_hit_reach_m']:.3f}m "
              f"sweep={r['first_hit_sweep_deg']:.1f}°  "
              f"TotalSweep={r['total_sweep_deg']:.1f}°")

    print_results_table(results)

    # Save intrinsics (use first-hit data as primary)
    intrinsics = {}
    for r in results:
        intrinsics[r["key"]] = {
            "duration": r["duration"],
            "num_hits": r["num_hits"],
            "has_steps": r["has_steps"],
            "first_hit_fraction": r["first_hit_fraction"],
            "first_hit_reach_m": r["first_hit_reach_m"],
            "first_hit_sweep_deg": r["first_hit_sweep_deg"],
            "max_reach_m": r["max_reach_m"],
            "total_sweep_deg": r["total_sweep_deg"],
            "max_hips_displacement_m": r["max_hips_displacement_m"],
        }

    summary_path = os.path.join(OUTPUT_DIR, "intrinsics.json")
    with open(summary_path, "w") as f:
        json.dump(intrinsics, f, indent=2)
    print(f"\nIntrinsics saved to: {summary_path}")

    full_path = os.path.join(OUTPUT_DIR, "full_data.json")
    with open(full_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Full data saved to: {full_path}")


if __name__ == "__main__":
    main()
