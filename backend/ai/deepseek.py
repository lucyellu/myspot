"""DeepSeek prompt enhancer (OpenAI-compatible API).

Uses deepseek-chat (V3) — strong at long-form descriptive writing, much
cheaper than Claude for this use case (~$0.14/M input tokens).
"""
import httpx
from ..config import read_secret
from .gemini import get_art_director_system

_MODEL = "deepseek-chat"
_ENDPOINT = "https://api.deepseek.com/chat/completions"


def is_available() -> bool:
    return bool(read_secret("DEEPSEEK_API_KEY"))


def enhance_prompt(song: dict, user_seed: str | None = None, image_prompt: str | None = None) -> dict:
    """Return {'prompt': str, 'model_version': str} or {'error': str}."""
    key = read_secret("DEEPSEEK_API_KEY")
    if not key:
        return {"error": "Set DEEPSEEK_API_KEY in .env or secrets/ to use DeepSeek."}

    excerpt = " / ".join(l["text"] for l in (song.get("lyrics") or [])[:8])
    sections = ", ".join(
        sorted({l["section"] for l in (song.get("lyrics") or []) if l.get("section")})
    )

    system = get_art_director_system()
    user_lines = [
        f'Song: "{song.get("title")}"',
        f'Genre cues: {song.get("genre") or "unspecified"}',
        f'BPM: {song.get("bpm") or "unspecified"}',
        f'Sections: {sections or "unspecified"}',
        f'Lyrics excerpt: {excerpt or "instrumental"}',
        f'Original Suno prompt: {song.get("prompt") or "none"}',
    ]
    if user_seed:
        user_lines.append(f"User direction: {user_seed}")
    if image_prompt:
        user_lines.append(f'Visual reference (recreate this aesthetic): {image_prompt}')
    user_lines.append("\nCompose the image prompt for this song's signature visual frame.")
    user_msg = "\n".join(user_lines)

    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": _MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ],
        "max_tokens": 700,
        "temperature": 0.7,
    }

    try:
        with httpx.Client(timeout=60) as client:
            r = client.post(_ENDPOINT, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        return {"error": f"DeepSeek HTTP {e.response.status_code}: {e.response.text[:200]}"}
    except Exception as e:
        return {"error": f"DeepSeek error: {type(e).__name__}: {e}"}

    text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content", "").strip()
    if not text:
        return {"error": "DeepSeek returned empty response."}
    return {"prompt": text, "model_version": _MODEL}
