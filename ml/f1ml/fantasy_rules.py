"""Import the F1 Fantasy rule code from the pipeline package (single source of truth).

`v2/pipeline/src/f1p/fantasy/scoring.py` and `price_change.py` are pure Python with no
dependencies, so they are imported directly from the pipeline source tree instead of being
re-derived here.
"""

from __future__ import annotations

import sys

from f1ml import paths

_pipeline_src = str(paths.PIPELINE_SRC)
if _pipeline_src not in sys.path:
    sys.path.insert(0, _pipeline_src)

from f1p.fantasy import price_change as price_rules  # noqa: E402
from f1p.fantasy import scoring  # noqa: E402

__all__ = ["scoring", "price_rules"]
