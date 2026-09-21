import pytest
from datetime import datetime, date
from pathlib import Path
from zoneinfo import ZoneInfo
from starlette.testclient import TestClient

from backend.app import app
from backend.tts import edge_tts_available, synthesize_radio_voice, RADIO_HOST_VOICES
from backend.radio import (
    DAYPARTS,
    DAYPART_ORDER,
    get_active_daypart_name,
    daypart_show_date,
    daypart_show_id,
    estimate_speech_duration,
)


def test_edge_tts_availability_and_voices():
    assert edge_tts_available() is True
    assert "pop-theory-cool-kid" in RADIO_HOST_VOICES
    assert "cosmic-fm" in RADIO_HOST_VOICES
    assert "crate-digger" in RADIO_HOST_VOICES


def test_daypart_schedule_definitions():
    assert len(DAYPARTS) == 6
    for dp_name in DAYPART_ORDER:
        dp = DAYPARTS[dp_name]
        assert "label" in dp
        assert "start_hour" in dp
        assert "end_hour" in dp
        assert "host" in dp
        assert "mood" in dp
        assert "keywords" in dp


def test_daypart_time_resolution():
    tz = ZoneInfo("America/Vancouver")
    # 07:30 -> Morning Drive
    dt_morning = datetime(2026, 9, 20, 7, 30, tzinfo=tz)
    assert get_active_daypart_name(dt_morning) == "morning"

    # 12:00 -> Midday Focus
    dt_midday = datetime(2026, 9, 20, 12, 0, tzinfo=tz)
    assert get_active_daypart_name(dt_midday) == "midday"

    # 16:15 -> Afternoon Rush
    dt_afternoon = datetime(2026, 9, 20, 16, 15, tzinfo=tz)
    assert get_active_daypart_name(dt_afternoon) == "afternoon"

    # 19:45 -> Golden Hour Lounge
    dt_evening = datetime(2026, 9, 20, 19, 45, tzinfo=tz)
    assert get_active_daypart_name(dt_evening) == "evening"

    # 23:00 -> Cosmic FM
    dt_late = datetime(2026, 9, 20, 23, 0, tzinfo=tz)
    assert get_active_daypart_name(dt_late) == "late-night"

    # 01:30 -> Cosmic FM (belongs to night of Sept 20)
    dt_late_wrap = datetime(2026, 9, 21, 1, 30, tzinfo=tz)
    assert get_active_daypart_name(dt_late_wrap) == "late-night"
    assert daypart_show_date(dt_late_wrap, "late-night") == date(2026, 9, 20)

    # 04:00 -> Overnight Tape
    dt_overnight = datetime(2026, 9, 21, 4, 0, tzinfo=tz)
    assert get_active_daypart_name(dt_overnight) == "overnight"
    assert daypart_show_date(dt_overnight, "overnight") == date(2026, 9, 21)


def test_api_dayparts_and_live():
    client = TestClient(app)
    r_dp = client.get("/api/radio/dayparts")
    assert r_dp.status_code == 200
    assert len(r_dp.json().get("dayparts", {})) == 6

    r_live = client.get("/api/radio/live?place=Vancouver")
    assert r_live.status_code == 200
    data = r_live.json()
    assert data["ok"] is True
    assert "daypart" in data
    assert "currentSegmentIndex" in data
    assert "show" in data
    assert len(data["show"]["segments"]) > 0


def test_media_radio_voice_serving():
    client = TestClient(app)
    r_live = client.get("/api/radio/live?place=Vancouver")
    data = r_live.json()
    show_id = data["showId"]
    
    # Check if voice clip can be fetched
    talk_segs = [s for s in data["show"]["segments"] if s.get("type") == "talk" and s.get("audio_url")]
    if talk_segs:
        url = talk_segs[0]["audio_url"]
        r_voice = client.get(url)
        assert r_voice.status_code == 200
        assert len(r_voice.content) > 0


def test_stream_endpoints():
    client = TestClient(app)
    r_head = client.head("/api/radio/stream.mp3")
    assert r_head.status_code == 200
    assert r_head.headers.get("content-type") == "audio/mpeg"

    r_stream_head = client.head("/stream", follow_redirects=False)
    assert r_stream_head.status_code in (302, 307)
    assert r_stream_head.headers.get("location") == "/api/radio/stream.mp3"

    r_meta = client.get("/api/radio/stream/meta")
    assert r_meta.status_code == 200
    assert r_meta.json().get("ok") is True


def test_vancouver_weather_and_12h_time():
    from backend.radio import (
        format_12h_time,
        format_spoken_date,
        get_vancouver_weather,
        _build_daypart_segments,
    )

    # 1. 12-hour AM/PM time tests (never 24-hour time)
    assert format_12h_time("06:00") == "6:00 AM"
    assert format_12h_time("14:30") == "2:30 PM"
    assert format_12h_time("22:00") == "10:00 PM"
    assert format_12h_time("00:15") == "12:15 AM"
    assert format_12h_time("12:00") == "12:00 PM"
    assert "24:" not in format_12h_time("00:00")
    assert "14:" not in format_12h_time("14:00")

    # 2. Spoken date tests
    d = date(2026, 9, 20)
    spoken_d = format_spoken_date(d)
    assert "Sunday" in spoken_d
    assert "September 20th" in spoken_d

    # 3. Weather fetch test
    wx = get_vancouver_weather("Vancouver, Canada")
    assert "temperature_c" in wx
    assert isinstance(wx["temperature_c"], (int, float))
    assert "degrees Celsius" in wx["phrase"]

    # 4. Daypart talk segments contain spoken date, 12h time, and Celsius weather
    dummy_songs = [
        {"id": i, "title": f"Song {i}", "duration": 180, "account": "main"}
        for i in range(1, 15)
    ]
    segs = _build_daypart_segments(dummy_songs, d, "morning", place="Vancouver, Canada", air_time="06:00")
    talk_segs = [s for s in segs if s.get("type") == "talk"]

    sign_on = talk_segs[0]
    assert "Vancouver, Canada" in sign_on["text"]
    assert "6:00 AM" in sign_on["text"]
    assert "Sunday, September 20th" in sign_on["text"]
    assert "degrees Celsius" in sign_on["text"]

    # Verify weather checkpoint has Celsius and 12h AM/PM
    wx_checkpoint = next(s for s in talk_segs if "Weather" in s.get("title", ""))
    assert "degrees Celsius" in wx_checkpoint["text"]
    assert ("AM" in wx_checkpoint["text"] or "PM" in wx_checkpoint["text"])
    assert "Vancouver, Canada" in wx_checkpoint["text"]


