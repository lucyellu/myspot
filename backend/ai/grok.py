"""Grok Imagine image generation via xAI REST API.

Reads XAI_API_KEY from secrets/ or env. Graceful no-op if missing.
$0.02 per image (no free tier as of March 2026).
"""
import base64
import time
from pathlib import Path

import httpx

from ..config import read_secret, GENS_DIR

_MODEL = "grok-2-image"
_ENDPOINT = "https://api.x.ai/v1/images/generations"


def is_available() -> bool:
    return bool(read_secret("XAI_API_KEY"))


def generate_image(prompt: str, song_id: int) -> dict:
    key = read_secret("XAI_API_KEY")
    if not key:
        return {"error": "Set secrets/XAI_API_KEY.txt to use Grok Imagine."}

    GENS_DIR.mkdir(parents=True, exist_ok=True)
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": _MODEL,
        "prompt": prompt,
        "n": 1,
        "response_format": "b64_json",
    }
    try:
        with httpx.Client(timeout=120) as client:
            r = client.post(_ENDPOINT, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        return {"error": f"Grok HTTP {e.response.status_code}: {e.response.text[:200]}"}
    except Exception as e:
        return {"error": f"Grok error: {type(e).__name__}: {e}"}

    items = data.get("data") or []
    if not items:
        return {"error": "Grok returned no images."}
    b64 = items[0].get("b64_json")
    if not b64:
        return {"error": "Grok response missing b64_json."}

    out = GENS_DIR / f"song{song_id}_{int(time.time()*1000)}_grok.png"
    out.write_bytes(base64.b64decode(b64))
    return {"file_path": str(out).replace("\\", "/"), "model_version": _MODEL}
