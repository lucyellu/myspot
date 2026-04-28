"""Pollinations.ai — free FLUX image generation (no key required).

URL pattern: https://image.pollinations.ai/prompt/{url-encoded prompt}?...
Models: flux (FLUX.dev), flux-realism, flux-anime, flux-3d, turbo (faster/lower).
No auth. Generous rate limits. Quality on par with Nano Banana for most styles.
"""
import time
import urllib.parse

import httpx

from ..config import GENS_DIR

_BASE = "https://image.pollinations.ai/prompt/"
_DEFAULT_MODEL = "flux"
# 1024x1024 is FLUX-native — sharper subjects, no full-body distortion.
# The player letterboxes square art with a blur backdrop, so this looks fine.
_DEFAULT_W = 1024
_DEFAULT_H = 1024
_MAX_PROMPT_LEN = 1900


def is_available() -> bool:
    return True  # no key required


def generate_image(
    prompt: str,
    song_id: int,
    model: str = _DEFAULT_MODEL,
    width: int = _DEFAULT_W,
    height: int = _DEFAULT_H,
) -> dict:
    GENS_DIR.mkdir(parents=True, exist_ok=True)
    encoded = urllib.parse.quote(prompt[:_MAX_PROMPT_LEN], safe="")
    seed = int(time.time() * 1000) % 1_000_000
    url = (
        f"{_BASE}{encoded}"
        f"?width={width}&height={height}&model={model}&seed={seed}"
        f"&nologo=true&enhance=true"
    )

    try:
        with httpx.Client(timeout=180, follow_redirects=True,
                           headers={"User-Agent": "myspot/0.1 (https://localhost)"}) as c:
            r = c.get(url)
            r.raise_for_status()
            data = r.content
            ct = (r.headers.get("content-type") or "").split(";")[0]
    except httpx.HTTPStatusError as e:
        return {"error": f"Pollinations HTTP {e.response.status_code}: {e.response.text[:200]}"}
    except Exception as e:
        return {"error": f"Pollinations error: {type(e).__name__}: {e}"}

    if not data or len(data) < 1024 or not ct.startswith("image/"):
        return {"error": f"Pollinations returned non-image (ct={ct} bytes={len(data)})"}

    suffix = ".jpg" if "jpeg" in ct else ".png"
    out = GENS_DIR / f"song{song_id}_{int(time.time()*1000)}_pollinations{suffix}"
    out.write_bytes(data)
    return {
        "file_path": str(out).replace("\\", "/"),
        "model_version": f"pollinations/{model}",
        "size_bytes": len(data),
    }
