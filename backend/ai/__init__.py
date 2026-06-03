"""Tool registry for AI generators.

Each tool exposes:
    is_available() -> bool
    generate_image(prompt: str, song_id: int) -> dict        # gemini, grok
    enhance_prompt(song: dict, user_seed?, image_prompt?) -> dict  # claude, deepseek, groq, cerebras

inspire/ has its own helpers:
    inspire_from_image_bytes(...)
    inspire_from_url(...)

Returns either {'prompt'/'file_path', 'model_version'} or {'error'}.
"""
from . import (
    cerebras,
    claude,
    deepseek,
    gemini,
    grok,
    groq,
    inspire,
    pollinations,
    huggingface,
    openai_images,
)


def tool_status() -> dict:
    return {
        "pollinations":  {"available": pollinations.is_available(),  "kind": "image", "free": True},
        "hf-flux":       {"available": huggingface.is_available(),   "kind": "image", "free": "limited"},
        "hf-ltx-video":  {"available": huggingface.is_available(),   "kind": "video", "free": "limited"},
        "openai-gpt-image-2":   {"available": openai_images.is_available(), "kind": "image"},
        "openai-gpt-image-1.5": {"available": openai_images.is_available(), "kind": "image"},
        "openai-gpt-image-mini": {"available": openai_images.is_available(), "kind": "image"},
        "claude":        {"available": claude.is_available(),        "kind": "prompt"},
        "deepseek":      {"available": deepseek.is_available(),      "kind": "prompt"},
        "groq":          {"available": groq.is_available(),          "kind": "prompt"},
        "cerebras":      {"available": cerebras.is_available(),      "kind": "prompt"},
        "gemini-text":   {"available": gemini.is_text_available(),   "kind": "prompt"},
        "nano-banana":   {"available": gemini.is_available(),        "kind": "image"},
        "grok":          {"available": grok.is_available(),          "kind": "image"},
        "inspire":       {"available": inspire.is_available(),       "kind": "vision"},
    }


_ASPECT_DIMS = {
    "square":    (1024, 1024),
    "portrait":  (768, 1344),   # ~9:16, FLUX-friendly
    "landscape": (1344, 768),   # ~16:9
}


def _dims(aspect: str) -> tuple[int, int]:
    return _ASPECT_DIMS.get(aspect, _ASPECT_DIMS["square"])


def generate_image(tool: str, prompt: str, song_id: int, aspect: str = "square") -> dict:
    w, h = _dims(aspect)
    if tool == "pollinations":
        return pollinations.generate_image(prompt, song_id, width=w, height=h)
    if tool == "pollinations-realism":
        return pollinations.generate_image(prompt, song_id, model="flux-realism", width=w, height=h)
    if tool == "pollinations-anime":
        return pollinations.generate_image(prompt, song_id, model="flux-anime", width=w, height=h)
    if tool == "pollinations-turbo":
        return pollinations.generate_image(prompt, song_id, model="turbo", width=w, height=h)
    if tool == "hf-flux":
        return huggingface.generate_image(prompt, song_id, model="black-forest-labs/FLUX.1-schnell", width=w, height=h)
    if tool == "hf-flux-dev":
        return huggingface.generate_image(prompt, song_id, model="black-forest-labs/FLUX.1-dev", width=w, height=h)
    if tool == "openai-gpt-image-2":
        return openai_images.generate_image(prompt, song_id, model="gpt-image-2", width=w, height=h)
    if tool == "openai-gpt-image-1.5":
        return openai_images.generate_image(prompt, song_id, model="gpt-image-1.5", width=w, height=h)
    if tool == "openai-gpt-image-mini":
        return openai_images.generate_image(prompt, song_id, model="gpt-image-1-mini", width=w, height=h, quality="low")
    if tool == "nano-banana":
        return gemini.generate_image(prompt, song_id)
    if tool == "grok":
        return grok.generate_image(prompt, song_id)
    return {"error": f"unknown image tool: {tool}"}


def animate_image(tool: str, image_bytes: bytes, prompt: str, song_id: int) -> dict:
    if tool == "hf-ltx-video":
        return huggingface.animate_image(image_bytes, prompt, song_id, model="Lightricks/LTX-Video")
    if tool == "hf-cogvideo":
        return huggingface.animate_image(image_bytes, prompt, song_id, model="THUDM/CogVideoX-5b")
    if tool == "hf-mochi":
        return huggingface.animate_image(image_bytes, prompt, song_id, model="genmo/mochi-1-preview")
    if tool == "hf-wan":
        return huggingface.animate_image(image_bytes, prompt, song_id, model="Wan-AI/Wan2.2-I2V-A14B")
    return {"error": f"unknown video tool: {tool}"}


def auto_text_model() -> str | None:
    """Pick cheapest available prompt-enhance model. None = nothing configured."""
    if gemini.is_text_available():
        return "gemini-text"  # 250/day free, very cheap paid
    if groq.is_available():
        return "groq"         # fast free-tier friendly prompt drafting
    if cerebras.is_available():
        return "cerebras"     # very fast hosted open-weight inference
    if deepseek.is_available():
        return "deepseek"     # cheap paid, no free
    if claude.is_available():
        return "claude"       # premium paid
    return None


def auto_image_tool() -> str | None:
    """Pick cheapest available image gen tool. Pollinations is always free."""
    if pollinations.is_available():
        return "pollinations-realism"  # unlimited free
    if huggingface.is_available():
        return "hf-flux"               # ~30/mo free
    if gemini.is_available():
        return "nano-banana"           # paid
    if grok.is_available():
        return "grok"                  # paid
    return None


def auto_video_tool() -> str | None:
    """Pick best free automated I2V tool. None = no automated free path."""
    if huggingface.is_available():
        return "hf-ltx-video"
    return None


def enhance_prompt(model: str, song: dict, user_seed: str | None = None, image_prompt: str | None = None) -> dict:
    if model == "deepseek":
        return deepseek.enhance_prompt(song, user_seed=user_seed, image_prompt=image_prompt)
    if model in ("gemini", "gemini-text"):
        return gemini.enhance_prompt(song, user_seed=user_seed, image_prompt=image_prompt)
    if model == "groq":
        return groq.enhance_prompt(song, user_seed=user_seed, image_prompt=image_prompt)
    if model == "cerebras":
        return cerebras.enhance_prompt(song, user_seed=user_seed, image_prompt=image_prompt)
    if model in ("claude", "anthropic"):
        return claude.enhance_prompt(song, user_seed=user_seed, image_prompt=image_prompt)
    return {"error": f"unknown prompt model: {model}"}

