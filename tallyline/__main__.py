"""Command line: `python -m tallyline serve` (default) or `python -m tallyline build`."""

import argparse
import time

from . import config


def main() -> None:
    ap = argparse.ArgumentParser(prog="tallyline", description="Synthetic ad-exchange analytics.")
    ap.add_argument(
        "command",
        nargs="?",
        default="serve",
        choices=["serve", "build"],
        help="serve: run the web app (default). build: generate the warehouse and exit.",
    )
    ap.add_argument("--host", default=config.HOST)
    ap.add_argument("--port", type=int, default=config.PORT)
    args = ap.parse_args()

    if args.command == "build":
        from .warehouse import Warehouse

        t = time.time()
        wh = Warehouse()
        rows = wh.con.execute("SELECT count(*) FROM fact_delivery_app").fetchone()[0]
        wh.con.execute("CHECKPOINT")
        wh.close()
        print(f"warehouse ready at {config.DB_PATH}: {rows:,} delivery rows in {time.time() - t:.1f}s")
        return

    import uvicorn

    uvicorn.run("tallyline.api:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
