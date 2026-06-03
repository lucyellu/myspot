"""Groq prompt enhancer via the OpenAI-compatible Chat Completions API."""
from ..config import read_secret
from .openai_compatible import enhance_prompt_via_chat

_MODEL = "llama-3.3-70b-versatile"
_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"


def is_available() -> bool:
    return bool(read_secret("GROQ_API_KEY"))


def enhance_prompt(song: dict, user_seed: str | None = None, image_prompt: str | None = None) -> dict:
    return enhance_prompt_via_chat(
        provider_name="Groq",
        api_key_name="GROQ_API_KEY",
        endpoint=_ENDPOINT,
        model=_MODEL,
        song=song,
        user_seed=user_seed,
        image_prompt=image_prompt,
    )
