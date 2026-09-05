"""Build a finance/news-heavy weekday morning radio show.

This creates a saved show manifest, a plain-text script, and optional Groq TTS
WAV clips for each talk segment. It intentionally uses an original two-host
format instead of copying named living public figures.
"""
from __future__ import annotations

import argparse
import html.parser
import json
import shutil
from copy import deepcopy
from datetime import date, datetime, timedelta
from pathlib import Path
import sys
from urllib import error, request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.config import EXPORTS_DIR  # noqa: E402
from backend.db import init_db  # noqa: E402
from backend.radio import _choose_songs, estimate_speech_duration, local_show_date  # noqa: E402
from backend.tts import groq_tts_available, synthesize_groq_wav, synthesize_windows_wav  # noqa: E402
from tools.daily_market_briefing import build_daily_briefing, format_items_for_script  # noqa: E402
from tools.export_radio_clip_scripts import export_show_clip_pack  # noqa: E402

RADIO_SHOWS_DIR = EXPORTS_DIR / "radio_shows"
TZ = ZoneInfo("America/Vancouver")


class TextExtractor(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if text:
            self.parts.append(text)


def next_weekday(start: date | None = None) -> date:
    d = start or local_show_date()
    d += timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def weekday_or_next(d: date) -> date:
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def show_id_for(d: date) -> str:
    return f"weekday-morning-{d.isoformat()}"


def next_iteration_id(base_id: str) -> str:
    existing = {path.stem for path in RADIO_SHOWS_DIR.glob(f"{base_id}-v*.json")}
    n = 1
    while f"{base_id}-v{n:02d}" in existing:
        n += 1
    return f"{base_id}-v{n:02d}"


def archive_existing_show(base_id: str) -> str | None:
    base_json = RADIO_SHOWS_DIR / f"{base_id}.json"
    base_dir = RADIO_SHOWS_DIR / base_id
    if not base_json.exists() and not base_dir.exists():
        return None

    archive_id = next_iteration_id(base_id)
    archive_json = RADIO_SHOWS_DIR / f"{archive_id}.json"
    archive_dir = RADIO_SHOWS_DIR / archive_id

    if base_dir.exists():
        shutil.copytree(base_dir, archive_dir, dirs_exist_ok=False)
    if base_json.exists():
        data = json.loads(base_json.read_text(encoding="utf-8"))
        data["id"] = archive_id
        data["iterationOf"] = base_id
        data["title"] = f"{data.get('title') or base_id} · {archive_id.rsplit('-', 1)[-1].upper()}"
        if isinstance(data.get("artifacts"), dict):
            for key, value in list(data["artifacts"].items()):
                if isinstance(value, str):
                    data["artifacts"][key] = value.replace(f"/{base_id}/", f"/{archive_id}/")
        for segment in data.get("segments", []):
            if isinstance(segment.get("audio_path"), str):
                segment["audio_path"] = segment["audio_path"].replace(f"/{base_id}/", f"/{archive_id}/")
            if segment.get("audioFile"):
                segment["audio_url"] = f"/media/radio_voice/{archive_id}/{segment['audioFile']}"
        archive_json.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return archive_id


def talk(title: str, speaker: str, text: str, *, voice: str, min_duration: int = 70) -> dict:
    return {
        "type": "talk",
        "title": title,
        "speaker": speaker,
        "voice": voice,
        "text": text,
        "duration": max(min_duration, estimate_speech_duration(text)),
    }


def song_segment(song: dict) -> dict:
    return {
        "type": "song",
        "title": song.get("title") or "Untitled",
        "song": song,
        "duration": song.get("duration") or 180,
    }


def fetch_tldr_ai(d: date) -> dict:
    url = f"https://ai.tldr.tech/p/{d.isoformat()}-tldr-ai"
    try:
        req = request.Request(url, headers={"User-Agent": "myspot-radio/1.0"})
        with request.urlopen(req, timeout=20) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except error.HTTPError as exc:
        return {"url": url, "ok": False, "error": f"HTTP {exc.code}"}
    except Exception as exc:
        return {"url": url, "ok": False, "error": f"{type(exc).__name__}: {exc}"}

    parser = TextExtractor()
    parser.feed(html)
    lines = parser.parts
    useful = []
    capture = False
    for item in lines:
        if item in {"Headlines & Launches", "Deep Dives & Analysis", "Engineering & Research", "Miscellaneous"}:
            capture = True
            useful.append(item)
            continue
        if item in {"Quick Links", "Want to advertise in TLDR?", "Want to work at TLDR?"}:
            capture = False
        if capture and len(item) > 25 and "{{PreviewText}}" not in item:
            useful.append(item)
        if len(useful) >= 18:
            break
    return {"url": url, "ok": True, "items": useful[:18]}


def script_lines(show: dict) -> str:
    out = [
        show["title"],
        f"Saved: {show['savedAt']}",
        f"Source: {show['context'].get('source')}",
        "",
    ]
    for idx, segment in enumerate(show["segments"], 1):
        if segment.get("type") == "talk":
            speaker = segment.get("speaker") or "Host"
            out.append(f"[{idx:02d}] {speaker} - {segment.get('title')}")
            out.append(segment.get("text") or "")
            out.append("")
        else:
            out.append(f"[{idx:02d}] SONG - {segment.get('title')}")
            out.append("")
    return "\n".join(out).strip() + "\n"


def render_voice(show: dict, *, force: bool = False, limit: int | None = None) -> list[dict]:
    show_id = show["id"]
    voice_dir = RADIO_SHOWS_DIR / show_id / "voice"
    results = []
    rendered = 0
    for idx, segment in enumerate(show["segments"], 1):
        if segment.get("type") != "talk":
            continue
        if limit is not None and rendered >= limit:
            break
        filename = f"talk_{idx:02d}.wav"
        out_path = voice_dir / filename
        if out_path.exists() and not force:
            result = {"ok": True, "provider": "existing", "path": str(out_path).replace("\\", "/")}
        else:
            result = {"ok": False, "error": "GROQ_API_KEY is not configured"}
            if groq_tts_available():
                result = synthesize_groq_wav(
                    segment.get("text") or "",
                    out_path,
                    voice=segment.get("voice") or "Fritz-PlayAI",
                )
            if not result.get("ok"):
                fallback = synthesize_windows_wav(segment.get("text") or "", out_path)
                fallback["fallback_from"] = result.get("error")
                result = fallback
        results.append({"segment": idx, "title": segment.get("title"), **result})
        if result.get("ok"):
            segment["audio_path"] = result["path"]
            segment["audioFile"] = filename
            segment["audio_url"] = f"/media/radio_voice/{show_id}/{filename}"
            segment["ttsProvider"] = result.get("provider")
        rendered += 1
    return results


def build_show(show_date: date, *, with_tts: bool, force_tts: bool, tts_limit: int | None) -> dict:
    conn = init_db()
    songs = _choose_songs(conn, show_date, target_seconds=900)
    picks = [deepcopy(song) for song in songs[:3]]
    tldr_date = show_date
    tldr_today = fetch_tldr_ai(tldr_date)
    briefing = build_daily_briefing(show_date)
    show_id = show_id_for(show_date)
    show_day = show_date.strftime("%A, %B %d, %Y")
    market_session = (show_date - timedelta(days=1)).strftime("%A, %B %d")
    tldr_label = f"{tldr_date.strftime('%B')} {tldr_date.day}"

    market_movers = briefing.get("marketMovers") or [
        "Live market feeds did not return usable items; check the saved source list before publishing.",
    ]
    past_digest = format_items_for_script(
        briefing.get("pastDayHeadlines", []),
        limit=5,
        fallback="The live past-day feed desk did not return enough usable headlines, so this show should be treated as a structure check rather than a complete market brief.",
    )
    incoming_digest = format_items_for_script(
        briefing.get("incomingDayWatchlist", []),
        limit=5,
        fallback="The incoming-day watchlist feed did not return enough usable headlines; check futures, earnings calendars, and macro releases manually before airing.",
    )
    ai_feed_digest = format_items_for_script(
        briefing.get("aiAndTech", []),
        limit=4,
        fallback="",
    )
    macro_digest = format_items_for_script(
        briefing.get("macroAndRates", []),
        limit=4,
        fallback="No dedicated macro/rates items were ranked by the live feeds.",
    )
    earnings_digest = format_items_for_script(
        briefing.get("earningsAndMovers", []),
        limit=4,
        fallback="No dedicated earnings or mover items were ranked by the live feeds.",
    )
    source_line = briefing.get("sourceLine") or "live briefing feeds unavailable"
    ai_items = tldr_today.get("items") if tldr_today.get("ok") else []
    if not isinstance(ai_items, list):
        ai_items = []
    tldr_summary = "; ".join(
        item for item in ai_items
        if item not in {"Headlines & Launches", "Deep Dives & Analysis", "Engineering & Research", "Miscellaneous"}
    )
    if len(tldr_summary) > 420:
        tldr_summary = tldr_summary[:420].rsplit(" ", 1)[0].rstrip(".,;:") + "."
    if not tldr_summary and ai_items:
        tldr_summary = ai_items[0]
    if ai_feed_digest and tldr_summary:
        ai_summary = f"{ai_feed_digest} TLDR AI's public {tldr_label} issue adds: {tldr_summary}"
    elif ai_feed_digest:
        ai_summary = ai_feed_digest
    elif tldr_summary:
        ai_summary = f"TLDR AI's public {tldr_label} issue says: {tldr_summary}"
    else:
        ai_summary = "The AI feed desk did not return a strong item during build; treat this as a watchlist gap and check primary AI sources before airing."
    if len(ai_summary) > 780:
        ai_summary = ai_summary[:780].rsplit(" ", 1)[0].rstrip(".,;:") + "."

    focus_one = market_movers[0]
    focus_two = market_movers[1] if len(market_movers) > 1 else incoming_digest
    focus_three = market_movers[2] if len(market_movers) > 2 else macro_digest
    final_map = " ".join(market_movers[:3])
    if len(final_map) > 520:
        final_map = final_map[:520].rsplit(" ", 1)[0].rstrip(".,;:") + "."

    a = "Mason"
    b = "Julian"
    voice_a = "Fritz-PlayAI"
    voice_b = "Basil-PlayAI"
    segments: list[dict] = [
        talk(
            "Opening Bell",
            a,
            f"Good morning. This is the myspot market desk for {show_day}. Today is built from live daily inputs: {source_line}. The show is still two fictional market hosts and three song breaks, but the agenda is now past-day headlines, incoming-day watchlist, macro, earnings, and AI read-throughs. Not financial advice. Treat it as a briefing you can scrub.",
            voice=voice_a,
            min_duration=95,
        ),
        talk(
            "Source Check",
            b,
            "New rule: no pretending one stale market story is the whole market. We pull a daily feed set, rank for recency and market relevance, and then say what the feed is flagging. If a headline is only a headline, we call it that. If it needs confirmation from filings, calendars, or a real quote, we say that too.",
            voice=voice_b,
            min_duration=90,
        ),
        talk(
            "Past Day Market Map",
            a,
            f"Past-day map from the {market_session} session into this morning: {past_digest} That is the raw stack. The job now is to separate what actually changes the tape from what is just a loud headline wearing a blazer.",
            voice=voice_a,
            min_duration=105,
        ),
    ]
    if picks:
        segments.append(song_segment(picks[0]))
    segments.extend([
        talk(
            "Incoming Day Watchlist",
            b,
            f"Incoming-day watchlist: {incoming_digest} Translation: this is what can change the first hour of trading. Futures and premarket headlines tell you tone. Economic calendar items tell you what can flip the tone. Earnings tell you where single-name volatility can get noisy fast.",
            voice=voice_b,
            min_duration=115,
        ),
        talk(
            "Earnings And Movers",
            a,
            f"Earnings and movers desk: {earnings_digest} The useful question after any move is whether the headline changes forward cash flow, changes investor positioning, or just gives traders a reason to chase the same argument with more volume.",
            voice=voice_a,
            min_duration=135,
        ),
        talk(
            "First Focus",
            a,
            f"First focus: {focus_one} My read is simple: lead with the item the feed ranks highest, but do not confuse ranking with truth. Ranking means relevant and timely. The thesis still has to survive numbers, source quality, and what was already priced in yesterday.",
            voice=voice_a,
            min_duration=105,
        ),
    ])
    for item in picks[1:3]:
        segments.append(song_segment(item))
    segments.extend([
        talk(
            "No More Song Breaks",
            a,
            "That is the music budget for the show. Three songs, done. From here on out, it is mostly two people sorting a live news stack with too much market vocabulary and not enough adult supervision. If you wanted a playlist, bad news. If you wanted a daily briefing that stops replaying yesterday's bit, better news.",
            voice=voice_a,
            min_duration=95,
        ),
        talk(
            "Second Focus",
            b,
            f"Second focus: {focus_two} The classroom question is what changed since the last close. Did estimates move? Did rates move? Did a company give guidance? Did a court, regulator, central bank, or customer change the setup? If the answer is no, then the headline may still matter, but it is probably more sentiment than substance.",
            voice=voice_b,
            min_duration=115,
        ),
        talk(
            "AI And Tech Desk",
            a,
            f"AI and tech scan: {ai_summary} For the market, the point is not just whether a model demo is cool. The point is whether budget moves into cloud, chips, data centers, software seats, security, search, ads, devices, or productivity workflows.",
            voice=voice_a,
            min_duration=120,
        ),
        talk(
            "AI Read-Through",
            b,
            "The market still treats AI as both a product cycle and a capital expenditure cycle. That means the read-through can hit chips, servers, networking, memory, power, cooling, cloud platforms, app software, and ad tools. The hard part is separating companies with durable margin from companies that merely appear in the same paragraph as the word AI.",
            voice=voice_b,
            min_duration=105,
        ),
    ])
    segments.extend([
        talk(
            "Macro And Rates",
            a,
            f"Macro and rates desk: {macro_digest} Macro is the part of the show that ruins everyone's clean single-stock thesis. A great company can still trade badly if yields, inflation, oil, currency, or central-bank language pushes the whole market multiple around.",
            voice=voice_a,
            min_duration=100,
        ),
        talk(
            "Third Focus",
            b,
            f"Third focus: {focus_three} This is where I would ask what the market needs next. A headline can start a move, but follow-through usually needs confirmation: analyst revisions, volume, calendar catalysts, management detail, or a macro backdrop that does not immediately fight the trade.",
            voice=voice_b,
            min_duration=95,
        ),
        talk(
            "Risk Desk",
            a,
            "Risk check. The most dangerous phrase in a market morning is everybody knows. Everybody knows the obvious headline by the time it is in every feed. The job is to ask what is already in the price, what has to happen next, and what would break the thesis fastest.",
            voice=voice_a,
            min_duration=95,
        ),
        talk(
            "Opinionated Take One",
            b,
            "Take one: a dynamic show needs live source discipline more than it needs hotter adjectives. A custom Google search API would be cleaner and more controllable, but even the free RSS/search feed layer already fixes the main failure: the show should not keep waking up with the same market memory.",
            voice=voice_b,
            min_duration=115,
        ),
        talk(
            "Opinionated Take Two",
            a,
            "Take two: the feed should not be the final brain. Feeds are sensors. The host script still has to decide what matters, what is probably noise, what needs a number, and what belongs in the incoming-day watchlist because it can actually change today's tape.",
            voice=voice_a,
            min_duration=115,
        ),
        talk(
            "Volatility Board",
            b,
            "Volatility board. Sort moves by type. Event volatility comes from earnings, guidance, data, court rulings, and central-bank language. Narrative volatility comes from a story getting repriced faster than the numbers. Reflexive volatility comes from attention feeding price and price feeding attention. Do not treat them like the same trade just because the percentage move is large.",
            voice=voice_b,
            min_duration=120,
        ),
        talk(
            "Earnings Desk",
            a,
            "Earnings desk. The useful question after a beat is whether the beat was pull-forward, pricing power, cost control, or a real demand inflection. The useful question after a miss is whether the miss was one-time, cyclical, competitive, or a management credibility problem. Same headline category, very different trading map.",
            voice=voice_a,
            min_duration=120,
        ),
        talk(
            "Student Portfolio Argument",
            b,
            "Here is the campus argument. One student says buy the strongest story because momentum compounds. The other says the strongest story is where valuation risk hides. The correct answer is usually position sizing. You can respect momentum without making it your entire net worth. You can respect valuation without shorting every stock that looks expensive. Markets punish certainty more often than they punish curiosity.",
            voice=voice_b,
            min_duration=110,
        ),
        talk(
            "Search Desk",
            a,
            "Search desk. For now, this uses public RSS and Google News RSS search-style feeds. A proper Google Custom Search setup would let us control allowed domains, query sets, and result freshness more tightly. The feed layer in the saved JSON is built so we can swap that in later without rewriting the show format.",
            voice=voice_a,
            min_duration=125,
        ),
        talk(
            "Morning Bell Discipline",
            b,
            "Morning bell discipline. Before the open, write down what would change your mind. Not what would make you feel smart. What would change your mind. For any headline in today's stack, name the confirming evidence, the disconfirming evidence, and the time window where you will admit the setup did not work.",
            voice=voice_b,
            min_duration=125,
        ),
        talk(
            "Host Argument",
            a,
            "Here is where I disagree with the usual morning-bell chest thumping. Being early is not the same as being right. Being loud is not the same as having edge. The person yelling conviction at 6 AM may just be under-caffeinated and overlevered. Edge is boring. Edge is knowing the unit economics, the calendar, the balance sheet, the setup, and when your own enthusiasm is doing push-ups in the mirror.",
            voice=voice_a,
            min_duration=125,
        ),
        talk(
            "Counterargument",
            b,
            "Counterpoint: sometimes the loud person is right because markets are not Supreme Court opinions. They do not wait for perfect evidence. Momentum can be information. The trick is not pretending momentum is fake. The trick is admitting momentum is real while also admitting it can leave the party through a bathroom window without texting you.",
            voice=voice_b,
            min_duration=110,
        ),
        talk(
            "Joke Desk",
            a,
            "Joke desk. Every finance student has three tabs open: a spreadsheet, a chart, and a third tab they minimize whenever someone asks what their actual thesis is. Today, the third tab is probably labeled AI infrastructure total addressable market, and it contains one line that says vibes, but in a very professional font.",
            voice=voice_a,
            min_duration=95,
        ),
        talk(
            "Actual Thesis Check",
            b,
            "Actual thesis check. For each story, write the sentence that would still make sense tomorrow if the stock moved the other way today. If the thesis only works when price confirms it immediately, that is not a thesis. That is a candle with a publicist.",
            voice=voice_b,
            min_duration=115,
        ),
    ])
    segments.extend([
        talk(
            "What I Would Ignore",
            a,
            "What I would ignore: victory-lap screenshots, anonymous accounts using twelve rocket emojis, and any headline that says investors cheer without telling you which investors and why. The market does not have one opinion. It has a price created by disagreement, liquidity, forced flows, options dealers, index funds, and people panic-clicking before a meeting.",
            voice=voice_a,
            min_duration=110,
        ),
        talk(
            "What I Would Respect",
            b,
            "What I would respect: revisions, volume, gross margin, backlog, cash flow, and management teams that under-promise without sounding terrified. Also, boring language. If a CEO can explain the business without sounding like they swallowed a conference keynote, I immediately trust the transcript ten percent more.",
            voice=voice_b,
            min_duration=105,
        ),
        talk(
            "What We Would Watch",
            b,
            f"What we would watch: follow-through on the top feed stories, breadth under the index move, whether macro headlines confirm or fight the tape, and whether the incoming-day watchlist actually becomes price action. Today's raw map starts here: {final_map}",
            voice=voice_b,
            min_duration=115,
        ),
        talk(
            "Dream Sponsor",
            a,
            "Today's imaginary sponsor is a paper trading account that locks itself after three bad decisions and makes you explain the thesis out loud before reopening. Comes with a Wharton hoodie, a Bloomberg keyboard you cannot afford, and a large physical OFF button for when the group chat becomes investment research.",
            voice=voice_a,
            min_duration=85,
        ),
    ])
    segments.extend([
        talk(
            "No Trade Is Also A Trade",
            a,
            "Important desk note: no trade is also a trade. Sitting out is not weakness. It is a position with zero commission and excellent sleep characteristics. The market will try to convince you every candle is a personality test. It is not. Sometimes the smartest move is letting someone else pay tuition.",
            voice=voice_a,
            min_duration=95,
        ),
        talk(
            "Final Debate",
            b,
            "Final debate. Mason wants discipline. I want momentum with a helmet. The compromise is simple: respect the move, distrust the easy story, and never let a ticker with a hot premarket print talk you into forgetting your process. The market is entertaining because it is a voting machine, a weighing machine, and occasionally a group project where nobody read the syllabus.",
            voice=voice_b,
            min_duration=115,
        ),
        talk(
            "Final Bell",
            b,
            f"The morning map is dynamic now: {final_map} If you only remember one thing, remember this: a feed is not a forecast. It is a sensor. The edge is knowing which signal deserves attention and which signal is just loud.",
            voice=voice_b,
            min_duration=110,
        ),
        talk(
            "Signoff",
            a,
            f"That is the finance-heavy myspot morning show for {show_day}. More talking, less shuffle, cleaner market context. Scrub back for the ticker desk, skip forward for songs, and hit OFF whenever the tape stops being useful.",
            voice=voice_a,
            min_duration=75,
        ),
    ])

    total = sum(seg.get("duration") or 0 for seg in segments)
    show = {
        "id": show_id,
        "title": f"{show_date.isoformat()} - 6 AM finance/news morning",
        "savedAt": datetime.now(TZ).isoformat(),
        "source": "myspot finance morning builder",
        "context": {
            "date": show_date.strftime("%A, %B %d, %Y"),
            "time": "06:00",
            "daypart": "morning",
            "place": "Vancouver",
            "source": "Local library + live RSS/Google News briefing + public TLDR AI",
            "hostFormat": "two fictional Wharton-style market hosts; no named-person imitation",
            "marketMovers": market_movers,
            "dailyBriefing": briefing,
            "tldrAi": {"url": tldr_today.get("url"), "ok": tldr_today.get("ok"), "items": ai_items},
        },
        "prefs": {
            "place": "Vancouver",
            "host": "fictional-two-host-market-desk",
            "mood": "finance-news-morning",
            "brands": "Bloomberg Terminal, TradingView, The Wall Street Journal, TLDR AI, espresso, index cards",
            "buildZone": "America/New_York",
            "airZone": "America/Los_Angeles",
            "leadMinutes": 45,
            "showDate": show_date.isoformat(),
            "airTime": "06:00",
            "targetHours": 1.0,
            "showFormat": "finance-news-morning",
            "dailyAgenda": "Past-day market headlines, incoming-day watchlist, earnings/movers, macro/rates, AI/tech scan, risk desk.",
            "bookmarkNotes": "",
        },
        "total": total,
        "currentSegmentIndex": 0,
        "liveSongId": picks[0]["id"] if picks else None,
        "segments": segments,
    }

    archived_as = archive_existing_show(show_id)
    show_dir = RADIO_SHOWS_DIR / show_id
    show_dir.mkdir(parents=True, exist_ok=True)
    script_path = show_dir / "script.txt"
    script_path.write_text(script_lines(show), encoding="utf-8")
    show["artifacts"] = {
        "script_txt": str(script_path).replace("\\", "/"),
        "voice_dir": str((show_dir / "voice")).replace("\\", "/"),
    }
    if archived_as:
        show["previousIterationId"] = archived_as

    tts_results = []
    if with_tts:
        tts_results = render_voice(show, force=force_tts, limit=tts_limit)
        script_path.write_text(script_lines(show), encoding="utf-8")
    clip_pack = export_show_clip_pack(show)
    show["artifacts"]["clip_scripts_dir"] = str((show_dir / "generator_clips")).replace("\\", "/")
    show["artifacts"]["clip_scripts_txt"] = clip_pack["files"]["combinedSuno"]
    show["artifacts"]["clip_scripts_json"] = clip_pack["files"]["json"]

    RADIO_SHOWS_DIR.mkdir(parents=True, exist_ok=True)
    (RADIO_SHOWS_DIR / f"{show_id}.json").write_text(json.dumps(show, indent=2), encoding="utf-8")
    show["ttsResults"] = tts_results
    return show


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="YYYY-MM-DD. Defaults to today in Vancouver, or next Monday on weekends.")
    parser.add_argument("--days-ahead", type=int, default=0, help="Build today + N days in Vancouver when --date is omitted.")
    parser.add_argument("--tts", action="store_true", help="Render talk segments to Groq WAV files.")
    parser.add_argument("--force-tts", action="store_true")
    parser.add_argument("--tts-limit", type=int, default=None, help="Limit rendered talk clips for testing.")
    args = parser.parse_args()

    if args.date:
        d = date.fromisoformat(args.date)
    else:
        d = weekday_or_next(local_show_date() + timedelta(days=args.days_ahead))
    show = build_show(d, with_tts=args.tts, force_tts=args.force_tts, tts_limit=args.tts_limit)
    print(json.dumps({
        "id": show["id"],
        "title": show["title"],
        "total_minutes": round(show["total"] / 60, 1),
        "talk_segments": sum(1 for s in show["segments"] if s.get("type") == "talk"),
        "song_segments": sum(1 for s in show["segments"] if s.get("type") == "song"),
        "script": show.get("artifacts", {}).get("script_txt"),
        "tts": show.get("ttsResults", []),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
