"""Map F1 Fantasy assets onto Ergast-style ids (driverId, constructorId) per season.

Drivers match on the three letter code plus surname against the season roster in
data/processed/season_entries.parquet and drivers.parquet (written by f1p.history).
Constructors match through an alias table of fantasy team names, restricted to the
constructorIds present in that season.
"""

import unicodedata

import pandas as pd

from f1p.paths import processed_path

TEAM_ALIASES = {
    "red bull racing": ["red_bull"],
    "red bull": ["red_bull"],
    "ferrari": ["ferrari"],
    "mercedes": ["mercedes"],
    "mclaren": ["mclaren"],
    "aston martin": ["aston_martin"],
    "alpine": ["alpine"],
    "williams": ["williams"],
    "haas f1 team": ["haas"],
    "haas": ["haas"],
    "racing bulls": ["rb", "alphatauri"],
    "rb": ["rb", "alphatauri"],
    "visa cash app rb": ["rb"],
    "alphatauri": ["alphatauri"],
    "kick sauber": ["sauber", "alfa"],
    "sauber": ["sauber", "alfa"],
    "alfa romeo": ["alfa"],
    "audi": ["audi", "sauber"],
    "cadillac": ["cadillac"],
}


def season_roster(season: int) -> pd.DataFrame:
    """driverId, constructorId, code, familyName for every driver entered in a season."""
    entries_path = processed_path("season_entries")
    drivers_path = processed_path("drivers")
    entries = pd.read_parquet(entries_path)
    drivers = pd.read_parquet(drivers_path)
    entries = entries[entries["season"] == season]
    columns = ["driverId", "code", "givenName", "familyName"]
    roster = entries.merge(drivers[columns], on="driverId", how="left")
    roster["surnameKey"] = roster["familyName"].map(_key)
    roster["givenKey"] = roster["givenName"].map(_key)
    return roster


def season_constructors(season: int) -> set[str]:
    entries_path = processed_path("season_entries")
    entries = pd.read_parquet(entries_path)
    in_season = entries[entries["season"] == season]
    return set(in_season["constructorId"])


def match_driver(roster: pd.DataFrame, code: str, name: str) -> tuple[str | None, str]:
    """Return (driverId, method). name may be 'M. Verstappen' or 'Max Verstappen'."""
    last_name = name.split(" ", 1)[-1] if name else ""
    surname = _key(last_name)
    by_code = roster[roster["code"] == code]
    both = by_code[by_code["surnameKey"] == surname]
    if len(both) >= 1:
        return both["driverId"].iloc[0], "code+surname"
    by_surname = roster[roster["surnameKey"] == surname]
    if len(by_surname) == 1:
        return by_surname["driverId"].iloc[0], "surname"
    if len(by_code) == 1:
        return by_code["driverId"].iloc[0], "code"
    name_words = {_key(word) for word in str(name).replace(".", " ").split()}
    surname_hit = roster["surnameKey"].isin(name_words)
    given_hit = roster["givenKey"].isin(name_words)
    by_any_word = roster[surname_hit | given_hit]
    if len(by_any_word) == 1:
        return by_any_word["driverId"].iloc[0], "name word"
    return None, "unmatched"


def match_constructor(season_ids: set[str], team_name: str) -> tuple[str | None, str]:
    team_key = _key(team_name)
    candidates = TEAM_ALIASES.get(team_key, [])
    for candidate in candidates:
        if candidate in season_ids:
            return candidate, "alias"
    return None, "unmatched"


def _key(text: str) -> str:
    """Lowercase, accent free, single spaced."""
    if text is None:
        return ""
    normalized = unicodedata.normalize("NFKD", str(text))
    ascii_text = normalized.encode("ascii", "ignore").decode()
    return " ".join(ascii_text.lower().split())
