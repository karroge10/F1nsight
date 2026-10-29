from f1p.official_results import parse_lap_time, parse_table


def test_parse_table_extracts_header_and_nested_cell_text():
    html = """
    <div id="results-table"><div><table><thead><tr><th>Pos.</th><th>Driver</th></tr></thead>
    <tbody><tr><td>1</td><td><span>Kimi</span>&nbsp;<span>Antonelli ANT</span></td></tr></tbody>
    </table></div></div>
    """

    headers, rows = parse_table(html)

    assert headers == ["pos.", "driver"]
    assert rows == [["1", "Kimi Antonelli ANT"]]


def test_parse_table_rejects_missing_results_table():
    try:
        parse_table("<html><body>No table</body></html>")
    except ValueError as exc:
        assert str(exc) == "Formula 1 results table was not found"
    else:
        raise AssertionError("Expected missing results table to fail")


def test_parse_lap_time_supports_lap_and_race_times():
    assert parse_lap_time("1:35.390") == 95390
    assert parse_lap_time("1:35:16.650") == 5716650
    assert parse_lap_time("") is None
