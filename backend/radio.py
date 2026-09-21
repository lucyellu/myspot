import json
import logging
from datetime import datetime, date, timedelta, time
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import EXPORTS_DIR
from .tts import synthesize_radio_voice

log = logging.getLogger(__name__)

RADIO_SHOWS_DIR = EXPORTS_DIR / "radio_shows"
DEFAULT_PLACE = "Vancouver, Canada"
DEFAULT_TZ = "America/Vancouver"


DAYPARTS = {
    "morning": {
        "id": "morning",
        "label": "Morning Drive",
        "start_hour": 6,
        "end_hour": 10,
        "duration_hours": 4,
        "host": "pop-theory-cool-kid",
        "mood": "upbeat",
        "format": "morning",
        "intro_tag": "Morning Drive: sharp songs, daily briefing, light tempo to wake up the room.",
        "keywords": ["pop", "rock", "indie", "bright", "anthem", "dance", "energy"],
    },
    "midday": {
        "id": "midday",
        "label": "Midday Focus",
        "start_hour": 10,
        "end_hour": 14,
        "duration_hours": 4,
        "host": "crate-digger",
        "mood": "focus",
        "format": "freeform",
        "intro_tag": "Midday Focus: deep work sweeps, instrumentals, lo-fi textures, minimal interruptions.",
        "keywords": ["lo-fi", "lofi", "instrumental", "ambient", "beats", "electronic", "chill"],
    },
    "afternoon": {
        "id": "afternoon",
        "label": "Afternoon Rush",
        "start_hour": 14,
        "end_hour": 18,
        "duration_hours": 4,
        "host": "comedy-story-editor",
        "mood": "party",
        "format": "freeform",
        "intro_tag": "Afternoon Rush: full volume, high tempo, dream sponsors, and favorite bangers.",
        "keywords": ["pop", "electronic", "synth", "rap", "hip hop", "trap", "loud"],
    },
    "evening": {
        "id": "evening",
        "label": "Golden Hour Lounge",
        "start_hour": 18,
        "end_hour": 22,
        "duration_hours": 4,
        "host": "crate-digger",
        "mood": "tender",
        "format": "freeform",
        "intro_tag": "Golden Hour Lounge: warm acoustic chords, soul, R&B, and production lore.",
        "keywords": ["soul", "acoustic", "r&b", "folk", "jazz", "ballad", "warm"],
    },
    "late-night": {
        "id": "late-night",
        "label": "Cosmic FM",
        "start_hour": 22,
        "end_hour": 2,
        "duration_hours": 4,
        "host": "cosmic-fm",
        "mood": "late-night",
        "format": "late",
        "intro_tag": "Late Night Cosmic FM: synthwave, ambient corridors, reflective night-owl frequencies.",
        "keywords": ["synthwave", "vaporwave", "psychedelic", "dream", "ambient", "dark"],
    },
    "overnight": {
        "id": "overnight",
        "label": "Overnight Tape",
        "start_hour": 2,
        "end_hour": 6,
        "duration_hours": 4,
        "host": "luxury-bumper",
        "mood": "weird",
        "format": "freeform",
        "intro_tag": "Overnight Deep Tape: lo-fi dreamscapes, quiet station IDs, continuous flow until dawn.",
        "keywords": ["ambient", "drone", "lofi", "sleep", "quiet", "minimal"],
    },
}

DAYPART_ORDER = ["morning", "midday", "afternoon", "evening", "late-night", "overnight"]
 
_WEATHER_CACHE: dict = {}
 
_WMO_WEATHER = {
    0: "clear skies",
    1: "mainly clear skies",
    2: "partly cloudy skies",
    3: "overcast skies",
    45: "foggy conditions",
    48: "rime fog",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    80: "light rain showers",
    81: "rain showers",
    82: "heavy rain showers",
    95: "thunderstorms",
}
 
 
def get_vancouver_weather(place: str = DEFAULT_PLACE) -> dict:
    """Fetch live weather for Vancouver, Canada in Celsius using Open-Meteo with a 15-minute cache.
    Zero-key public endpoint."""
    now_ts = datetime.now().timestamp()
    cached = _WEATHER_CACHE.get(place)
    if cached and (now_ts - cached["ts"] < 900):
        return cached["data"]
 
    data = {
        "place": place,
        "summary": "partly cloudy skies",
        "temperature_c": 14,
        "phrase": "14 degrees Celsius with partly cloudy skies",
    }
    try:
        import httpx
        with httpx.Client(timeout=4.0) as client:
            resp = client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": 49.2827,
                    "longitude": -123.1207,
                    "current": "temperature_2m,precipitation,weather_code",
                    "temperature_unit": "celsius",
                    "timezone": "America/Vancouver",
                },
            )
            if resp.status_code == 200:
                cur = resp.json().get("current", {})
                code = int(cur.get("weather_code") or 0)
                temp = round(float(cur.get("temperature_2m") or 14))
                summary = _WMO_WEATHER.get(code, "fair skies")
                data = {
                    "place": place,
                    "summary": summary,
                    "temperature_c": temp,
                    "phrase": f"{temp} degrees Celsius and {summary}",
                }
                _WEATHER_CACHE[place] = {"ts": now_ts, "data": data}
    except Exception as exc:
        log.warning(f"Weather lookup fallback for {place}: {exc}")
 
    return data
 
 
def format_spoken_date(d: date) -> str:
    """Format date for natural speech: e.g. 'Sunday, September 20th'."""
    day = d.day
    if 11 <= (day % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return d.strftime(f"%A, %B {day}{suffix}")
 
 
def format_12h_time(dt_or_time: datetime | time | str) -> str:
    """Format time strictly into 12-hour AM/PM format, NEVER 24-hour time.
    Leading zeroes are stripped for natural pronunciation (e.g. '6:00 AM', '2:15 PM', '9:36 PM')."""
    if isinstance(dt_or_time, str):
        parts = dt_or_time.strip().split(":")
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        dt_or_time = time(h, m)
 
    if isinstance(dt_or_time, datetime):
        t = dt_or_time.time()
    else:
        t = dt_or_time
 
    hour_12 = t.hour % 12
    if hour_12 == 0:
        hour_12 = 12
    period = "AM" if t.hour < 12 else "PM"
    return f"{hour_12}:{t.minute:02d} {period}"
 
 


def estimate_speech_duration(text: str = "") -> int:
    words = len([w for w in (text or "").strip().split() if w])
    return max(6, round(words / 2.45))


def local_show_date(value: str | None = None, tz_name: str = DEFAULT_TZ) -> date:
    if value:
        return date.fromisoformat(value)
    return datetime.now(ZoneInfo(tz_name)).date()


def get_active_daypart_name(dt: datetime | None = None) -> str:
    if dt is None:
        dt = datetime.now(ZoneInfo(DEFAULT_TZ))
    hour = dt.hour
    if 6 <= hour < 10:
        return "morning"
    if 10 <= hour < 14:
        return "midday"
    if 14 <= hour < 18:
        return "afternoon"
    if 18 <= hour < 22:
        return "evening"
    if 22 <= hour or hour < 2:
        return "late-night"
    return "overnight"


def daypart_show_date(dt: datetime, daypart: str) -> date:
    if daypart == "late-night" and dt.hour < 12:
        return (dt - timedelta(days=1)).date()
    return dt.date()


def daypart_show_id(d: date, daypart: str) -> str:
    return f"{daypart}-{d.isoformat()}"


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


def list_radio_shows(limit: int = 50) -> list[dict]:
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
            "daypart": data.get("daypart"),
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
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_weekday_morning_show(show_date: str | None = None) -> dict | None:
    d = local_show_date(show_date)
    existing = load_radio_show(f"weekday-morning-{d.isoformat()}")
    if existing:
        return existing
    return load_radio_show(daypart_show_id(d, "morning"))


def _choose_songs(conn, d: date, target_seconds: int = 3600) -> list[dict]:
    return _choose_songs_for_daypart(conn, d, "morning", target_seconds=target_seconds)


def _choose_songs_for_daypart(conn, d: date, daypart: str, target_seconds: int = 14400) -> list[dict]:
    dp = DAYPARTS.get(daypart, DAYPARTS["morning"])
    keywords = [k.lower() for k in dp.get("keywords", [])]

    all_rows = conn.execute(
        """SELECT id, title, account, genre, bpm, duration, jpg_path, mp3_path,
                  COALESCE(suno_play_count, 0) AS plays, COALESCE(liked, 0) AS is_liked,
                  suno_style, prompt
           FROM songs
           WHERE mp3_path IS NOT NULL
           ORDER BY is_liked DESC, plays DESC, id DESC
           LIMIT 1200"""
    ).fetchall()
    if not all_rows:
        return []

    matched = []
    rest = []
    for row in all_rows:
        desc = f"{row['suno_style'] or ''} {row['prompt'] or ''} {row['genre'] or ''}".lower()
        if any(kw in desc for kw in keywords):
            matched.append(row)
        else:
            rest.append(row)

    pool = (matched + rest) if len(matched) >= 12 else all_rows
    seed_str = f"{d.isoformat()}-{daypart}"
    offset = sum(ord(ch) for ch in seed_str) % len(pool)
    rotated = pool[offset:] + pool[:offset]

    picks = []
    total = 0
    for row in rotated:
        song = compact_song(row)
        picks.append(song)
        total += song.get("duration") or 180
        if total >= target_seconds:
            break
    return picks


def _talk(title: str, text: str, host: str = "pop-theory-cool-kid") -> dict:
    return {
        "type": "talk",
        "title": title,
        "text": text,
        "host": host,
        "duration": estimate_speech_duration(text),
    }


def _build_daypart_segments(
    songs: list[dict],
    d: date,
    daypart: str,
    place: str = DEFAULT_PLACE,
    air_time: str = "06:00",
) -> list[dict]:
    dp = DAYPARTS.get(daypart, DAYPARTS["morning"])
    host = dp["host"]
    label = dp["label"]
    date_spoken = format_spoken_date(d)

    # Fetch live Vancouver weather (Celsius)
    wx = get_vancouver_weather(place)
    temp_c = wx.get("temperature_c", 14)
    wx_summary = wx.get("summary", "fair skies")

    # Daypart start time strictly formatted as 12-hour AM/PM (never 24-hour time)
    start_hour = dp.get("start_hour", 6)
    tz = ZoneInfo(DEFAULT_TZ)
    block_start_dt = datetime.combine(d, time(start_hour, 0), tzinfo=tz)
    start_clock = format_12h_time(air_time) if air_time else format_12h_time(block_start_dt)

    first_talk = _talk(
        "Station Sign-On",
        f"You're tuned to myspot FM in {place}. It is {start_clock} on {date_spoken}, opening up the {label} broadcast. The weather desk reports {temp_c} degrees Celsius with {wx_summary}. {dp['intro_tag']}",
        host=host,
    )
    segments = [first_talk]
    elapsed_seconds = first_talk["duration"]

    for idx, song in enumerate(songs):
        song_dur = song.get("duration") or 180
        segments.append({
            "type": "song",
            "title": song.get("title") or "Untitled",
            "song": song,
            "duration": song_dur,
        })
        elapsed_seconds += song_dur

        current_time = block_start_dt + timedelta(seconds=elapsed_seconds)
        current_clock = format_12h_time(current_time)

        if idx == 0:
            talk = _talk(
                "First Up",
                f"That was {song.get('title')}. Setting the tone for this {label} session on myspot in {place}. Up next, we keep the signal moving.",
                host=host,
            )
            segments.append(talk)
            elapsed_seconds += talk["duration"]
        elif idx == 3:
            talk = _talk(
                "Weather & Time Desk",
                f"Checking the {place} weather desk at {current_clock} on {date_spoken}: outside it is currently {temp_c} degrees Celsius with {wx_summary}. That was {song.get('title')}. More commercial-free music from the vault coming right up.",
                host=host,
            )
            segments.append(talk)
            elapsed_seconds += talk["duration"]
        elif idx == 7:
            talk = _talk(
                "Dream Sponsor",
                f"Today's imaginary sponsor for the {label} in {place} is a local pour-over coffee counter and vintage synth shop: quiet morning light, fresh beans, and always tuned to the right frequency.",
                host=host,
            )
            segments.append(talk)
            elapsed_seconds += talk["duration"]
        elif idx == 12:
            talk = _talk(
                "Broadcast Checkpoint",
                f"Still inside myspot {label} on this {date_spoken}. The time is {current_clock} in {place}, sitting at {temp_c} degrees Celsius under {wx_summary}. Let's get right back into the songs.",
                host=host,
            )
            segments.append(talk)
            elapsed_seconds += talk["duration"]
        elif idx > 0 and idx < len(songs) - 1 and idx % 6 == 0:
            if (idx // 6) % 2 == 1:
                talk = _talk(
                    "Weather & Time Update",
                    f"It is {current_clock} in {place}, {temp_c} degrees Celsius with {wx_summary}. You're listening to myspot 24/7 AI Radio, commercial-free.",
                    host=host,
                )
            else:
                talk = _talk(
                    "Station ID & Clock",
                    f"This is myspot 24/7 radio on {date_spoken}. The clock shows {current_clock} here in {place}. Handcrafted curation, zero filler.",
                    host=host,
                )
            segments.append(talk)
            elapsed_seconds += talk["duration"]

    end_time = block_start_dt + timedelta(seconds=elapsed_seconds)
    end_clock = format_12h_time(end_time)
    segments.append(_talk(
        "Daypart Signoff",
        f"That wraps this stretch of {label} for {date_spoken} in {place}. The time is {end_clock}, with the weather desk holding at {temp_c} degrees Celsius. Stay tuned as myspot automatically rolls into the next broadcast block.",
        host=host,
    ))
    return segments


def render_show_voices(show: dict, *, force: bool = False, limit: int | None = None) -> list[dict]:
    show_id = show["id"]
    voice_dir = RADIO_SHOWS_DIR / show_id / "voice"
    voice_dir.mkdir(parents=True, exist_ok=True)
    results = []
    rendered = 0
    host = show.get("prefs", {}).get("host") or "pop-theory-cool-kid"

    for idx, segment in enumerate(show.get("segments", []), 1):
        if segment.get("type") != "talk":
            continue
        if limit is not None and rendered >= limit:
            break

        filename = f"talk_{idx:02d}.mp3"
        out_path = voice_dir / filename
        if out_path.exists() and not force and out_path.stat().st_size > 0:
            res = {"ok": True, "provider": "cached", "path": str(out_path).replace("\\", "/")}
        else:
            seg_host = segment.get("host") or host
            res = synthesize_radio_voice(segment.get("text") or "", out_path, host=seg_host)

        results.append({"segment": idx, "title": segment.get("title"), **res})
        if res.get("ok"):
            segment["audio_path"] = res.get("path")
            segment["audioFile"] = filename
            segment["audio_url"] = f"/media/radio_voice/{show_id}/{filename}"
            segment["ttsProvider"] = res.get("provider")
        rendered += 1

    return results


def build_daypart_show(
    conn,
    *,
    show_date: str | None = None,
    daypart: str = "morning",
    place: str = DEFAULT_PLACE,
    target_hours: float | None = None,
    air_time: str | None = None,
    force: bool = False,
    render_voice: bool = True,
) -> dict:
    d = local_show_date(show_date)
    dp = DAYPARTS.get(daypart, DAYPARTS["morning"])
    if target_hours is None:
        target_hours = float(dp.get("duration_hours", 4.0))

    show_id = daypart_show_id(d, daypart)
    existing = load_radio_show(show_id)
    if existing and not force:
        existing["alreadyExists"] = True
        return existing

    start_h = dp.get("start_hour", 6)
    if not air_time:
        air_time = f"{start_h:02d}:00"
    target_seconds = int(target_hours * 3600)

    songs = _choose_songs_for_daypart(conn, d, daypart, target_seconds=target_seconds)
    segments = _build_daypart_segments(songs, d, daypart, place=place, air_time=air_time)

    now_iso = datetime.now(ZoneInfo(DEFAULT_TZ)).isoformat()
    show = {
        "id": show_id,
        "title": f"{d.isoformat()} · {dp['label']}",
        "daypart": daypart,
        "savedAt": now_iso,
        "source": "myspot 24/7 daypart engine",
        "context": {
            "date": d.strftime("%A, %B %d, %Y"),
            "time": air_time,
            "daypart": daypart,
            "place": place,
            "source": "Local library",
            "weather": None,
        },
        "prefs": {
            "place": place,
            "host": dp["host"],
            "mood": dp["mood"],
            "brands": "Teenage Engineering, Muji, Bandcamp, Criterion, local coffee, weird synth shops",
            "buildZone": "America/New_York",
            "airZone": "America/Los_Angeles",
            "leadMinutes": 0,
            "showDate": d.isoformat(),
            "airTime": air_time,
            "targetHours": target_hours,
            "showFormat": dp["format"],
            "dailyAgenda": "",
            "bookmarkNotes": "",
        },
        "currentSegmentIndex": 0,
        "liveSongId": songs[0]["id"] if songs else None,
        "segments": segments,
    }

    if render_voice:
        try:
            render_show_voices(show, force=force)
        except Exception as exc:
            log.warning(f"Voice render warning for {show_id}: {exc}")

    show["total"] = sum(segment.get("duration") or 0 for segment in show["segments"])

    RADIO_SHOWS_DIR.mkdir(parents=True, exist_ok=True)
    (RADIO_SHOWS_DIR / f"{show_id}.json").write_text(json.dumps(show, indent=2), encoding="utf-8")
    return show


def get_or_build_daypart_show(
    conn,
    show_date: date,
    daypart: str,
    place: str = DEFAULT_PLACE,
    render_voice: bool = True,
) -> dict:
    show_id = daypart_show_id(show_date, daypart)
    show = load_radio_show(show_id)
    if show:
        return show
    return build_daypart_show(conn, show_date=show_date.isoformat(), daypart=daypart, place=place, render_voice=render_voice)


def get_live_station_state(conn, dt: datetime | None = None, place: str = DEFAULT_PLACE) -> dict:
    tz = ZoneInfo(DEFAULT_TZ)
    if dt is None:
        dt = datetime.now(tz)
    elif dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)

    daypart_name = get_active_daypart_name(dt)
    dp = DAYPARTS[daypart_name]
    s_date = daypart_show_date(dt, daypart_name)

    show = get_or_build_daypart_show(conn, s_date, daypart_name, place=place, render_voice=True)
    segments = show.get("segments", [])
    total_duration = max(1, sum(s.get("duration") or 0 for s in segments))

    start_hour = dp["start_hour"]
    block_start_dt = datetime.combine(s_date, time(start_hour, 0), tzinfo=tz)
    if daypart_name == "late-night" and dt.hour < 12:
        block_start_dt = datetime.combine(s_date, time(22, 0), tzinfo=tz)

    elapsed_seconds = max(0, int((dt - block_start_dt).total_seconds()))
    seek_seconds = elapsed_seconds % total_duration

    accum = 0
    active_idx = 0
    offset_in_seg = 0
    for idx, seg in enumerate(segments):
        dur = seg.get("duration") or 180
        if accum + dur > seek_seconds:
            active_idx = idx
            offset_in_seg = seek_seconds - accum
            break
        accum += dur

    active_seg = segments[active_idx] if segments else None

    cur_dp_idx = DAYPART_ORDER.index(daypart_name)
    next_dp_name = DAYPART_ORDER[(cur_dp_idx + 1) % len(DAYPART_ORDER)]
    next_dp = DAYPARTS[next_dp_name]

    active_song = None
    if active_seg and active_seg.get("type") == "song":
        active_song = active_seg.get("song")
    else:
        for seg in segments[active_idx:]:
            if seg.get("type") == "song":
                active_song = seg.get("song")
                break

    return {
        "ok": True,
        "now": dt.isoformat(),
        "clock": format_12h_time(dt),
        "date": format_spoken_date(s_date),
        "place": place,
        "weather": get_vancouver_weather(place),
        "daypart": dp,
        "nextDaypart": next_dp,
        "showId": show.get("id"),
        "showTitle": show.get("title"),
        "currentSegmentIndex": active_idx,
        "segmentOffset": offset_in_seg,
        "elapsedInDaypart": elapsed_seconds,
        "totalDuration": total_duration,
        "activeSegment": active_seg,
        "activeSong": active_song,
        "show": show,
    }


def build_weekday_morning_show(
    conn,
    *,
    show_date: str | None = None,
    place: str = DEFAULT_PLACE,
    target_hours: float = 1.0,
    air_time: str = "06:00",
    force: bool = False,
) -> dict:
    return build_daypart_show(
        conn,
        show_date=show_date,
        daypart="morning",
        place=place,
        target_hours=target_hours,
        air_time=air_time,
        force=force,
        render_voice=True,
    )
