"""Image-to-prompt via Gemini multimodal vision.

Takes an uploaded image (bytes) or a remote URL → returns a vivid
diffusion-style prompt that captures the visual essence so it can be
fed back into Nano Banana / Grok / etc. for "recreate this aesthetic".
"""
import io

import httpx
from PIL import Image

from ..config import read_secret

# Try in order — automatic fallback when Google's free tier 503s/429s on the
# preferred model. gemini-2.5-flash is best for visual reasoning; lite is the
# cheapest backup; 1.5-flash is the most rate-limit-tolerant of all.
_VISION_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]


def is_available() -> bool:
    return bool(read_secret("GEMINI_API_KEY"))


def _build_instruction(song: dict | None, user_seed: str | None) -> str:
    parts = [
        "Describe this image as a vivid, single-paragraph image-generation prompt "
        "(160-240 words). Capture concretely: subject, framing/composition, palette, "
        "lighting (key/fill, time of day, source), mood, style, texture, era, "
        "camera-style cues if relevant. Write language a diffusion model parses well. "
        "Output ONE paragraph, no preamble, no markdown, no quotes."
    ]
    if song:
        parts.append(
            f' The output will guide visuals for the song "{song.get("title", "")}"'
            + (f" (genre: {song['genre']})" if song.get("genre") else "")
            + ". Harmonize the description with that mood when natural."
        )
    if user_seed:
        parts.append(f" Additional user direction: {user_seed}")
    return " ".join(parts)


def _to_jpeg_bytes(raw: bytes) -> tuple[bytes, str]:
    """Best-effort normalize to JPEG. Returns (bytes, mime). Falls back to PNG mime
    if conversion fails so the upstream still gets the original bytes."""
    try:
        im = Image.open(io.BytesIO(raw))
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        # cap pixel count to keep payload reasonable
        max_side = 1600
        if max(im.size) > max_side:
            im.thumbnail((max_side, max_side))
        out = io.BytesIO()
        im.save(out, "JPEG", quality=85)
        return out.getvalue(), "image/jpeg"
    except Exception:
        return raw, "application/octet-stream"


def inspire_from_image_bytes(
    image_bytes: bytes,
    song: dict | None = None,
    user_seed: str | None = None,
) -> dict:
    key = read_secret("GEMINI_API_KEY")
    if not key:
        return {"error": "Set GEMINI_API_KEY in .env or secrets/ to use image inspiration."}
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return {"error": "google-genai package not installed: pip install google-genai"}

    norm_bytes, mime = _to_jpeg_bytes(image_bytes)
    client = genai.Client(api_key=key)
    instruction = _build_instruction(song, user_seed)
    contents = [types.Part.from_bytes(data=norm_bytes, mime_type=mime), instruction]

    last_err = None
    for model in _VISION_MODELS:
        try:
            response = client.models.generate_content(model=model, contents=contents)
        except Exception as e:
            err_str = str(e)
            last_err = f"{type(e).__name__}: {e}"
            # Only fall through on capacity/quota errors; bail on real failures.
            if any(s in err_str for s in ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED")):
                continue
            return {"error": f"Gemini vision error: {last_err}"}
        text = (getattr(response, "text", "") or "").strip()
        if text:
            return {"prompt": text, "model_version": model}
        last_err = f"{model} returned empty"
    return {"error": f"Gemini vision exhausted fallbacks. Last: {last_err}"}


def inspire_from_url(
    url: str,
    song: dict | None = None,
    user_seed: str | None = None,
) -> dict:
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        return {"error": "URL must start with http:// or https://"}

    try:
        with httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": "myspot/0.1"}) as c:
            r = c.get(url)
            r.raise_for_status()
            ct = (r.headers.get("content-type") or "").split(";")[0].strip()
            data = r.content
    except httpx.HTTPStatusError as e:
        return {"error": f"Fetch HTTP {e.response.status_code}"}
    except Exception as e:
        return {"error": f"Fetch failed: {type(e).__name__}: {e}"}

    if not (ct.startswith("image/") or _looks_like_image(data)):
        return {"error": f"URL didn't return an image (content-type: {ct or 'unknown'})"}

    return inspire_from_image_bytes(data, song=song, user_seed=user_seed)


def _looks_like_image(b: bytes) -> bool:
    if len(b) < 8:
        return False
    return (
        b[:3] == b"\xff\xd8\xff"          # JPEG
        or b[:8] == b"\x89PNG\r\n\x1a\n"  # PNG
        or b[:6] in (b"GIF87a", b"GIF89a")
        or b[:4] == b"RIFF" and b[8:12] == b"WEBP"
    )
