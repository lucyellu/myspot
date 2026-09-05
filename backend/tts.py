from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
from urllib import error, request

from .config import read_secret

GROQ_SPEECH_ENDPOINT = "https://api.groq.com/openai/v1/audio/speech"
GROQ_TTS_MODEL = "playai-tts"
DEFAULT_GROQ_VOICE = "Fritz-PlayAI"


def groq_tts_available() -> bool:
    return bool(read_secret("GROQ_API_KEY"))


def synthesize_groq_wav(
    text: str,
    out_path: Path,
    *,
    voice: str = DEFAULT_GROQ_VOICE,
    model: str = GROQ_TTS_MODEL,
) -> dict:
    api_key = read_secret("GROQ_API_KEY")
    if not api_key:
        return {"ok": False, "error": "GROQ_API_KEY is not configured"}

    payload = {
        "model": model,
        "input": text,
        "voice": voice,
        "response_format": "wav",
    }
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        GROQ_SPEECH_ENDPOINT,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with request.urlopen(req, timeout=90) as resp:
            audio = resp.read()
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": f"Groq TTS {exc.code}: {detail[:500]}"}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(audio)
    return {
        "ok": True,
        "provider": "groq",
        "model": model,
        "voice": voice,
        "path": str(out_path).replace("\\", "/"),
        "bytes": len(audio),
    }


def synthesize_windows_wav(text: str, out_path: Path, *, rate: int = 1) -> dict:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as tmp:
        tmp.write(text)
        text_path = Path(tmp.name)

    ps = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        f"$s.Rate = {rate}; "
        f"$s.SetOutputToWaveFile('{str(out_path)}'); "
        f"$s.Speak((Get-Content -Raw -LiteralPath '{str(text_path)}')); "
        "$s.Dispose();"
    )
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=120,
        )
    finally:
        text_path.unlink(missing_ok=True)

    if proc.returncode != 0:
        return {"ok": False, "error": (proc.stderr or proc.stdout or "Windows SAPI failed")[:500]}
    return {
        "ok": True,
        "provider": "windows-sapi",
        "voice": "system-default",
        "path": str(out_path).replace("\\", "/"),
        "bytes": out_path.stat().st_size if out_path.exists() else 0,
    }
