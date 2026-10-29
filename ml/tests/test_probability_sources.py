from types import SimpleNamespace

import numpy as np
import pandas as pd

from f1ml import forecast, market
from f1ml.predict import probability_sources


def test_sources_keep_frame_order_and_preserve_unpooled_probabilities():
    result = SimpleNamespace(frame=pd.DataFrame({"driverId": ["b", "a"]}),
                             model_win=np.array([0.6, 0.4]), market_target=np.array([0.3, 0.7]),
                             stage="post-qualifying", summary={"pWin": np.array([0.31, 0.69])})
    prices = SimpleNamespace(probabilities=np.array([0.2, 0.8]))
    sources = probability_sources(result, prices)
    assert sources["model"] == {"b": 0.6, "a": 0.4}
    assert sources["market"] == {"b": 0.2, "a": 0.8}
    assert sources["published"] == {"b": 0.31, "a": 0.69}
    assert sources["modelSimulationCount"] == forecast.MARKET_FIT_SIMS
    assert sources["modelWeight"] == market.OURS_WEIGHT["post-qualifying"]


def test_without_market_the_model_is_the_published_distribution():
    result = SimpleNamespace(frame=pd.DataFrame({"driverId": ["a", "b"]}),
                             model_win=np.array([0.6, 0.4]), market_target=None,
                             stage="pre-weekend", summary={"pWin": np.array([0.6, 0.4])},
                             sims=SimpleNamespace(race=np.zeros((100, 2))))
    sources = probability_sources(result, None)
    assert sources["market"] is None
    assert sources["model"] == sources["published"]
    assert sources["modelWeight"] == 1
