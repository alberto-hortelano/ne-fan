#!/usr/bin/env python3
"""Remote control client for Godot. Sends JSON commands over TCP.

Usage:
    python tools/remote.py screenshot [path]
    python tools/remote.py key <action> [duration]
    python tools/remote.py mouse <dx> <dy>
    python tools/remote.py status
    python tools/remote.py sequence <file.json>

    echo '{"cmd":"screenshot"}' | python tools/remote.py raw
"""

import json
import socket
import sys
import time

HOST = "127.0.0.1"
PORT = 9876
TIMEOUT = 5.0


def send_command(cmd: dict) -> dict:
    """Send a single JSON command and return the response."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(TIMEOUT)
        s.connect((HOST, PORT))
        s.sendall((json.dumps(cmd) + "\n").encode())
        # Read response line
        data = b""
        while b"\n" not in data:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
        return json.loads(data.decode().strip()) if data else {"error": "no response"}


def send_sequence(commands: list[dict], delay: float = 0.1) -> list[dict]:
    """Send multiple commands over a persistent connection."""
    results = []
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(TIMEOUT)
        s.connect((HOST, PORT))

        for cmd in commands:
            wait_time = cmd.pop("_wait", delay)
            s.sendall((json.dumps(cmd) + "\n").encode())

            data = b""
            while b"\n" not in data:
                chunk = s.recv(4096)
                if not chunk:
                    break
                data += chunk

            resp = json.loads(data.decode().strip()) if data else {"error": "no response"}
            results.append(resp)
            print(f"  {cmd.get('cmd', '?')}: {resp}")

            if wait_time > 0:
                time.sleep(wait_time)

    return results


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    action = sys.argv[1]

    if action == "screenshot":
        path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/godot_screen.png"
        resp = send_command({"cmd": "screenshot", "path": path})
        print(json.dumps(resp))

    elif action == "key":
        act = sys.argv[2] if len(sys.argv) > 2 else "move_forward"
        dur = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
        resp = send_command({"cmd": "key", "action": act, "duration": dur})
        print(json.dumps(resp))

    elif action == "mouse":
        dx = float(sys.argv[2]) if len(sys.argv) > 2 else 0
        dy = float(sys.argv[3]) if len(sys.argv) > 3 else 0
        resp = send_command({"cmd": "mouse", "dx": dx, "dy": dy})
        print(json.dumps(resp))

    elif action == "status":
        resp = send_command({"cmd": "status"})
        print(json.dumps(resp, indent=2))

    elif action == "sequence":
        path = sys.argv[2]
        with open(path) as f:
            commands = json.load(f)
        send_sequence(commands)

    elif action == "raw":
        line = sys.stdin.read().strip()
        resp = send_command(json.loads(line))
        print(json.dumps(resp))

    else:
        print(f"Unknown action: {action}")
        sys.exit(1)


if __name__ == "__main__":
    main()
