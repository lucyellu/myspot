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
