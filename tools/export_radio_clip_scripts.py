"""Export standalone radio-show talk clips for Suno/audio generators.

The radio show JSON is the source of truth. This script picks the strongest
standalone talk segments, then writes copy-pasteable prompt packs beside the
saved show artifacts.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.config import EXPORTS_DIR  # noqa: E402

RADIO_SHOWS_DIR = EXPORTS_DIR / "radio_shows"
INDEX_JSON = RADIO_SHOWS_DIR / "daily_best_generator_clips.json"
INDEX_TXT = RADIO_SHOWS_DIR / "daily_best_generator_clips.txt"

STYLE_PROMPT = (
    "spoken-word radio show, fictional two-host market desk, crisp podcast delivery, "
    "dry smart humor, morning-news energy, clean narration, no singing, no celebrity imitation"
)

AUDIO_GENERATOR_PROMPT = (
    "Read this as a polished standalone radio clip from a fictional market-news morning show. "
    "Use confident but conversational pacing, light dry humor, and clear paragraph breaks. "
    "No music bed is required unless the generator supports a subtle newsroom bumper."
)

SEGMENT_BOOSTS = {
    "opening": 8,
    "risk": 8,
    "opinionated": 8,
    "volatility": 8,
    "thesis": 8,
    "discipline": 8,
    "joke": 7,
    "dream sponsor": 7,
    "case study": 6,
    "ai": 6,
    "earnings": 6,
    "watch": 6,
    "final bell": 5,
}

SEGMENT_PENALTIES = {
    "signoff": -6,
    "no more song breaks": -4,
}


def slugify(value: str, fallback: str = "clip") -> str:
    text = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return text[:60] or fallback


def show_date(show: dict[str, Any], path: Path) -> str:
    date_value = (show.get("prefs") or {}).get("showDate")
    if date_value:
        return str(date_value)
    match = re.search(r"(\d{4}-\d{2}-\d{2})", show.get("id") or path.stem)
    return match.group(1) if match else "unknown-date"


def safe_show_id(show: dict[str, Any], path: Path | None = None) -> str:
    raw = show.get("id") or (path.stem if path else "show")
    return "".join(ch for ch in raw if ch.isalnum() or ch in "-_")


def voice_counts(show_id: str) -> dict[str, int]:
    voice_dir = RADIO_SHOWS_DIR / show_id / "voice"
    files = list(voice_dir.glob("*")) if voice_dir.exists() else []
    return {
        "files": len([p for p in files if p.is_file()]),
        "real": len([p for p in files if p.is_file() and p.stat().st_size > 44]),
        "empty": len([p for p in files if p.is_file() and p.stat().st_size == 0]),
    }


def read_show(path: Path) -> dict[str, Any] | None:
    try:
        show = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    show["_path"] = path
    return show


def list_saved_shows() -> list[dict[str, Any]]:
    RADIO_SHOWS_DIR.mkdir(parents=True, exist_ok=True)
    shows = []
    for path in RADIO_SHOWS_DIR.glob("*.json"):
        show = read_show(path)
        if show:
            shows.append(show)
    return shows


def saved_at_score(show: dict[str, Any]) -> float:
    raw = show.get("savedAt")
    if not raw:
        path = show.get("_path")
        return path.stat().st_mtime if isinstance(path, Path) else 0
    try:
        return datetime.fromisoformat(str(raw)).timestamp()
    except ValueError:
        return 0


def score_show(show: dict[str, Any]) -> float:
    show_id = safe_show_id(show, show.get("_path"))
    segments = show.get("segments") or []
    talk_count = sum(1 for segment in segments if segment.get("type") == "talk")
    song_count = sum(1 for segment in segments if segment.get("type") == "song")
    voices = voice_counts(show_id)
    source = f"{show.get('source') or ''} {show.get('title') or ''}".lower()
    score = talk_count * 3 - song_count
    score += voices["real"] * 7
    score -= voices["empty"] * 2
    if "finance" in source or "market" in source:
        score += 60
    if show.get("iterationOf"):
        score -= 8
    score += saved_at_score(show) / 10_000_000_000
    return score


def best_show_per_day(shows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for show in shows:
        path = show.get("_path")
        if not isinstance(path, Path):
            continue
        grouped.setdefault(show_date(show, path), []).append(show)
    best = []
    for _date, candidates in grouped.items():
        best.append(max(candidates, key=score_show))
    best.sort(key=lambda item: show_date(item, item["_path"]))
    return best


def words(text: str) -> int:
    return len([part for part in re.split(r"\s+", text.strip()) if part])


def score_segment(segment: dict[str, Any], index: int) -> float:
    title = (segment.get("title") or "").lower()
    text = segment.get("text") or ""
    duration = float(segment.get("duration") or max(6, words(text) / 2.45))
    score = 0.0
    for key, boost in SEGMENT_BOOSTS.items():
        if key in title:
            score += boost
    for key, penalty in SEGMENT_PENALTIES.items():
        if key in title:
            score += penalty
    word_count = words(text)
    if 70 <= word_count <= 230:
        score += 8
    elif 45 <= word_count < 70 or 230 < word_count <= 290:
        score += 4
    else:
        score -= 4
    if 35 <= duration <= 140:
        score += 6
    elif duration > 180:
        score -= 5
    if index <= 3:
        score += 2
    if any(term in text.lower() for term in ("not financial advice", "remember this", "the useful question", "the trick is")):
        score += 3
    return score


def selected_clips(show: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    ranked = []
    for index, segment in enumerate(show.get("segments") or [], 1):
        if segment.get("type") != "talk":
            continue
        text = (segment.get("text") or "").strip()
        if not text:
            continue
        ranked.append({
            "sourceIndex": index,
            "rankScore": round(score_segment(segment, index), 2),
            "title": segment.get("title") or f"Talk {index:02d}",
            "speaker": segment.get("speaker") or "Host",
            "voice": segment.get("voice") or "",
            "duration": segment.get("duration"),
            "audioFile": segment.get("audioFile"),
            "audio_url": segment.get("audio_url"),
            "text": text,
        })
    ranked.sort(key=lambda item: (-item["rankScore"], item["sourceIndex"]))
    return ranked[:limit]


def clip_prompt(show: dict[str, Any], clip: dict[str, Any], clip_number: int) -> str:
    title = f"{show.get('title') or show.get('id')} - Clip {clip_number:02d}: {clip['title']}"
    speaker = clip.get("speaker") or "Host"
    voice_hint = f" Voice hint: {clip['voice']}." if clip.get("voice") else ""
    duration = f" Target length: about {round(float(clip.get('duration') or 0))} seconds." if clip.get("duration") else ""
    return "\n".join([
        title,
        "",
        "SUNO STYLE PROMPT:",
        STYLE_PROMPT,
        "",
        "AUDIO GENERATOR PROMPT:",
        f"{AUDIO_GENERATOR_PROMPT}{voice_hint}{duration}",
        "",
        "SCRIPT / LYRICS FIELD:",
        "[Spoken radio clip]",
        f"[{speaker}, dry smart market-desk delivery]",
        clip["text"],
        "",
        "[End clip]",
        "",
    ])


def export_show_clip_pack(show: dict[str, Any], *, limit: int = 8) -> dict[str, Any]:
    show_id = safe_show_id(show, show.get("_path"))
    clips = selected_clips(show, limit)
    show_dir = RADIO_SHOWS_DIR / show_id
    out_dir = show_dir / "generator_clips"
    out_dir.mkdir(parents=True, exist_ok=True)

    individual = []
    for idx, clip in enumerate(clips, 1):
        name = f"clip_{idx:02d}_{slugify(clip['title'])}.suno.txt"
        path = out_dir / name
        path.write_text(clip_prompt(show, clip, idx), encoding="utf-8")
        individual.append(str(path).replace("\\", "/"))

    combined_path = out_dir / "best_clips_suno.txt"
    json_path = out_dir / "best_clips_audio_generator.json"
    combined = [
        f"{show.get('title') or show_id} - best generator clips",
        f"Show ID: {show_id}",
        f"Show date: {show_date(show, show.get('_path') or show_dir)}",
        "",
        "Use these as short standalone spoken-word radio clips. Paste one clip at a time into Suno or another audio generator.",
        "",
    ]
    for idx, clip in enumerate(clips, 1):
        combined.append("=" * 72)
        combined.append(clip_prompt(show, clip, idx).rstrip())
        combined.append("")
    combined_path.write_text("\n".join(combined).rstrip() + "\n", encoding="utf-8")

    payload = {
        "showId": show_id,
        "title": show.get("title"),
        "showDate": show_date(show, show.get("_path") or show_dir),
        "sourceShowJson": str((show.get("_path") or (RADIO_SHOWS_DIR / f"{show_id}.json"))).replace("\\", "/"),
        "stylePrompt": STYLE_PROMPT,
        "audioGeneratorPrompt": AUDIO_GENERATOR_PROMPT,
        "clips": clips,
        "files": {
            "combinedSuno": str(combined_path).replace("\\", "/"),
            "individual": individual,
        },
    }
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    payload["files"]["json"] = str(json_path).replace("\\", "/")
    return payload


def write_daily_index(exports: list[dict[str, Any]]) -> None:
    INDEX_JSON.write_text(json.dumps(exports, indent=2), encoding="utf-8")
    lines = [
        "Daily best radio generator clips",
        "",
    ]
    for item in exports:
        lines.append(f"- {item['showDate']} - {item['showId']}")
        lines.append(f"  combined: {item['files']['combinedSuno']}")
        lines.append(f"  json: {item['files']['json']}")
    INDEX_TXT.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--show-id", help="Export one saved show ID.")
    parser.add_argument("--all-days", action="store_true", help="Export the best saved show for each show date.")
    parser.add_argument("--limit", type=int, default=8, help="Number of clips per show.")
    args = parser.parse_args()

    if args.limit < 1:
        raise SystemExit("--limit must be at least 1")

    shows = list_saved_shows()
    if args.show_id:
        safe_id = "".join(ch for ch in args.show_id if ch.isalnum() or ch in "-_")
        path = RADIO_SHOWS_DIR / f"{safe_id}.json"
        show = read_show(path)
        if not show:
            raise SystemExit(f"Saved show not found: {args.show_id}")
        exports = [export_show_clip_pack(show, limit=args.limit)]
    else:
        targets = best_show_per_day(shows) if args.all_days else best_show_per_day(shows)[-1:]
        exports = [export_show_clip_pack(show, limit=args.limit) for show in targets]

    write_daily_index(exports)
    print(json.dumps({
        "exported": len(exports),
        "indexJson": str(INDEX_JSON).replace("\\", "/"),
        "indexTxt": str(INDEX_TXT).replace("\\", "/"),
        "shows": [
            {
                "showId": item["showId"],
                "showDate": item["showDate"],
                "clips": len(item["clips"]),
                "combinedSuno": item["files"]["combinedSuno"],
            }
            for item in exports
        ],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
