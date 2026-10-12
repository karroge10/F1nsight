"""Grid penalties from the stewards' decision documents on fia.com.

The championship page lists every season's events; an event page lists its documents (title,
publish time, PDF link). Only documents whose title looks like a decision are downloaded, once:
PDFs and their extracted text are cached under data/raw/fia/<season>/<round>_<slug>/.

A decision document carries labelled fields ("No / Driver", "Session", "Decision", "Reason").
Only the Decision field is read for the penalty, so summonses (no Decision), "No further action",
reprimands, fines and time penalties never produce a grid penalty. A later document that says it
supersedes, replaces, corrects or withdraws "document N", or a corrected version with the same
title, drops the earlier one.
"""

from __future__ import annotations

import html
import re
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote
from zoneinfo import ZoneInfo

import httpx

BASE_URL = "https://www.fia.com"
CHAMPIONSHIP_PATH = "/documents/championships/fia-formula-one-world-championship-14"
USER_AGENT = "f1nsight-pipeline"
REQUEST_PAUSE_S = 1.0
MAX_ATTEMPTS = 3
SITE_TIMEZONE = ZoneInfo("Europe/Paris")
# Titles worth downloading: stewards' decisions and offences. Summonses never decide anything.
DECISION_TITLE = re.compile(r"decision|infringement|offen[cs]e|penalt|\bcars?\s+\d+", re.I)
SKIP_TITLE = re.compile(r"summons|starting grid|classification|scrutineering|entry list|"
                        r"competition notes|director'?s notes", re.I)
NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20,
}
PLACES_PATTERNS = (
    re.compile(r"drop(?:\s+of)?\s+(\w+)\s+(?:grid\s+)?(?:positions?|places?)"),
    re.compile(r"(\w+)[\s-]+(?:grid[\s-]+)?(?:place|position)s?[\s-]+(?:grid[\s-]+)?(?:penalty|drop)"),
)
BACK_OF_GRID = re.compile(r"back of the (?:starting )?grid")
PIT_LANE = re.compile(r"(?:start\w*\b[^.]{0,60}\bpit\s*lane|pit\s*lane\s+start)")
NEXT_EVENT = re.compile(r"next (?:race|competition|event)")
SUPERSEDE_WORDS = r"(?:supersed|replac|correct|amend|withdr[ae]w|revok|cancel|annul|rescind)\w*"
SUPERSEDES = (
    re.compile(SUPERSEDE_WORDS + r"[^.]{0,80}?\bdoc(?:ument)?s?\.?\s*(?:no\.?\s*)?(\d+)"),
    re.compile(r"\bdoc(?:ument)?s?\.?\s*(?:no\.?\s*)?(\d+)[^.]{0,40}?(?:is|are|has been|have been)\s+(?:hereby\s+)?"
               + SUPERSEDE_WORDS),
)
CORRECTED_TITLE = re.compile(r"\b(?:corrected|revised|amended|updated|v\d+)\b", re.I)


@dataclass
class Document:
    """One row of an event's document list."""

    number: int | None
    title: str
    url: str
    published_utc: str | None


@dataclass
class Decision:
    """A grid penalty read from one document (one per driver block)."""

    car_number: int
    driver_name: str
    kind: str  # places, back_of_grid or pit_lane
    places: int | None
    applies_to: str  # race or sprint
    category: str  # power_unit or other
    session: str
    next_event: bool
    document: Document
    decision_text: str
    supersedes: list[int] = field(default_factory=list)


def event_decisions(season: int, race_name: str, cache_dir: Path) -> list[Decision]:
    """Grid penalty decisions of one event, superseded documents removed (newest last)."""
    documents = event_documents(season, race_name)
    decisions = []
    superseded: set[int] = set()
    for document in documents:
        if not _worth_reading(document.title):
            continue
        text = document_text(document, cache_dir)
        references = superseded_numbers(text)
        superseded.update(references)
        parsed = parse_decisions(text, document)
        for decision in parsed:
            decision.supersedes = references
        decisions.extend(parsed)
    corrected = _corrected_titles(documents)
    superseded.update(corrected)
    return [decision for decision in decisions if decision.document.number not in superseded]


def event_documents(season: int, race_name: str) -> list[Document]:
    """Documents listed on the FIA event page, oldest first. Empty when the event has none yet."""
    url = event_url(season, race_name)
    if url is None:
        return []
    page = _get(url).text
    documents = parse_listing(page)
    return sorted(documents, key=lambda document: (document.number or 0, document.published_utc or ""))


def event_url(season: int, race_name: str) -> str | None:
    """The FIA documents page of one event, found by name in the season's event menu."""
    root_url = BASE_URL + CHAMPIONSHIP_PATH
    root = _get(root_url).text
    events = parse_event_menu(root, season)
    if not events:
        season_paths = re.findall(rf'value="([^"]*/season/season-{season}-\d+)"', root)
        if not season_paths:
            return None
        season_page_url = BASE_URL + season_paths[0]
        season_page = _get(season_page_url).text
        events = parse_event_menu(season_page, season)
    path = match_event(events, race_name)
    return None if path is None else BASE_URL + path


def parse_event_menu(page: str, season: int) -> dict[str, str]:
    """{event name: page path} for one season from the event dropdown."""
    pattern = rf'<option value="([^"]*/season/season-{season}-\d+/event/[^"]+)">([^<]+)'
    events = {}
    for path, name in re.findall(pattern, page):
        label = html.unescape(name).strip()
        events[label] = path
    return events


def match_event(events: dict[str, str], race_name: str) -> str | None:
    """Exact normalised name first, else the event sharing the most words with the race name."""
    wanted = _normalise(race_name)
    for name, path in events.items():
        if _normalise(name) == wanted:
            return path
    wanted_words = _name_words(race_name)
    best_path, best_overlap = None, 0
    for name, path in events.items():
        words = _name_words(name)
        overlap = len(words & wanted_words)
        if overlap > best_overlap:
            best_path, best_overlap = path, overlap
    return best_path


def parse_listing(page: str) -> list[Document]:
    """Document rows (number, title, url, publish time) of an event page.

    Rows are cut at each `<li class="document-row`; the markup inside a row differs between
    seasons (plain or nested field divs), so each part is located by its class name only.
    """
    chunks = re.split(r'<li class="document-row\b', page)[1:]
    documents = []
    for chunk in chunks:
        href_match = re.search(r'href="([^"]+\.pdf)"', chunk)
        title_match = re.search(r'class="title">(.*?)class="published"', chunk, re.S)
        if href_match is None or title_match is None:
            continue
        href = href_match.group(1)
        title_html = title_match.group(1).rsplit("<", 1)[0]
        title = _plain(title_html)
        published_html = chunk[title_match.end():]
        published = _plain(published_html)
        number_match = re.match(r"Doc\s+(\d+)\s*-\s*", title)
        number = int(number_match.group(1)) if number_match else None
        clean_title = title[number_match.end():] if number_match else title
        url = href if href.startswith("http") else BASE_URL + href
        published_utc = _published_utc(published)
        document = Document(number, clean_title, url, published_utc)
        documents.append(document)
    return documents


def document_text(document: Document, cache_dir: Path) -> str:
    """Text of a document's PDF, downloaded and extracted once, then read from the cache."""
    url_name = document.url.rsplit("/", 1)[-1]
    file_name = unquote(url_name)
    pdf_path = cache_dir / file_name
    text_path = pdf_path.with_suffix(".txt")
    if text_path.exists():
        return text_path.read_text(encoding="utf-8")
    cache_dir.mkdir(parents=True, exist_ok=True)
    if not pdf_path.exists():
        body = _get(document.url).content
        temp_path = pdf_path.with_suffix(".part")
        temp_path.write_bytes(body)
        temp_path.replace(pdf_path)
    text = pdf_text(pdf_path)
    text_path.write_text(text, encoding="utf-8")
    return text


def pdf_text(path: Path) -> str:
    """Plain text of every page, with odd spaces normalised."""
    from pypdf import PdfReader

    reader = PdfReader(path)
    pages = [page.extract_text() or "" for page in reader.pages]
    joined = "\n".join(pages)
    return normalise_text(joined)


def normalise_text(text: str) -> str:
    """NFKC, every kind of space to a plain space, runs of spaces collapsed per line."""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[  -​  　�]", " ", text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(lines)


def parse_decisions(text: str, document: Document) -> list[Decision]:
    """Grid penalties in a decision document: one per "No / Driver" block that has one."""
    decisions = []
    for block in _driver_blocks(text):
        driver = re.search(r"No\s*/\s*Driver\s+(\d+)\s*-\s*([^\n]+)", block)
        decision_text = _field(block, "Decision", ("Reason",))
        if driver is None or not decision_text:
            continue
        penalty = classify_decision(decision_text)
        if penalty is None:
            continue
        kind, places = penalty
        session = _field(block, "Session", ("Fact", "Infringement", "Decision", "Reason")) or ""
        applies_to = applies_to_session(decision_text, session)
        is_pu = re.search(r"\bpu\b|power unit", document.title, re.I) is not None
        category = "power_unit" if is_pu else "other"
        lowered = decision_text.lower()
        next_event = NEXT_EVENT.search(lowered) is not None
        decisions.append(Decision(int(driver.group(1)), driver.group(2).strip(), kind, places,
                                  applies_to, category, session.strip(), next_event, document,
                                  decision_text))
    return decisions


def classify_decision(decision_text: str) -> tuple[str, int | None] | None:
    """(kind, places) of a grid penalty in a Decision field, or None when it has none."""
    lowered = decision_text.lower()
    text = re.sub(r"\s+", " ", lowered)
    if "suspended" in text:
        return None
    if PIT_LANE.search(text):
        return "pit_lane", None
    if BACK_OF_GRID.search(text):
        return "back_of_grid", None
    for pattern in PLACES_PATTERNS:
        for match in pattern.finditer(text):
            token = match.group(1)
            places = _number(token)
            if places:
                return "places", places
    return None


def applies_to_session(decision_text: str, session: str) -> str:
    """"sprint" when the decision names the Sprint (or, unnamed, came from sprint qualifying)."""
    text = decision_text.lower()
    without_sq = re.sub(r"sprint (?:qualifying|shootout)", "", text)
    if re.search(r"\bsprint\b", without_sq):
        return "sprint"
    if re.search(r"\b(?:race|grand prix)\b", text):
        return "race"
    if re.search(r"sprint (?:qualifying|shootout)", session.lower()):
        return "sprint"
    return "race"


def superseded_numbers(text: str) -> list[int]:
    """Document numbers a document says it supersedes, replaces, corrects or withdraws."""
    lowercase = text.lower()
    lowered = re.sub(r"\s+", " ", lowercase)
    numbers = set()
    for pattern in SUPERSEDES:
        for match in pattern.finditer(lowered):
            numbers.add(int(match.group(1)))
    return sorted(numbers)


# ----------------------------------------------------------------------------------------------
# helpers


_last_request = 0.0
_client: httpx.Client | None = None


def _get(url: str) -> httpx.Response:
    """Polite GET: one request per REQUEST_PAUSE_S, retries on network errors and 5xx."""
    global _last_request
    client = _get_client()
    for attempt in range(MAX_ATTEMPTS):
        wait = REQUEST_PAUSE_S - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        try:
            response = client.get(url)
        except httpx.HTTPError:
            if attempt == MAX_ATTEMPTS - 1:
                raise
            time.sleep(2 ** (attempt + 1))
            continue
        if response.status_code >= 500 and attempt < MAX_ATTEMPTS - 1:
            time.sleep(2 ** (attempt + 1))
            continue
        response.raise_for_status()
        return response
    raise RuntimeError(f"giving up on {url}")


def _get_client() -> httpx.Client:
    global _client
    if _client is None:
        headers = {"User-Agent": USER_AGENT}
        _client = httpx.Client(headers=headers, timeout=60, follow_redirects=True)
    return _client


def _worth_reading(title: str) -> bool:
    return DECISION_TITLE.search(title) is not None and SKIP_TITLE.search(title) is None


def _driver_blocks(text: str) -> list[str]:
    """Split a document at each "No / Driver" field; the header stays with the first block."""
    starts = [match.start() for match in re.finditer(r"No\s*/\s*Driver\s", text)]
    if len(starts) <= 1:
        return [text]
    ends = starts[1:] + [len(text)]
    return [text[start:end] for start, end in zip(starts, ends)]


def _field(block: str, label: str, next_labels: tuple[str, ...]) -> str | None:
    """Text of a labelled field: from "<label>" at a line start to the next known label."""
    stops = "|".join(next_labels)
    pattern = rf"(?:^|\n){label}\s+(.*?)(?=\n(?:{stops})\b|\Z)"
    match = re.search(pattern, block, re.S)
    if match is None:
        return None
    return match.group(1).strip()


def _number(token: str) -> int | None:
    if token.isdigit():
        return int(token)
    return NUMBER_WORDS.get(token)


def _corrected_titles(documents: list[Document]) -> set[int]:
    """Earlier documents replaced by a later "corrected / revised / v2" one with the same title."""
    superseded = set()
    for index, later in enumerate(documents):
        if not CORRECTED_TITLE.search(later.title):
            continue
        key = _title_key(later.title)
        for earlier in documents[:index]:
            if earlier.number is not None and _title_key(earlier.title) == key:
                superseded.add(earlier.number)
    return superseded


def _title_key(title: str) -> str:
    without = CORRECTED_TITLE.sub("", title)
    return _normalise(without)


def _published_utc(text: str) -> str | None:
    match = re.search(r"(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})", text)
    if match is None:
        return None
    day, month, year, hour, minute = (int(part) for part in match.groups())
    local = datetime(2000 + year, month, day, hour, minute, tzinfo=SITE_TIMEZONE)
    utc = local.astimezone(timezone.utc)
    return utc.isoformat(timespec="minutes")


def _plain(fragment: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", fragment)
    unescaped = html.unescape(without_tags)
    return re.sub(r"\s+", " ", unescaped).strip()


def _normalise(name: str) -> str:
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_only = "".join(char for char in decomposed if not unicodedata.combining(char))
    lowered = ascii_only.lower()
    return re.sub(r"[^a-z0-9]", "", lowered)


def _name_words(name: str) -> set[str]:
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_only = "".join(char for char in decomposed if not unicodedata.combining(char))
    words = set(re.findall(r"[a-z0-9]+", ascii_only.lower()))
    return words - {"grand", "prix", "gp", "formula", "1", "of", "the"}
