"""Meshy AI client for text-to-3D and image-to-3D generation.

API docs: https://docs.meshy.ai
Requires MESHY_API_KEY environment variable.
"""

import os
import time
from typing import Optional

import httpx


class MeshyClient:
    BASE_URL = "https://api.meshy.ai"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("MESHY_API_KEY", "")
        if not self.api_key:
            raise ValueError("MESHY_API_KEY not set")
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def is_available(self) -> bool:
        return bool(self.api_key)

    def text_to_3d(
        self,
        prompt: str,
        art_style: str = "realistic",
        topology: str = "triangle",
        target_polycount: int = 5000,
        timeout: int = 600,
    ) -> bytes:
        """Generate a 3D model from text prompt. Returns GLB binary data.

        Two-stage process: preview (fast, untextured) then refine (textured PBR).
        """
        # Stage 1: Preview
        preview_id = self._create_preview_task(prompt, art_style, topology, target_polycount)
        print(f"MeshyClient: preview task {preview_id}")
        preview_result = self._wait_for_task(preview_id, timeout=timeout // 2)
        if preview_result.get("status") != "SUCCEEDED":
            raise RuntimeError(f"Meshy preview failed: {preview_result.get('task_error')}")

        # Stage 2: Refine (adds textures)
        refine_id = self._create_refine_task(preview_id)
        print(f"MeshyClient: refine task {refine_id}")
        refine_result = self._wait_for_task(refine_id, timeout=timeout // 2)
        if refine_result.get("status") != "SUCCEEDED":
            raise RuntimeError(f"Meshy refine failed: {refine_result.get('task_error')}")

        # Download GLB
        glb_url = refine_result.get("model_urls", {}).get("glb")
        if not glb_url:
            raise RuntimeError("No GLB URL in Meshy response")

        return self._download(glb_url)

    def _create_preview_task(
        self, prompt: str, art_style: str, topology: str, target_polycount: int
    ) -> str:
        payload = {
            "mode": "preview",
            "prompt": prompt[:600],
            "art_style": art_style,
            "topology": topology,
            "target_polycount": target_polycount,
            "should_remesh": True,
        }
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{self.BASE_URL}/openapi/v2/text-to-3d",
                headers=self.headers,
                json=payload,
            )
            response.raise_for_status()
            return response.json()["result"]

    def _create_refine_task(self, preview_id: str) -> str:
        payload = {
            "mode": "refine",
            "preview_task_id": preview_id,
            "enable_pbr": True,
        }
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{self.BASE_URL}/openapi/v2/text-to-3d",
                headers=self.headers,
                json=payload,
            )
            response.raise_for_status()
            return response.json()["result"]

    def _wait_for_task(self, task_id: str, timeout: int = 300, poll_interval: float = 3.0) -> dict:
        start = time.time()
        last_progress = -1
        while time.time() - start < timeout:
            with httpx.Client(timeout=30.0) as client:
                response = client.get(
                    f"{self.BASE_URL}/openapi/v2/text-to-3d/{task_id}",
                    headers=self.headers,
                )
                response.raise_for_status()
                data = response.json()

            status = data.get("status", "")
            progress = data.get("progress", 0)
            if progress != last_progress:
                print(f"MeshyClient: task {task_id[:8]} {status} {progress}%")
                last_progress = progress

            if status == "SUCCEEDED":
                return data
            if status == "FAILED":
                return data

            time.sleep(poll_interval)

        raise TimeoutError(f"Meshy task {task_id} timed out after {timeout}s")

    def _download(self, url: str) -> bytes:
        with httpx.Client(timeout=60.0) as client:
            response = client.get(url)
            response.raise_for_status()
            return response.content
