"""Merging of the feed's partial updates into a full state.

The feed sends the full object once and then sparse deltas. Lists are first sent as JSON arrays
and later patched with objects keyed by the list index (`{"Sectors": {"1": {...}}}`).
A `_deleted` key lists child keys to remove. Values from the delta are always copied, so a
message can be applied again later (replay seeks re-apply the same message objects).
"""

from typing import Any

DELETED_KEY = "_deleted"


def deep_merge(target: dict, delta: dict) -> dict:
    """Apply `delta` onto `target` in place and return `target`."""
    for key, value in delta.items():
        if key == DELETED_KEY:
            _delete_keys(target, value)
            continue
        current = target.get(key)
        if isinstance(value, dict) and isinstance(current, dict):
            deep_merge(current, value)
        elif isinstance(value, dict) and isinstance(current, list):
            merge_into_list(current, value)
        else:
            target[key] = clone(value)
    return target


def merge_into_list(target: list, delta: dict) -> list:
    """Patch a list with an index-keyed object, growing the list when an index is new."""
    for key, value in delta.items():
        if key == DELETED_KEY:
            continue
        index = int(key)
        while len(target) <= index:
            target.append({})
        current = target[index]
        if isinstance(value, dict) and isinstance(current, dict):
            deep_merge(current, value)
        elif isinstance(value, dict) and isinstance(current, list):
            merge_into_list(current, value)
        else:
            target[index] = clone(value)
    return target


def clone(value: Any) -> Any:
    """Copy JSON-like data so the state never aliases a message object."""
    if isinstance(value, dict):
        return {key: clone(item) for key, item in value.items() if key != DELETED_KEY}
    if isinstance(value, list):
        return [clone(item) for item in value]
    return value


def _delete_keys(target: dict, keys: Any) -> None:
    for key in keys if isinstance(keys, list) else [keys]:
        target.pop(str(key), None)
