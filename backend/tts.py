import asyncio
import concurrent.futures
import json
from pathlib import Path
import subprocess
import tempfile
from urllib import error, request

from .config import read_secret

try:
    import edge_tts
    _HAVE_EDGE_TTS = True
except ImportError:
    edge_tts = None
    _HAVE_EDGE_TTS = False

DEFAULT_EDGE_VOICE = "en-US-ChristopherNeural"

RADIO_HOST_VOICES = {
    "pop-theory-cool-kid": "en-US-EricNeural",
    "crate-digger": "en-GB-RyanNeural",
    "cosmic-fm": "en-US-ChristopherNeural",
    "comedy-story-editor": "en-US-GuyNeural",
    "luxury-bumper": "en-US-AriaNeural",
    "morning-host": "en-US-ChristopherNeural",
    "co-host": "en-US-JennyNeural",
}

GROQ_SPEECH_ENDPOINT = "https://api.groq.com/openai/v1/audio/speech"
GROQ_TTS_MODEL = "playai-tts"
DEFAULT_GROQ_VOICE = "Fritz-PlayAI"


def edge_tts_available() -> bool:
    return _HAVE_EDGE_TTS


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


def synthesize_edge_audio(
    text: str,
    out_path: Path,
    *,
    voice: str = DEFAULT_EDGE_VOICE,
    rate: str = "+0%",
    pitch: str = "+0Hz",
) -> dict:
    if not _HAVE_EDGE_TTS:
        return {"ok": False, "error": "edge-tts is not installed"}

    clean_text = (text or "").strip()
    if not clean_text:
        return {"ok": False, "error": "Empty text"}

    out_path.parent.mkdir(parents=True, exist_ok=True)

    async def _render():
        communicate = edge_tts.Communicate(clean_text, voice, rate=rate, pitch=pitch)
        await communicate.save(str(out_path))

    try:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                pool.submit(asyncio.run, _render()).result(timeout=60)
        else:
            asyncio.run(_render())
    except Exception as exc:
        return {"ok": False, "error": f"edge-tts error: {type(exc).__name__}: {exc}"}

    if not out_path.exists() or out_path.stat().st_size == 0:
        return {"ok": False, "error": "edge-tts produced empty output"}

    return {
        "ok": True,
        "provider": "edge-tts",
        "voice": voice,
        "path": str(out_path).replace("\\", "/"),
        "bytes": out_path.stat().st_size,
    }


def synthesize_radio_voice(
    text: str,
    out_path: Path,
    *,
    host: str = "pop-theory-cool-kid",
    voice: str | None = None,
    prefer_groq: bool = False,
) -> dict:
    """Unified voice synthesis cascade for radio talk segments:
    1. Groq PlayAI (if prefer_groq and key present)
    2. Edge-TTS (Broadcast neural quality, $0, unlimited, no key)
    3. Groq PlayAI (if Edge-TTS fails and key present)
    4. Windows SAPI (offline system fallback)
    """
    if prefer_groq and groq_tts_available():
        res = synthesize_groq_wav(text, out_path, voice=voice or DEFAULT_GROQ_VOICE)
        if res.get("ok"):
            return res

    if edge_tts_available():
        target_voice = voice or RADIO_HOST_VOICES.get(host, DEFAULT_EDGE_VOICE)
        res = synthesize_edge_audio(text, out_path, voice=target_voice)
        if res.get("ok"):
            return res

    if groq_tts_available():
        res = synthesize_groq_wav(text, out_path, voice=voice or DEFAULT_GROQ_VOICE)
        if res.get("ok"):
            return res

    return synthesize_windows_wav(text, out_path)

