import asyncio
import logging
import os
import time
from pathlib import Path
from typing import AsyncGenerator

from .db import init_db
from .radio import get_live_station_state

log = logging.getLogger(__name__)

DEFAULT_BITRATE_BPS = 24000  # ~192 kbps = 24,000 bytes/sec
CHUNK_SIZE = 12000  # ~0.5 seconds of audio per chunk


async def live_mp3_stream_generator() -> AsyncGenerator[bytes, None]:
    """Continuous real-time MP3 audio stream generator for 24/7 radio.
    Plays through the daypart segments in sync with the live broadcast clock.
    When a song or talk clip ends, it rolls into the next segment automatically.
    """
    conn = init_db()
    
    while True:
        try:
            state = get_live_station_state(conn)
        except Exception as exc:
            log.warning(f"Error getting live station state: {exc}")
            await asyncio.sleep(2)
            continue

        show = state.get("show") or {}
        segments = show.get("segments") or []
        current_idx = state.get("currentSegmentIndex", 0)
        offset_seconds = state.get("segmentOffset", 0)

        if not segments:
            # Silence / keepalive chunk
            await asyncio.sleep(1)
            continue

        # Play from current_idx to the end of the show
        for idx in range(current_idx, len(segments)):
            segment = segments[idx]
            file_path = None

            if segment.get("type") == "song":
                song = segment.get("song") or {}
                file_path = song.get("audio_path") or song.get("mp3_path")
            elif segment.get("type") == "talk":
                file_path = segment.get("audio_path")

            if not file_path or not os.path.exists(file_path):
                continue

            try:
                p = Path(file_path)
                file_size = p.stat().st_size
                duration = segment.get("duration") or 180
                bytes_per_sec = file_size / duration if duration > 0 else DEFAULT_BITRATE_BPS

                with open(p, "rb") as f:
                    # If this is the initial segment when the user connected, seek to offset
                    if idx == current_idx and offset_seconds > 0:
                        start_pos = min(file_size, int(offset_seconds * bytes_per_sec))
                        f.seek(start_pos)
                        offset_seconds = 0  # reset for subsequent segments

                    while True:
                        t0 = time.monotonic()
                        chunk = f.read(CHUNK_SIZE)
                        if not chunk:
                            break

                        yield chunk

                        # Pace the streaming to real-time playback speed
                        expected_duration = len(chunk) / bytes_per_sec
                        elapsed = time.monotonic() - t0
                        delay = expected_duration - elapsed
                        if delay > 0:
                            await asyncio.sleep(delay)

            except asyncio.CancelledError:
                # Listener disconnected
                return
            except Exception as exc:
                log.warning(f"Error streaming segment {idx} ({file_path}): {exc}")
                await asyncio.sleep(0.5)


def get_stream_metadata() -> dict:
    """Returns currently playing track metadata for mobile and car dashboards."""
    try:
        conn = init_db()
        state = get_live_station_state(conn)
        active_seg = state.get("activeSegment") or {}
        active_song = state.get("activeSong") or {}
        dp = state.get("daypart") or {}

        is_talk = active_seg.get("type") == "talk"
        title = active_seg.get("title") if is_talk else (active_song.get("title") or "myspot track")
        artist = f"Host ({active_seg.get('host', 'DJ')})" if is_talk else (active_song.get("account") or "myspot FM")

        song_id = active_song.get("id")
        cover_url = f"/media/cover/{song_id}" if song_id else None

        return {
            "ok": True,
            "type": active_seg.get("type", "song"),
            "title": title,
            "artist": artist,
            "daypart": dp.get("label", "24/7 Live"),
            "mood": dp.get("mood", "auto"),
            "cover_url": cover_url,
            "song_id": song_id,
            "segment_offset": state.get("segmentOffset", 0),
            "segment_duration": active_seg.get("duration", 180),
            "clock": state.get("clock"),
            "now": state.get("now"),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "title": "myspot 24/7 AI Radio",
            "artist": "Live Broadcast",
            "daypart": "Continuous FM",
        }
