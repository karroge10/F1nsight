import pandas as pd

from f1p.history.corrections import apply_driver_fixes


def test_fills_substitute_metadata_without_overwriting_the_source():
    drivers = pd.DataFrame({
        "driverId": ["rafael_camara", "ryo_hirakawa", "norris"],
        "code": [None, "HIR", "NOR"],
        "nationality": [None, "", "British"],
        "countryCode": [None, "JPN", "GBR"],
    })

    fixed = apply_driver_fixes(drivers).set_index("driverId")

    assert fixed.loc["rafael_camara", "code"] == "CAM"
    assert fixed.loc["rafael_camara", "countryCode"] == "BRA"
    assert fixed.loc["ryo_hirakawa", "nationality"] == "Japanese"
    assert fixed.loc["norris", "code"] == "NOR"
