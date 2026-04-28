"""HuggingFace Inference Providers — premium-quality free image + video gen.

Setup:
    1. Sign up at https://huggingface.co/ (free)
    2. Create a token at https://huggingface.co/settings/tokens
       (read access is enough for inference)
    3. Paste into .env: HF_TOKEN=hf_...

Free tier (April 2026):
    Personal account: ~$0.10/month included credit (~30 FLUX-schnell images
    or ~3 short LTX-Video clips). HF Pro ($9/mo) gives ~$2/month credit
    (~600 FLUX-schnell images / ~60 LTX-Video clips).

Models exposed here:
    - black-forest-labs/FLUX.1-schnell  (text-to-image, fast, Apache-licensed)
    - black-forest-labs/FLUX.1-dev      (text-to-image, slower/higher quality)
    - Lightricks/LTX-Video              (image-to-video, 5 sec, 768x512)

Endpoint pattern:
    https://router.huggingface.co/hf-inference/models/{model}
"""
import time
from io import BytesIO

import httpx

from ..config import read_secret, GENS_DIR


_BASE = "https://router.huggingface.co/hf-inference/models"
_HEADERS = lambda key: {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def is_available() -> bool:
    return bool(read_secret("HF_TOKEN"))


# ----- text-to-image -----

def generate_image(
    prompt: str,
    song_id: int,
    model: str = "black-forest-labs/FLUX.1-schnell",
    width: int = 1024,
    height: int = 1024,
) -> dict:
    key = read_secret("HF_TOKEN")
    if not key:
        return {"error": "Set HF_TOKEN in .env (free at huggingface.co/settings/tokens)"}

    GENS_DIR.mkdir(parents=True, exist_ok=True)
    url = f"{_BASE}/{model}"
    payload = {
        "inputs": prompt[:1900],
        "parameters": {"width": width, "height": height},
    }
    try:
        with httpx.Client(timeout=180) as c:
            r = c.post(url, headers={"Authorization": f"Bearer {key}"}, json=payload)
            if r.status_code == 503:
                # Model loading — HF cold-starts can take 30-60s
                return {"error": "HF model is cold-loading; try again in ~30s."}
            if r.status_code == 402:
                return {"error": "HF: monthly free credit exhausted. Top up or upgrade Pro."}
            r.raise_for_status()
            data = r.content
            ct = (r.headers.get("content-type") or "").split(";")[0]
    except httpx.HTTPStatusError as e:
        return {"error": f"HF HTTP {e.response.status_code}: {e.response.text[:200]}"}
    except Exception as e:
        return {"error": f"HF error: {type(e).__name__}: {e}"}

    if not ct.startswith("image/") or len(data) < 1024:
        return {"error": f"HF returned non-image (ct={ct} bytes={len(data)})"}

    suffix = ".jpg" if "jpeg" in ct else ".png"
    short = model.split("/")[-1].lower().replace(".", "")[:20]
    out = GENS_DIR / f"song{song_id}_{int(time.time()*1000)}_hf_{short}{suffix}"
    out.write_bytes(data)
    return {
        "file_path": str(out).replace("\\", "/"),
        "model_version": f"hf/{model}",
        "size_bytes": len(data),
    }


# ----- image-to-video -----

def animate_image(
    image_bytes: bytes,
    prompt: str,
    song_id: int,
    model: str = "Lightricks/LTX-Video",
) -> dict:
    """Image-to-video. Returns mp4 saved to data/gens/.

    LTX-Video produces ~5 second 768x512 clips. Quality is below Kling but works
    automatically. Each call burns ~$0.05 of HF credit.
    """
    key = read_secret("HF_TOKEN")
    if not key:
        return {"error": "Set HF_TOKEN in .env (free at huggingface.co/settings/tokens)"}

    GENS_DIR.mkdir(parents=True, exist_ok=True)
    import base64
    image_b64 = base64.b64encode(image_bytes).decode("ascii")

    url = f"{_BASE}/{model}"
    payload = {
        "inputs": {
            "image": image_b64,
            "prompt": prompt[:500],
        },
        "parameters": {
            "num_frames": 121,  # ~5s at 24fps
            "guidance_scale": 3.0,
        },
    }
    try:
        with httpx.Client(timeout=600) as c:  # I2V is slow
            r = c.post(url, headers={"Authorization": f"Bearer {key}"}, json=payload)
            if r.status_code == 503:
                return {"error": "HF model cold-loading; try again in ~60s."}
            if r.status_code == 402:
                return {"error": "HF: monthly free credit exhausted."}
            r.raise_for_status()
            data = r.content
            ct = (r.headers.get("content-type") or "").split(";")[0]
    except httpx.HTTPStatusError as e:
        return {"error": f"HF HTTP {e.response.status_code}: {e.response.text[:200]}"}
    except Exception as e:
        return {"error": f"HF animate error: {type(e).__name__}: {e}"}

    if not (ct.startswith("video/") or ct == "application/octet-stream") or len(data) < 4096:
        return {"error": f"HF returned non-video (ct={ct} bytes={len(data)})"}

    out = GENS_DIR / f"song{song_id}_{int(time.time()*1000)}_ltx_video.mp4"
    out.write_bytes(data)
    return {
        "file_path": str(out).replace("\\", "/"),
        "model_version": f"hf/{model}",
        "size_bytes": len(data),
    }
