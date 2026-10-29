import numpy as np

from f1ml import market


def test_screenshot_market_is_rejected_instead_of_overriding_model(monkeypatch):
    names = {"max_verstappen": "Max Verstappen", "hulkenberg": "Nico Hulkenberg", "hamilton": "Lewis Hamilton", "piastri": "Oscar Piastri"}
    quotes = [
        ("Max Verstappen", 0.37, 0.32, 0.42),
        ("Nico Hulkenberg", 0.25, None, 0.5),
        ("Lewis Hamilton", 0.05, 0.02, 0.08),
        ("Oscar Piastri", 0.015, None, 0.03),
    ]
    event = {"slug": "f1-mexican-grand-prix-winner-2026-11-01", "volume": 136.024139,
             "markets": [{"groupItemTitle": name, "outcomes": ["Yes", "No"], "outcomePrices": [price, 1 - price], "bestBid": bid, "bestAsk": ask} for name, price, bid, ask in quotes]}
    monkeypatch.setattr(market, "_find_event", lambda *args: event)
    result = market.winner_prices(202619, "Mexico City Grand Prix", "2026-11-01", list(names), names, archive=False)
    assert result is None


def test_tight_quotes_keep_driver_identity_and_normalize(monkeypatch):
    names = {"a": "Driver Alpha", "b": "Driver Beta"}
    event = {"slug": "race", "volume": 20000, "markets": [
        {"groupItemTitle": "Driver Beta", "outcomes": ["Yes", "No"], "outcomePrices": [0.3, 0.7], "bestBid": 0.29, "bestAsk": 0.31},
        {"groupItemTitle": "Driver Alpha", "outcomes": ["No", "Yes"], "outcomePrices": [0.3, 0.7], "bestBid": 0.69, "bestAsk": 0.71},
    ]}
    monkeypatch.setattr(market, "_find_event", lambda *args: event)
    result = market.winner_prices(202619, "Race", "2026-11-01", list(names), names, archive=False)
    assert result is not None
    np.testing.assert_allclose(result.probabilities, [0.7, 0.3])


def test_missing_or_invalid_quotes_are_not_prices():
    base = {"outcomes": ["Yes", "No"], "outcomePrices": [0.5, 0.5]}
    assert market._yes_price(base) is None
    assert market._yes_price(dict(base, bestBid=0.6, bestAsk=0.4)) is None
    assert market._yes_price(dict(base, bestBid=float("nan"), bestAsk=0.6)) is None


def test_completing_field_does_not_inflate_priced_driver_count():
    prices = {0: 0.4, 1: 0.3, 2: 0.2, 3: 0.09}
    result = market._complete_field(prices, 0.01, 5)
    assert result is not None
    assert len(prices) == 4
    np.testing.assert_allclose(result, [0.4, 0.3, 0.2, 0.09, 0.01])
