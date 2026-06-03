"""OpenAI GPT Image generation via the Images API."""
import base64
import time

import httpx

from ..config import read_secret, GENS_DIR

_ENDPOINT = "https://api.openai.com/v1/images/generations"
_DEFAULT_MODEL = "gpt-image-2"
_MAX_PROMPT_LEN = 32000


def is_available() -> bool:
    return bool(read_secret("OPENAI_API_KEY"))


def _size(width: int, height: int) -> str:
    if width > height:
        return "1536x1024"
    if height > width:
        return "1024x1536"
    return "1024x1024"


def generate_image(
    prompt: str,
    song_id: int,
    model: str = _DEFAULT_MODEL,
    width: int = 1024,
    height: int = 1024,
    quality: str = "medium",
    output_format: str = "png",
) -> dict:
    key = read_secret("OPENAI_API_KEY")
    if not key:
        return {"error": "Set OPENAI_API_KEY in .env or secrets/OPENAI_API_KEY.txt"}

    GENS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "model": model,
        "prompt": prompt[:_MAX_PROMPT_LEN],
        "size": _size(width, height),
        "quality": quality,
        "output_format": output_format,
    }

    try:
        with httpx.Client(timeout=600) as client:
            r = client.post(
                _ENDPOINT,
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        return {"error": f"OpenAI HTTP {e.response.status_code}: {e.response.text[:500]}"}
    except Exception as e:
        return {"error": f"OpenAI image error: {type(e).__name__}: {e}"}

    images = data.get("data") or []
    if not images or not images[0].get("b64_json"):
        return {"error": "OpenAI returned no image data."}

    try:
        image_bytes = base64.b64decode(images[0]["b64_json"])
    except Exception as e:
        return {"error": f"OpenAI image decode failed: {e}"}

    suffix = ".jpg" if output_format == "jpeg" else f".{output_format}"
    short = model.replace(".", "").replace("-", "_")[:32]
    out = GENS_DIR / f"song{song_id}_{int(time.time()*1000)}_openai_{short}{suffix}"
    out.write_bytes(image_bytes)
    return {
        "file_path": str(out).replace("\\", "/"),
        "model_version": f"openai/{model}",
        "size_bytes": len(image_bytes),
    }
