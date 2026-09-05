"""Fetch and rank daily market/news inputs for generated radio shows."""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from urllib import error, parse, request
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Vancouver")


@dataclass(frozen=True)
class FeedSpec:
    name: str
    url: str
    lane: str


IMPORTANT_KEYWORDS = {
    "futures": 12,
    "premarket": 12,
    "before the bell": 10,
    "after hours": 10,
    "earnings": 10,
    "guidance": 8,
    "outlook": 8,
    "revenue": 6,
    "profit": 6,
    "stocks": 7,
    "stock market": 9,
    "nasdaq": 8,
    "s&p 500": 8,
    "dow": 5,
    "fed": 8,
    "federal reserve": 8,
    "inflation": 8,
    "jobs report": 7,
    "treasury": 7,
    "yields": 7,
    "tariff": 6,
    "oil": 5,
    "ai": 8,
    "artificial intelligence": 8,
    "nvidia": 8,
    "openai": 7,
    "microsoft": 6,
    "alphabet": 5,
    "amazon": 5,
    "meta": 5,
    "apple": 5,
    "semiconductor": 6,
    "chips": 6,
}

AI_KEYWORDS = (
    "ai",
    "artificial intelligence",
    "nvidia",
    "openai",
    "anthropic",
    "microsoft",
    "alphabet",
    "google",
    "meta",
    "amazon",
    "semiconductor",
    "chip",
    "chips",
    "data center",
    "datacenter",
)

MACRO_KEYWORDS = (
    "fed",
    "federal reserve",
    "inflation",
    "jobs report",
    "payroll",
    "treasury",
    "yield",
    "yields",
    "rates",
    "oil",
    "dollar",
    "tariff",
    "china",
    "bank of canada",
)

EARNINGS_KEYWORDS = (
    "earnings",
    "guidance",
    "revenue",
    "profit",
    "outlook",
    "buyback",
    "shares rise",
    "shares fall",
    "stock jumps",
    "stock falls",
    "market mover",
)

INCOMING_KEYWORDS = (
    "futures",
    "premarket",
    "before the bell",
    "what to watch",
    "economic calendar",
    "this morning",
    "opening bell",
)

SOURCE_WEIGHTS = {
    "reuters": 30,
    "bloomberg": 28,
    "financial times": 26,
    "wall street journal": 26,
    "wsj": 26,
    "barron's": 24,
    "cnbc": 22,
    "marketwatch": 22,
    "yahoo finance": 20,
    "investor's business daily": 18,
    "associated press": 16,
    "ap news": 16,
    "morningstar": 14,
    "nasdaq": 14,
    "tradingview": 10,
    "seeking alpha": 8,
}

SOURCE_PENALTIES = {
    "the sunday guardian": -24,
    "analytics insight": -18,
    "aol.com": -14,
    "msn": -12,
    "mettis global": -10,
    "marketwise": -8,
}

TITLE_PENALTY_PHRASES = (
    "top tech news today",
    "why is us stock market",
    "what investors should watch",
    "live:",
)


def _google_news_url(query: str) -> str:
    encoded = parse.quote_plus(query)
    return f"https://news.google.com/rss/search?q={encoded}&hl=en-US&gl=US&ceid=US:en"


def _feed_specs(show_date: date) -> list[FeedSpec]:
    day = show_date.strftime("%B %d %Y")
    return [
        FeedSpec("Google News: stock market past day", _google_news_url("stock market news when:1d"), "past"),
        FeedSpec("Google News: market movers", _google_news_url("stock market movers earnings when:1d"), "past"),
        FeedSpec("Google News: AI stocks", _google_news_url("AI stocks Nvidia OpenAI Microsoft when:1d"), "ai"),
        FeedSpec("Google News: macro/rates", _google_news_url("Federal Reserve inflation Treasury yields stocks when:1d"), "macro"),
        FeedSpec("Google News: incoming market day", _google_news_url(f"premarket futures economic calendar earnings today {day}"), "incoming"),
        FeedSpec("Google News: before the bell", _google_news_url("before the bell stocks futures today when:1d"), "incoming"),
        FeedSpec("Google News: Canada markets", _google_news_url("TSX Bank of Canada market stocks when:1d"), "macro"),
        FeedSpec("Yahoo Finance news", "https://finance.yahoo.com/news/rssindex", "past"),
        FeedSpec("CNBC top news", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "past"),
        FeedSpec("MarketWatch top stories", "https://feeds.content.dowjones.io/public/rss/mw_topstories", "past"),
    ]


def _fetch_text(url: str, timeout: int = 8) -> str:
    req = request.Request(
        url,
        headers={
            "User-Agent": "myspot-radio/1.0 (+https://localhost)",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
    )
    with request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _tag_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _child_text(node: ET.Element, *names: str) -> str:
    wanted = {name.lower() for name in names}
    for child in list(node):
        if _tag_name(child.tag) in wanted and child.text:
            return _clean_text(child.text)
    return ""


def _clean_text(value: str) -> str:
    text = html.unescape(value or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _parse_datetime(value: str) -> str | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(TZ).isoformat()


def _title_source(title: str, feed_name: str, rss_source: str) -> tuple[str, str]:
    clean = _clean_text(title)
    source = rss_source or feed_name
    match = re.match(r"^(?P<title>.+?)\s+-\s+(?P<source>[^-]{2,80})$", clean)
    if match and "Google News" in feed_name:
        clean = match.group("title").strip()
        source = match.group("source").strip()
    return clean, source


def _parse_feed(xml_text: str, spec: FeedSpec) -> list[dict]:
    root = ET.fromstring(xml_text)
    entries = []
    nodes = [node for node in root.iter() if _tag_name(node.tag) in {"item", "entry"}]
    for node in nodes:
        raw_title = _child_text(node, "title")
        if not raw_title:
            continue
        rss_source = _child_text(node, "source")
        title, source = _title_source(raw_title, spec.name, rss_source)
        link = _child_text(node, "link")
        if not link:
            for child in list(node):
                if _tag_name(child.tag) == "link":
                    link = child.attrib.get("href", "")
                    if link:
                        break
        description = _child_text(node, "description", "summary", "content")
        published = _parse_datetime(_child_text(node, "pubDate", "published", "updated"))
        entries.append(
            {
                "title": title,
                "source": source,
                "feed": spec.name,
                "lane": spec.lane,
                "link": link,
                "published": published,
                "summary": description[:500],
            }
        )
    return entries


def _normal_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def _has_keyword(text: str, keyword: str) -> bool:
    if re.fullmatch(r"[a-z0-9]{1,3}", keyword):
        return re.search(rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])", text) is not None
    return keyword in text


def _contains_any(text: str, needles: tuple[str, ...]) -> bool:
    return any(_has_keyword(text, needle) for needle in needles)


def _source_score(item: dict) -> int:
    blob = f"{item.get('source', '')} {item.get('feed', '')}".lower()
    score = 0
    matched_known_source = False
    for source, weight in SOURCE_WEIGHTS.items():
        if source in blob:
            score += weight
            matched_known_source = True
    for source, penalty in SOURCE_PENALTIES.items():
        if source in blob:
            score += penalty
            matched_known_source = True
    if "google news" in blob and not matched_known_source:
        score -= 4
    return score


def _score_item(item: dict, now: datetime) -> int:
    title = (item.get("title") or "").lower()
    summary = (item.get("summary") or "").lower()
    blob = f"{title} {summary}"
    score = 10 + _source_score(item)
    for keyword, weight in IMPORTANT_KEYWORDS.items():
        if _has_keyword(blob, keyword):
            score += weight
    if item.get("lane") == "incoming":
        score += 8
    if item.get("lane") == "ai":
        score += 5
    if item.get("lane") == "macro":
        score += 4
    published = item.get("published")
    if published:
        try:
            dt = datetime.fromisoformat(published)
            hours = max(0.0, (now - dt).total_seconds() / 3600)
            if hours <= 36:
                score += int(max(0, 36 - hours))
            elif hours > 96:
                score -= 20
        except ValueError:
            pass
    if len(title) < 20:
        score -= 15
    if "newsletter" in title and "tldr" not in title:
        score -= 4
    if any(phrase in title for phrase in TITLE_PENALTY_PHRASES):
        score -= 8
    return score


def _dedupe_rank(items: list[dict], now: datetime) -> list[dict]:
    seen: set[str] = set()
    ranked = []
    for item in items:
        key = _normal_title(item.get("title") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        item = dict(item)
        item["score"] = _score_item(item, now)
        ranked.append(item)
    ranked.sort(key=lambda x: x.get("score", 0), reverse=True)
    return ranked


def _filter_lane(
    items: list[dict],
    needles: tuple[str, ...],
    lane: str | None = None,
    *,
    require_lane: bool = False,
) -> list[dict]:
    out = []
    for item in items:
        blob = f"{item.get('title', '')} {item.get('summary', '')}".lower()
        if lane and item.get("lane") == lane and _contains_any(blob, needles):
            out.append(item)
        elif not require_lane and _contains_any(blob, needles):
            out.append(item)
    return out


def _public_item(item: dict) -> dict:
    return {
        "title": item.get("title") or "",
        "source": item.get("source") or item.get("feed") or "",
        "feed": item.get("feed") or "",
        "lane": item.get("lane") or "",
        "link": item.get("link") or "",
        "published": item.get("published"),
        "summary": item.get("summary") or "",
        "score": item.get("score", 0),
    }


def build_daily_briefing(show_date: date, *, now: datetime | None = None) -> dict:
    now = now or datetime.now(TZ)
    fetched = []
    sources = []
    for spec in _feed_specs(show_date):
        try:
            xml_text = _fetch_text(spec.url)
            entries = _parse_feed(xml_text, spec)
            fetched.extend(entries)
            sources.append({"name": spec.name, "url": spec.url, "ok": True, "items": len(entries)})
        except error.HTTPError as exc:
            sources.append({"name": spec.name, "url": spec.url, "ok": False, "error": f"HTTP {exc.code}", "items": 0})
        except Exception as exc:
            sources.append({"name": spec.name, "url": spec.url, "ok": False, "error": f"{type(exc).__name__}: {exc}", "items": 0})

    ranked = _dedupe_rank(fetched, now)
    incoming = _dedupe_rank(_filter_lane(ranked, INCOMING_KEYWORDS, lane="incoming", require_lane=True), now)
    ai = _dedupe_rank(_filter_lane(ranked, AI_KEYWORDS, lane="ai"), now)
    macro = _dedupe_rank(_filter_lane(ranked, MACRO_KEYWORDS, lane="macro"), now)
    earnings = _dedupe_rank(_filter_lane(ranked, EARNINGS_KEYWORDS), now)

    past = ranked[:12]
    watch = incoming[:8] or ranked[:8]
    movers = earnings[:8] or ranked[:8]
    ok_sources = [s for s in sources if s.get("ok")]
    return {
        "showDate": show_date.isoformat(),
        "fetchedAt": now.isoformat(),
        "sourceLine": f"{len(ranked)} ranked items from {len(ok_sources)} live RSS/search feeds",
        "sources": sources,
        "itemCount": len(ranked),
        "pastDayHeadlines": [_public_item(item) for item in past],
        "incomingDayWatchlist": [_public_item(item) for item in watch],
        "aiAndTech": [_public_item(item) for item in ai[:8]],
        "macroAndRates": [_public_item(item) for item in macro[:8]],
        "earningsAndMovers": [_public_item(item) for item in movers],
        "marketMovers": [format_item_for_script(item) for item in movers[:6]],
    }


def format_item_for_script(item: dict) -> str:
    title = _clean_text(item.get("title") or "")
    source = _clean_text(item.get("source") or item.get("feed") or "feed")
    published = item.get("published")
    when = ""
    if published:
        try:
            dt = datetime.fromisoformat(published)
            when = f", {dt.strftime('%b %d %I:%M %p')}"
        except ValueError:
            when = ""
    return f"{title} ({source}{when})."


def format_items_for_script(items: list[dict], *, limit: int = 4, fallback: str) -> str:
    usable = [format_item_for_script(item) for item in items[:limit] if item.get("title")]
    if not usable:
        return fallback
    return " ".join(usable)
