"""Claude prompt enhancer.

Turns a song's metadata + lyrics into a polished image-generation prompt.
Reads ANTHROPIC_API_KEY from secrets/ or env. Graceful no-op if missing.
"""
from ..config import read_secret
from .gemini import get_art_director_system

_MODEL = "claude-sonnet-4-6"


def is_available() -> bool:
    return bool(read_secret("ANTHROPIC_API_KEY"))


def enhance_prompt(song: dict, user_seed: str | None = None, image_prompt: str | None = None) -> dict:
    """Return {'prompt': str} or {'error': str}.

    image_prompt: optional visual-reference description (from Gemini vision)
    that the prompt should harmonize with.
    """
    key = read_secret("ANTHROPIC_API_KEY")
    if not key:
        return {"error": "Set secrets/ANTHROPIC_API_KEY.txt to use Claude."}

    try:
        from anthropic import Anthropic
    except ImportError:
        return {"error": "anthropic package not installed: pip install anthropic"}

    excerpt = " / ".join(l["text"] for l in (song.get("lyrics") or [])[:8])
    sections = ", ".join(
        sorted({l["section"] for l in (song.get("lyrics") or []) if l.get("section")})
    )

    system = get_art_director_system()
    extras = []
    if user_seed:
        extras.append(f"User direction: {user_seed}")
    if image_prompt:
        extras.append(f"Visual reference (recreate this aesthetic): {image_prompt}")
    extras_str = "\n".join(extras)

    user_msg = f"""Song: "{song.get('title')}"
Genre cues: {song.get('genre') or 'unspecified'}
BPM: {song.get('bpm') or 'unspecified'}
Sections: {sections or 'unspecified'}
Lyrics excerpt: {excerpt or 'instrumental'}
Original Suno prompt: {song.get('prompt') or 'none'}
{extras_str}

Compose the image prompt for this song's signature visual frame."""

    client = Anthropic(api_key=key)
    try:
        msg = client.messages.create(
            model=_MODEL,
            max_tokens=600,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
    except Exception as e:
        return {"error": f"Claude error: {type(e).__name__}: {e}"}

    text = ""
    for block in msg.content:
        if getattr(block, "type", None) == "text":
            text += block.text
    return {"prompt": text.strip(), "model_version": _MODEL}
