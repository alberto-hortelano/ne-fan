"""Binary TCP server for low-latency frame transforms.

Protocol (little-endian):
  Request:  [4:prompt_len][prompt_utf8][4:seed][4:steps][4:img_len][img_png]
  Response: [4:jpeg_len][jpeg_data][4:time_ms]
"""

import io
import os
import struct
import socket
import time
import threading

from PIL import Image


def _recv_exact(conn, n):
    """Read exactly n bytes from socket."""
    data = bytearray()
    while len(data) < n:
        chunk = conn.recv(n - len(data))
        if not chunk:
            raise ConnectionError("Connection closed")
        data.extend(chunk)
    return bytes(data)


def _handle_client(conn, pipeline, config):
    """Handle one connected client, processing frames until disconnect."""
    last_result = None
    last_prompt = None
    temporal_blend = config.get("temporal_blend", 0.65)
    frame_count = 0
    dump_dir = config.get("dump_frames_dir", "")
    if dump_dir:
        os.makedirs(dump_dir, exist_ok=True)
        print(f"Pipe server: dumping frames to {dump_dir}/")

    try:
        while True:
            # Read prompt
            prompt_len = struct.unpack('<I', _recv_exact(conn, 4))[0]
            prompt = _recv_exact(conn, prompt_len).decode('utf-8')

            # Read seed and steps
            seed = struct.unpack('<i', _recv_exact(conn, 4))[0]
            steps = struct.unpack('<i', _recv_exact(conn, 4))[0]

            # Read image
            img_len = struct.unpack('<I', _recv_exact(conn, 4))[0]
            img_data = _recv_exact(conn, img_len)

            image = Image.open(io.BytesIO(img_data))

            actual_prompt = prompt or config.get("default_prompt", "")
            actual_steps = steps if steps > 0 else config.get("num_inference_steps", 4)
            cn_scale = config.get("controlnet_conditioning_scale", 0.8)
            guidance = config.get("guidance_scale", 1.5)

            # Reset temporal reference if prompt changed significantly
            if last_prompt is not None and actual_prompt != last_prompt:
                last_result = None
            last_prompt = actual_prompt

            start = time.perf_counter()
            result = pipeline.transform(
                image=image,
                prompt=actual_prompt,
                num_inference_steps=actual_steps,
                guidance_scale=guidance,
                controlnet_conditioning_scale=cn_scale,
                seed=seed if seed >= 0 else None,
                prev_image=last_result,
                temporal_blend=temporal_blend,
            )
            elapsed_ms = int((time.perf_counter() - start) * 1000)

            # Store result for temporal consistency on next frame
            last_result = result
            frame_count += 1

            # Dump frame to disk if enabled
            if dump_dir:
                result.save(os.path.join(dump_dir, f"frame_{frame_count:04d}.jpg"), quality=90)

            # Encode JPEG
            buf = io.BytesIO()
            result.save(buf, format="JPEG", quality=85)
            jpeg_data = buf.getvalue()

            # Send: [4:jpeg_len][jpeg_data][4:time_ms]
            conn.sendall(struct.pack('<I', len(jpeg_data)))
            conn.sendall(jpeg_data)
            conn.sendall(struct.pack('<I', elapsed_ms))

    except (ConnectionError, struct.error, OSError):
        pass
    finally:
        conn.close()
        print("Pipe server: client disconnected")


def run_pipe_server(pipeline, config, port=8764):
    """Run TCP server for binary frame transforms."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('127.0.0.1', port))
    server.listen(1)
    print(f"Pipe server listening on 127.0.0.1:{port}")

    while True:
        conn, addr = server.accept()
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        print(f"Pipe server: client connected from {addr}")
        # One client at a time — pipeline is not thread-safe
        _handle_client(conn, pipeline, config)
