"""Gemini integrations: Nano Banana image generation + text prompt enhancement.

Reads GEMINI_API_KEY from secrets/ or env. Graceful no-op if missing.

As of April 2026:
- gemini-2.5-flash-image (Nano Banana): paid only on new projects
  (~$0.04/image). Free tier removed for image gen on most projects.
- gemini-2.5-flash (text): 250 RPD free; ~$0.0008 per enhance call paid.
"""
import time
from pathlib import Path

from ..config import read_secret, GENS_DIR

_MODEL = "gemini-2.5-flash-image"
_TEXT_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"]


# Shared "art director" system prompt — used by both Gemini-text and DeepSeek
# enhancers via backend/ai/__init__.py imports.
_ART_DIRECTOR_SYSTEM = (
    "You are an art director composing a dense image-generation prompt for a "
    "music video frame. Output ONE paragraph, 180-260 words, no preamble, no "
    "markdown, no quotes. The prompt MUST include all of:\n"
    "  1. A specific cinematographer or director reference (e.g. Wong Kar-wai, "
    "Wes Anderson, Stanley Kubrick, Roger Deakins, Emmanuel Lubezki, Spike "
    "Jonze, Michel Gondry, David Fincher, Hayao Miyazaki, Satoshi Kon). "
    "Choose one whose style fits the song's mood.\n"
    "  2. A music video, film, or aesthetic touchpoint (e.g. 'in the spirit of "
    "Daft Punk's \"Around the World\"', 'A24 indie palette', 'late-90s MTV "
    "anti-glamour', 'Akira opening sequence').\n"
    "  3. A camera or film-stock cue (35mm anamorphic, super-8, polaroid, VHS, "
    "iPhone vertical, drone, DSLR shallow DOF).\n"
    "  4. Concrete lighting (key/fill, time of day, source), palette (3-5 "
    "color words), composition/framing, mood/era.\n"
    "Be specific and original — name the painters, photographers, places, "
    "props, materials. Avoid generic adjectives like 'beautiful' or 'amazing'. "
    "No copyrighted-character names. The output is a single paragraph."
)


def get_art_director_system() -> str:
    return _ART_DIRECTOR_SYSTEM


def is_available() -> bool:
    return bool(read_secret("GEMINI_API_KEY"))


def is_text_available() -> bool:
    return bool(read_secret("GEMINI_API_KEY"))


def enhance_prompt(song: dict, user_seed: str | None = None, image_prompt: str | None = None) -> dict:
    """Use Gemini 2.5 Flash for prompt enhancement (free 250 RPD, paid beyond).

    Auto-falls-through 503/429 to gemini-2.0-flash so free-tier capacity hits
    don't fail the user.
    """
    key = read_secret("GEMINI_API_KEY")
    if not key:
        return {"error": "Set GEMINI_API_KEY in .env or secrets/ to use Gemini."}
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return {"error": "google-genai not installed: pip install google-genai"}

    excerpt = " / ".join(l["text"] for l in (song.get("lyrics") or [])[:8])
    sections = ", ".join(
        sorted({l["section"] for l in (song.get("lyrics") or []) if l.get("section")})
    )

    extras = []
    if user_seed:
        extras.append(f"User direction: {user_seed}")
    if image_prompt:
        extras.append(f"Visual reference (recreate this aesthetic): {image_prompt}")
    extras_str = "\n".join(extras)

    system = _ART_DIRECTOR_SYSTEM
    user_msg = (
        f'Song: "{song.get("title")}"\n'
        f'Genre cues: {song.get("genre") or "unspecified"}\n'
        f'BPM: {song.get("bpm") or "unspecified"}\n'
        f'Sections: {sections or "unspecified"}\n'
        f'Lyrics excerpt: {excerpt or "instrumental"}\n'
        f'Original Suno prompt: {song.get("prompt") or "none"}\n'
        f'{extras_str}\n\n'
        "Compose the image prompt for this song's signature visual frame."
    )

    client = genai.Client(api_key=key)
    last_err = None
    for model in _TEXT_MODELS:
        try:
            response = client.models.generate_content(
                model=model,
                contents=user_msg,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=0.8,
                    max_output_tokens=700,
                ),
            )
        except Exception as e:
            err_str = str(e)
            last_err = f"{type(e).__name__}: {e}"
            if any(s in err_str for s in ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED")):
                continue
            return {"error": f"Gemini text error: {last_err}"}
        text = (getattr(response, "text", "") or "").strip()
        if text:
            return {"prompt": text, "model_version": model}
        last_err = f"{model} returned empty"
    return {"error": f"Gemini text exhausted fallbacks. Last: {last_err}"}


def generate_image(prompt: str, song_id: int) -> dict:
    """Return {'file_path': str, 'model_version': str} or {'error': str}."""
    key = read_secret("GEMINI_API_KEY")
    if not key:
        return {"error": "Set secrets/GEMINI_API_KEY.txt to use Gemini."}

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return {"error": "google-genai package not installed: pip install google-genai"}

    GENS_DIR.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=key)
    try:
        response = client.models.generate_content(
            model=_MODEL,
            contents=[prompt],
            config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
        )
    except Exception as e:
        return {"error": f"Gemini error: {type(e).__name__}: {e}"}

    image_bytes = None
    for cand in response.candidates or []:
        for part in cand.content.parts or []:
            inline = getattr(part, "inline_data", None)
            if inline and inline.data:
                image_bytes = inline.data
                break
        if image_bytes:
            break
    if not image_bytes:
        return {"error": "Gemini returned no image data."}

    out = GENS_DIR / f"song{song_id}_{int(time.time()*1000)}_gemini.png"
    out.write_bytes(image_bytes)
    return {"file_path": str(out).replace("\\", "/"), "model_version": _MODEL}
