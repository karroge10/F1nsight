"""`uv run python -m f1live [--simulate 2026:16:R] [--sim-speed 4] [--sim-start -120] [--sim-anonymous]`."""

import argparse
import logging

import uvicorn

from f1live import config
from f1live.app import create_app
from f1live.hub import SimulationOptions


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    simulation = None
    if args.simulate:
        simulation = parse_simulation(args.simulate, args.sim_speed, args.sim_start, args.sim_anonymous)
    app = create_app(simulation)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="f1live", description="F1 live timing and replay relay")
    parser.add_argument("--host", default=config.HOST)
    parser.add_argument("--port", type=int, default=config.PORT)
    parser.add_argument(
        "--simulate",
        metavar="SEASON:ROUND:SESSION",
        help="serve /ws/live from a recorded session fed through the live parser, e.g. 2026:16:R",
    )
    parser.add_argument("--sim-speed", type=float, default=1.0, help="simulation speed multiplier")
    parser.add_argument(
        "--sim-start",
        type=float,
        default=-120,
        help="start offset in seconds relative to the green light (negative = before)",
    )
    parser.add_argument(
        "--sim-anonymous",
        action="store_true",
        help="drop car positions and car data from the simulation (like live without a token)",
    )
    return parser.parse_args()


def parse_simulation(spec: str, speed: float, start_seconds: float, anonymous: bool = False) -> SimulationOptions:
    season, round_number, session = spec.split(":")
    start_ms = int(start_seconds * 1000)
    return SimulationOptions(int(season), int(round_number), session.upper(), speed, start_ms, anonymous)


if __name__ == "__main__":
    main()
