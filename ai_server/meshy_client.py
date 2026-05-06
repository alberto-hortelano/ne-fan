"""Meshy AI client for text-to-3D and image-to-3D generation.

API docs: https://docs.meshy.ai
Requires MESHY_API_KEY environment variable.
"""

import asyncio
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


# ---------------------------------------------------------------------------
# Image-to-image (nano-banana family). Async-native because the test rig
# fan-outs many concurrent calls; Meshy Pro allows ~20 req/s.
# ---------------------------------------------------------------------------


class MeshyImageToImage:
    BASE_URL = "https://api.meshy.ai"
    ENDPOINT = "/openapi/v1/image-to-image"

    # Credit cost per call by ai_model (from docs.meshy.ai/en/api/pricing).
    # USD/credit is derived from the Pro plan ($20 / 1000 cr = $0.02/cr).
    MODEL_CREDITS = {
        "nano-banana": 3,
        "nano-banana-2": 6,
        "nano-banana-pro": 9,
    }
    USD_PER_CREDIT = 0.02

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("MESHY_API_KEY", "")
        if not self.api_key:
            raise ValueError("MESHY_API_KEY not set")
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    @classmethod
    def cost_usd(cls, ai_model: str) -> float:
        credits = cls.MODEL_CREDITS.get(ai_model)
        if credits is None:
            raise ValueError(f"unknown Meshy ai_model: {ai_model}")
        return credits * cls.USD_PER_CREDIT

    async def submit(
        self,
        ai_model: str,
        prompt: str,
        reference_image_urls: list[str],
        generate_multi_view: bool = False,
        client: Optional[httpx.AsyncClient] = None,
    ) -> str:
        """POST a new image-to-image task. Returns task_id."""
        if ai_model not in self.MODEL_CREDITS:
            raise ValueError(f"unknown Meshy ai_model: {ai_model}")
        if not 1 <= len(reference_image_urls) <= 5:
            raise ValueError("Meshy image-to-image accepts 1-5 reference images")

        payload = {
            "ai_model": ai_model,
            "prompt": prompt[:600],
            "reference_image_urls": reference_image_urls,
        }
        if generate_multi_view:
            payload["generate_multi_view"] = True

        async def _post(c: httpx.AsyncClient) -> str:
            response = await c.post(
                f"{self.BASE_URL}{self.ENDPOINT}",
                headers=self.headers,
                json=payload,
            )
            response.raise_for_status()
            return response.json()["result"]

        if client is None:
            async with httpx.AsyncClient(timeout=60.0) as c:
                return await _post(c)
        return await _post(client)

    async def wait(
        self,
        task_id: str,
        timeout: float = 180.0,
        poll_interval: float = 3.0,
        client: Optional[httpx.AsyncClient] = None,
    ) -> dict:
        """Poll the task until SUCCEEDED/FAILED/CANCELED. Returns the final task dict."""

        async def _poll(c: httpx.AsyncClient) -> dict:
            start = time.time()
            last_progress = -1
            while time.time() - start < timeout:
                response = await c.get(
                    f"{self.BASE_URL}{self.ENDPOINT}/{task_id}",
                    headers=self.headers,
                )
                response.raise_for_status()
                data = response.json()
                status = data.get("status", "")
                progress = data.get("progress", 0)
                if progress != last_progress:
                    print(f"MeshyI2I: {task_id[:8]} {status} {progress}%")
                    last_progress = progress
                if status in ("SUCCEEDED", "FAILED", "CANCELED"):
                    return data
                await asyncio.sleep(poll_interval)
            raise TimeoutError(f"Meshy image-to-image task {task_id} timed out after {timeout}s")

        if client is None:
            async with httpx.AsyncClient(timeout=30.0) as c:
                return await _poll(c)
        return await _poll(client)

    async def download(
        self,
        url: str,
        client: Optional[httpx.AsyncClient] = None,
    ) -> bytes:
        async def _get(c: httpx.AsyncClient) -> bytes:
            response = await c.get(url)
            response.raise_for_status()
            return response.content

        if client is None:
            async with httpx.AsyncClient(timeout=60.0) as c:
                return await _get(c)
        return await _get(client)

    async def run_one(
        self,
        ai_model: str,
        prompt: str,
        reference_image_urls: list[str],
        client: Optional[httpx.AsyncClient] = None,
    ) -> tuple[bytes, dict]:
        """submit -> wait -> download. Returns (png_bytes, task_dict). Raises on failure."""
        own_client = client is None
        if own_client:
            client = httpx.AsyncClient(timeout=60.0)
        try:
            task_id = await self.submit(ai_model, prompt, reference_image_urls, client=client)
            result = await self.wait(task_id, client=client)
            if result.get("status") != "SUCCEEDED":
                raise RuntimeError(
                    f"Meshy task {task_id} ended in {result.get('status')}: "
                    f"{result.get('task_error')}"
                )
            url = (
                result.get("image_url")
                or (result.get("image_urls") or [None])[0]
                or result.get("result_url")
            )
            if not url:
                raise RuntimeError(f"No output image url in Meshy response: {result}")
            return await self.download(url, client=client), result
        finally:
            if own_client:
                await client.aclose()
