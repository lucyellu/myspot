import json
from datetime import datetime, date
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import EXPORTS_DIR

RADIO_SHOWS_DIR = EXPORTS_DIR / "radio_shows"
DEFAULT_PLACE = "Vancouver"
DEFAULT_TZ = "America/Vancouver"


def estimate_speech_duration(text: str = "") -> int:
    words = len([w for w in (text or "").strip().split() if w])
    return max(6, round(words / 2.45))


def local_show_date(value: str | None = None, tz_name: str = DEFAULT_TZ) -> date:
    if value:
      return date.fromisoformat(value)
    return datetime.now(ZoneInfo(tz_name)).date()


def compact_song(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "account": row["account"],
        "genre": row["genre"],
        "duration": row["duration"],
        "jpg_path": row["jpg_path"],
        "audio_path": row["mp3_path"],
    }


def list_radio_shows(limit: int = 30) -> list[dict]:
    RADIO_SHOWS_DIR.mkdir(parents=True, exist_ok=True)
    out = []
    for path in sorted(RADIO_SHOWS_DIR.glob("*.json"), reverse=True)[:limit]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        out.append({
            "id": data.get("id") or path.stem,
            "title": data.get("title") or path.stem,
            "showDate": data.get("prefs", {}).get("showDate"),
            "savedAt": data.get("savedAt"),
            "total": data.get("total"),
            "path": str(path).replace("\\", "/"),
        })
    return out


def load_radio_show(show_id: str) -> dict | None:
    safe_id = "".join(ch for ch in show_id if ch.isalnum() or ch in "-_")
    path = RADIO_SHOWS_DIR / f"{safe_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_weekday_morning_show(show_date: str | None = None) -> dict | None:
    d = local_show_date(show_date)
    return load_radio_show(_weekday_show_id(d))


def build_weekday_morning_show(
    conn,
    *,
    show_date: str | None = None,
    place: str = DEFAULT_PLACE,
    target_hours: float = 1.0,
    air_time: str = "06:00",
    force: bool = False,
) -> dict:
    d = local_show_date(show_date)
    show_id = _weekday_show_id(d)
    existing = load_radio_show(show_id)
    if existing and not force:
        existing["alreadyExists"] = True
        return existing

    if d.weekday() >= 5:
        return {"ok": True, "skipped": True, "reason": "weekday morning shows only run Monday-Friday", "date": d.isoformat()}

    songs = _choose_songs(conn, d, target_seconds=int(target_hours * 3600))
    segments = _build_segments(songs, d, place, air_time)
    total = sum(segment.get("duration") or 0 for segment in segments)
    now = datetime.now(ZoneInfo(DEFAULT_TZ)).isoformat()
    show = {
        "id": show_id,
        "title": f"{d.isoformat()} · 6 AM weekday morning",
        "savedAt": now,
        "source": "myspot weekday builder",
        "context": {
            "date": d.strftime("%A, %B %d, %Y"),
            "time": air_time,
            "daypart": "morning",
            "place": place,
            "source": "Local library",
            "weather": None,
        },
        "prefs": {
            "place": place,
            "host": "pop-theory-cool-kid",
            "mood": "auto",
            "brands": "Teenage Engineering, Muji, Bandcamp, Criterion, local coffee, weird synth shops",
            "buildZone": "America/New_York",
            "airZone": "America/Los_Angeles",
            "leadMinutes": 45,
            "showDate": d.isoformat(),
            "airTime": air_time,
            "targetHours": target_hours,
            "showFormat": "morning",
            "dailyAgenda": "",
            "bookmarkNotes": "",
        },
        "total": total,
        "currentSegmentIndex": 0,
        "liveSongId": songs[0]["id"] if songs else None,
        "segments": segments,
    }
    RADIO_SHOWS_DIR.mkdir(parents=True, exist_ok=True)
    (RADIO_SHOWS_DIR / f"{show_id}.json").write_text(json.dumps(show, indent=2), encoding="utf-8")
    return show


def _weekday_show_id(d: date) -> str:
    return f"weekday-morning-{d.isoformat()}"


def _choose_songs(conn, d: date, target_seconds: int) -> list[dict]:
    rows = conn.execute(
        """SELECT id, title, account, genre, duration, jpg_path, mp3_path
           FROM songs
           WHERE mp3_path IS NOT NULL
           ORDER BY id DESC
           LIMIT 500"""
    ).fetchall()
    if not rows:
        return []
    offset = sum(ord(ch) for ch in d.isoformat()) % len(rows)
    rotated = rows[offset:] + rows[:offset]
    picks = []
    total = 0
    for row in rotated:
        song = compact_song(row)
        picks.append(song)
        total += song.get("duration") or 180
        if total >= target_seconds:
            break
    return picks


def _build_segments(songs: list[dict], d: date, place: str, air_time: str) -> list[dict]:
    day_name = d.strftime("%A")
    segments = [
        _talk("Cold Open", f"Good morning, this is myspot at {air_time}. It is {day_name} in {place}, and this is the one-hour weekday morning show: quick daily shape, sharp songs, no doom-scroll required."),
        _talk("Morning Briefing", f"Daily desk: {day_name} gets a focused one-hour tape today. The host will keep it light, mention useful calendar notes when connected, and pick songs that feel like the day is opening up."),
    ]
    for idx, song in enumerate(songs):
        segments.append({"type": "song", "title": song.get("title") or "Untitled", "song": song, "duration": song.get("duration") or 180})
        if idx == 0:
            segments.append(_talk("Back Announce", f"That was {song.get('title')}. The morning detail is the way it gets moving without trying too hard. Coming up: a little more signal, a little less sleep inertia."))
        elif idx == 2:
            segments.append(_talk("Dream Sponsor", "Today's imaginary sponsor is the perfect local coffee counter: fast enough for a weekday, nerdy enough to know the playlist, and generous with napkins. Not an actual ad, just the dream."))
        elif idx < len(songs) - 1 and idx % 3 == 0:
            segments.append(_talk("Station ID", "You're listening to myspot morning: prerecorded enough to rewind, live enough to feel like today."))
    segments.append(_talk("Signoff", "That is the one-hour morning show. Scrub back, skip forward, or hit OFF any time. Tomorrow morning, we build another one."))
    return segments


def _talk(title: str, text: str) -> dict:
    return {"type": "talk", "title": title, "text": text, "duration": estimate_speech_duration(text)}
