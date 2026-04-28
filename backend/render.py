"""ffmpeg-driven slideshow exporter (M5a).

Takes all attached image gens for a song, distributes them evenly across the
song's duration, normalizes each to 1280x720 with letterboxing, and concats
them into an MP4 with the song's original audio. The output lives next to the
other gens in `data/gens/` so it surfaces in the media tray. A copy is also
written to `data/exports/` for backward-compat with /media/export/.

Video gens are appended verbatim with a uniform scale/pad pass (best-effort —
short looping clips work; long ones get truncated by -shortest).
"""
import shutil
import subprocess
import time
from pathlib import Path

from .config import EXPORTS_DIR, GENS_DIR


W, H = 1280, 720


def have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def _norm_filter(idx: int, kind: str) -> str:
    src = f"[{idx}:v]"
    chain = f"scale={W}:{H}:force_original_aspect_ratio=decrease," \
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p"
    return f"{src}{chain}[v{idx}]"


def render_slideshow(song_id: int, audio_path: str, duration: float, gens: list[dict]) -> dict:
    """gens: list of {'id', 'kind', 'file_path'} — pre-filtered to completed.

    Returns {'file_path': str} or {'error': str}.
    """
    if not have_ffmpeg():
        return {"error": "ffmpeg not on PATH."}
    if not gens:
        return {"error": "No completed generations to render."}
    if not duration or duration <= 0:
        return {"error": "Song duration unknown."}

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    GENS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = GENS_DIR / f"song{song_id}_{int(time.time()*1000)}_export.mp4"

    image_gens = [g for g in gens if g.get("kind") == "image" and g.get("file_path")]
    video_gens = [g for g in gens if g.get("kind") == "video" and g.get("file_path")]
    visuals = image_gens + video_gens
    if not visuals:
        return {"error": "No image or video gens with file_path."}

    n = len(visuals)
    per = duration / n

    inputs: list[str] = []
    filter_parts: list[str] = []
    for i, g in enumerate(visuals):
        if g["kind"] == "image":
            inputs.extend(["-loop", "1", "-t", f"{per:.3f}", "-i", g["file_path"]])
        else:
            inputs.extend(["-stream_loop", "-1", "-t", f"{per:.3f}", "-i", g["file_path"]])
        filter_parts.append(_norm_filter(i, g["kind"]))
    inputs.extend(["-i", audio_path])

    audio_idx = n
    concat_in = "".join(f"[v{i}]" for i in range(n))
    filtergraph = ";".join(filter_parts) + f";{concat_in}concat=n={n}:v=1:a=0[v]"

    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        *inputs,
        "-filter_complex", filtergraph,
        "-map", "[v]",
        "-map", f"{audio_idx}:a",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        str(out_path),
    ]
    try:
        proc = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired:
        return {"error": "ffmpeg timed out (>15min)."}

    if proc.returncode != 0:
        return {"error": f"ffmpeg exit {proc.returncode}: {proc.stderr[:1500]}"}

    # Also drop a copy at the legacy exports path so /media/export/{id} keeps
    # serving the most recent render for this song.
    legacy = EXPORTS_DIR / f"song_{song_id}.mp4"
    try:
        shutil.copyfile(out_path, legacy)
    except OSError:
        pass

    return {
        "file_path": str(out_path).replace("\\", "/"),
        "size_bytes": out_path.stat().st_size if out_path.exists() else None,
        "visuals_used": n,
        "seconds_per_visual": round(per, 2),
    }
