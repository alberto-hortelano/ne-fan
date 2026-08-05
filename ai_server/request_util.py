"""Helpers de request compartidos entre routers (narrativa y gpu-worker)."""

from fastapi import HTTPException


def decode_b64_png(image_b64: str) -> bytes:
    """Decode a base64 PNG (optionally a `data:image/png;base64,` URL) to bytes.
    Fail-loud: a malformed payload is a 400, not a silent empty image."""
    import base64
    raw = image_b64
    if raw.startswith("data:"):
        _, _, raw = raw.partition(",")
    try:
        return base64.b64decode(raw, validate=True)
    except (ValueError, base64.binascii.Error) as e:
        raise HTTPException(status_code=400, detail=f"invalid base64 image: {e}") from e
