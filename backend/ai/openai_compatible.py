"""Shared OpenAI-compatible prompt enhancer plumbing."""
import httpx

from ..config import read_secret
from .gemini import get_art_director_system


def _song_user_message(
    song: dict,
    user_seed: str | None = None,
    image_prompt: str | None = None,
) -> str:
    excerpt = " / ".join(l["text"] for l in (song.get("lyrics") or [])[:8])
    sections = ", ".join(
        sorted({l["section"] for l in (song.get("lyrics") or []) if l.get("section")})
    )

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
    return "\n".join(user_lines)


def enhance_prompt_via_chat(
    *,
    provider_name: str,
    api_key_name: str,
    endpoint: str,
    model: str,
    song: dict,
    user_seed: str | None = None,
    image_prompt: str | None = None,
    token_param: str = "max_completion_tokens",
    extra_payload: dict | None = None,
) -> dict:
    """Return {'prompt': str, 'model_version': str} or {'error': str}."""
    key = read_secret(api_key_name)
    if not key:
        return {"error": f"Set {api_key_name} in .env or secrets/ to use {provider_name}."}

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": get_art_director_system()},
            {"role": "user", "content": _song_user_message(song, user_seed, image_prompt)},
        ],
        token_param: 700,
        "temperature": 0.7,
    }
    if extra_payload:
        payload.update(extra_payload)

    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=60) as client:
            r = client.post(endpoint, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        return {"error": f"{provider_name} HTTP {e.response.status_code}: {e.response.text[:200]}"}
    except Exception as e:
        return {"error": f"{provider_name} error: {type(e).__name__}: {e}"}

    text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content", "").strip()
    if not text:
        return {"error": f"{provider_name} returned empty response."}
    return {"prompt": text, "model_version": model}
