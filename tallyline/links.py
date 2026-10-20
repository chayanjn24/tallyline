"""How strongly two entities are connected: the share of A's normal traffic that flows through B.

Example: if 62% of a publisher's revenue comes from one demand source, an outage at that source
explains a revenue drop at the publisher. The anomaly detector uses this to group knock-on
alerts under their root cause.

Shares are measured from the data, using the baseline weeks before the scan window: one
query builds the traffic matrix (demand partner × demand source × publisher × app).
"""

from __future__ import annotations

from datetime import datetime

from .queries import run

SIDE = {"dp": "demand", "ds": "demand", "pub": "supply", "app": "supply"}
COL = {"dp": "dp_id", "ds": "ds_id", "pub": "pub_id", "app": "app_id"}


class Links:
    def __init__(self, rows: list[dict]):
        self.rows = rows

    @classmethod
    def measure(cls, cur, h0: datetime, h1: datetime) -> Links:
        rows = run(
            cur,
            """
            SELECT dp_id, ds_id, pub_id, app_id, sum(rev) AS rev, sum(req) AS req
            FROM delivery_app WHERE ts >= $h0 AND ts < $h1
            GROUP BY ALL""",
            {"h0": h0, "h1": h1},
        )
        return cls(rows)

    def share(self, a: tuple[str, int], b: tuple[str, int], metric: str = "rev") -> float:
        """Share of A's `metric` (rev or req) that also involves B."""
        ca, cb = COL[a[0]], COL[b[0]]
        total = both = 0.0
        for r in self.rows:
            if r[ca] == a[1]:
                v = r[metric] or 0.0
                total += v
                if r[cb] == b[1]:
                    both += v
        return both / total if total else 0.0
