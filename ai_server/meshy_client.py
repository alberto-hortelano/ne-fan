"""Meshy AI client for text-to-3D and image-to-3D generation.

API docs: https://docs.meshy.ai
Requires MESHY_API_KEY environment variable.
"""

import asyncio
import base64
import os
import time

import httpx


# Límites de prompt por endpoint. 600 está DOCUMENTADO para los endpoints 3D
# (text-to-3d / image-to-3d); para image-to-image (nano-banana*) la doc no
# publica límite — 3000 da margen a la instrucción de escena completa (con las
# cláusulas de rol de la ref de estilo del bench 003 mide ~2800; con 2000 se
# truncaba la cola: descripción de escena, style_token y reglas de estilo).
# Si la API rechazara un prompt largo, el 4xx sube fail-loud con el mensaje
# de Meshy.
TEXT_TO_3D_PROMPT_MAX = 600
IMAGE_TO_IMAGE_PROMPT_MAX = 3000


def _clamp_prompt(prompt: str, limit: int, endpoint: str) -> str:
    """Trunca con AVISO RUIDOSO: perder instrucciones en silencio produce
    imágenes que ignoran el estilo/las reglas sin pista de por qué."""
    if len(prompt) <= limit:
        return prompt
    print(
        f"MeshyClient WARNING: prompt de {len(prompt)} chars truncado a {limit} "
        f"para {endpoint} — las instrucciones finales SE PIERDEN",
        flush=True,
    )
    return prompt[:limit]


class MeshyClient:
    BASE_URL = "https://api.meshy.ai"

    def __init__(self, api_key: str | None = None):
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
            "prompt": _clamp_prompt(prompt, TEXT_TO_3D_PROMPT_MAX, "text-to-3d"),
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
        "gpt-image-2": 12,
    }
    USD_PER_CREDIT = 0.02

    def __init__(self, api_key: str | None = None):
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
        client: httpx.AsyncClient | None = None,
    ) -> str:
        """POST a new image-to-image task. Returns task_id."""
        if ai_model not in self.MODEL_CREDITS:
            raise ValueError(f"unknown Meshy ai_model: {ai_model}")
        if not 1 <= len(reference_image_urls) <= 5:
            raise ValueError("Meshy image-to-image accepts 1-5 reference images")

        payload = {
            "ai_model": ai_model,
            "prompt": _clamp_prompt(prompt, IMAGE_TO_IMAGE_PROMPT_MAX, "image-to-image"),
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
        client: httpx.AsyncClient | None = None,
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
        client: httpx.AsyncClient | None = None,
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
        client: httpx.AsyncClient | None = None,
        aspect: tuple[int, int] | None = None,
    ) -> tuple[bytes, dict]:
        """submit -> wait -> download. Returns (png_bytes, task_dict).

        `aspect`: (w, h) del esquema de entrada — Meshy no admite control de
        tamaño de salida y lo ignora; el fallback fal lo usa para pedir el
        output en el aspect nativo (el estiramiento a cuadrado degrada la
        fidelidad de layout, bench 002_repaint_fidelity).

        Si MESHY falla (créditos agotados → 402, 5xx, timeout, task FAILED) y
        hay FAL_KEY, degrada a fal.ai con el MISMO modelo (mismo contrato de
        refs como data URIs). Errores de CICLO DE VIDA del caller (p. ej.
        "client has been closed" cuando el AsyncClient compartido de un
        fan-out se cerró por el fallo de una sublamada hermana) NO degradan:
        reintentar por fal una petición cuyo trabajo padre ya murió solo
        amplifica el gasto. Sin FAL_KEY el error original sube tal cual
        (fail-loud)."""
        try:
            return await self._run_one_meshy(ai_model, prompt, reference_image_urls, client)
        except Exception as err:
            meshy_unavailable = isinstance(
                err, (httpx.HTTPStatusError, httpx.TimeoutException, TimeoutError)
            ) or (isinstance(err, RuntimeError) and str(err).startswith("Meshy task"))
            fal_key = os.environ.get("FAL_KEY", "")
            if not meshy_unavailable or not fal_key:
                raise
            print(f"MeshyI2I: fallo ({err!r:.180}) → fallback fal.ai {ai_model}", flush=True)
            return await FalImageToImage(fal_key).run_one(
                prompt, reference_image_urls, ai_model=ai_model, aspect=aspect
            )

    async def _run_one_meshy(
        self,
        ai_model: str,
        prompt: str,
        reference_image_urls: list[str],
        client: httpx.AsyncClient | None = None,
    ) -> tuple[bytes, dict]:
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


class FalImageToImage:
    """Los mismos modelos i2i servidos por fal.ai — fallback de
    MeshyImageToImage con el MISMO id de modelo (validado en
    style_lab/{README.md,fidelity.py}). Endpoints REST síncronos con
    `image_urls` (admite data URIs — el mismo formato de refs que usa el
    pipeline con Meshy); la respuesta puede traer la imagen como URL http o
    como data URI."""

    #: id de modelo Meshy → (endpoint de edit en fal, params extra).
    MODELS = {
        "gpt-image-2": ("https://fal.run/openai/gpt-image-2/edit", {"quality": "high"}),
        "nano-banana-pro": (
            "https://fal.run/fal-ai/nano-banana-pro/edit",
            {"resolution": "1K"},
        ),
    }
    #: Ratios que admite nano-banana-pro (gpt-image-2 acepta tamaño exacto).
    NANO_RATIOS = ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"]
    #: Coste aproximado por imagen 1K/1024² (dashboard de fal).
    COST_USD = {"gpt-image-2": 0.17, "nano-banana-pro": 0.15}

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.environ.get("FAL_KEY", "")
        if not self.api_key:
            raise ValueError("FAL_KEY not set")

    @classmethod
    def _size_params(cls, ai_model: str, aspect: tuple[int, int] | None) -> dict:
        """Params de tamaño con el aspect nativo del esquema: el estiramiento
        anamórfico a cuadrado degrada la fidelidad de layout (bench
        002_repaint_fidelity). Sin aspect, cuadrado clásico."""
        if aspect is None:
            return {"image_size": "square_hd"} if ai_model == "gpt-image-2" else {
                "aspect_ratio": "1:1"
            }
        w, h = aspect
        if ai_model == "gpt-image-2":
            # Tamaño exacto: múltiplos de 16, lado largo ~1280.
            scale = 1280 / max(w, h)
            return {
                "image_size": {
                    "width": round(w * scale / 16) * 16,
                    "height": round(h * scale / 16) * 16,
                }
            }
        target = w / h
        return {
            "aspect_ratio": min(
                cls.NANO_RATIOS, key=lambda r: abs(int(r.split(":")[0]) / int(r.split(":")[1]) - target)
            )
        }

    async def run_one(
        self,
        prompt: str,
        reference_image_urls: list[str],
        ai_model: str = "gpt-image-2",
        aspect: tuple[int, int] | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> tuple[bytes, dict]:
        """Devuelve (png_bytes, task_dict) con el mismo shape de retorno que
        MeshyImageToImage.run_one (task_dict mínimo con provider="fal")."""
        if ai_model not in self.MODELS:
            raise ValueError(
                f"fal fallback no mapea el modelo '{ai_model}' (soporta {list(self.MODELS)})"
            )
        if not reference_image_urls:
            raise ValueError("FalImageToImage.run_one requiere al menos una referencia")
        if len(reference_image_urls) > 5:
            raise ValueError("fal edit accepts at most 5 reference images")
        url, extra = self.MODELS[ai_model]
        payload: dict = {
            "prompt": prompt,
            "num_images": 1,
            "output_format": "png",
            "image_urls": reference_image_urls,
            **extra,
            **self._size_params(ai_model, aspect),
        }
        headers = {"Authorization": f"Key {self.api_key}", "Content-Type": "application/json"}

        async def _run(c: httpx.AsyncClient) -> tuple[bytes, dict]:
            start = time.time()
            response = await c.post(url, headers=headers, json=payload)
            if response.status_code >= 400:
                # El body de fal trae la causa real (p. ej. "Exhausted balance") —
                # sin esto el cliente solo ve un "403 Forbidden" opaco.
                raise RuntimeError(
                    f"fal.ai HTTP {response.status_code}: {response.text[:300]}"
                )
            data = response.json()
            images = data.get("images") or []
            if not images or not images[0].get("url"):
                raise RuntimeError(f"No output image in fal response: {str(data)[:300]}")
            img_url = images[0]["url"]
            if img_url.startswith("data:"):
                png = base64.b64decode(img_url.split(",", 1)[1])
            else:
                got = await c.get(img_url)
                got.raise_for_status()
                png = got.content
            print(f"FalI2I: {ai_model} OK ({time.time() - start:.0f}s)", flush=True)
            return png, {"provider": "fal", "model": ai_model}

        if client is None:
            # gpt-image-2 high tarda ~200-300 s y fal.run bloquea hasta terminar.
            async with httpx.AsyncClient(timeout=600.0) as c:
                return await _run(c)
        return await _run(client)
