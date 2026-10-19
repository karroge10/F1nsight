import json
import subprocess
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

ML_DIR = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize(
    ("trained_through", "decision", "expected"),
    [
        (202617, None, "not due: the model is up to date (trained through 202617)"),
        (202616, None, "due"),
        (202616, "rejected", "not due: already ran for 202617 on yesterday (rejected)"),
        (202616, "error", "due"),
    ],
)
def test_due_check_reads_parquet_and_exits_cleanly(tmp_path, trained_through, decision, expected):
    processed = tmp_path / "processed"
    model = tmp_path / "models" / "current"
    processed.mkdir()
    model.mkdir(parents=True)
    table = pa.table({"raceId": [202617, None, 202615, 202616, 202617],
                      "driverId": [1, 2, 3, 4, 5]})
    pq.write_table(table, processed / "results.parquet", row_group_size=2)
    (model.parent / "latest.json").write_text(json.dumps({"path": str(model)}), encoding="utf-8")
    (model / "meta.json").write_text(json.dumps({"trainedThroughRaceId": trained_through}), encoding="utf-8")
    report = tmp_path / "retrain_gate.json"
    report.write_text(json.dumps({"decision": decision, "resultsThroughRaceId": 202617,
                                  "finishedAt": "yesterday"}), encoding="utf-8")
    command = "\n".join([
        "import sys",
        "from pathlib import Path",
        "from scripts import retrain_if_better as gate",
        "root = Path(sys.argv[1])",
        "gate.paths.PROCESSED_DIR = root / 'processed'",
        "gate.paths.MODELS_DIR = root / 'models'",
        "gate.GATE_REPORT = root / 'retrain_gate.json'",
        "gate.LOGS_DIR = root / 'logs'",
        "sys.argv = ['retrain_if_better.py', '--check-due']",
        "raise SystemExit(gate.main())",
    ])
    result = subprocess.run([sys.executable, "-c", command, str(tmp_path)], cwd=ML_DIR,
                            capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == expected
    assert result.stderr == ""
