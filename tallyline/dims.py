"""Entity names and attributes, held in memory (the dimensions are tiny).

attrs() returns the descriptive columns a table row shows next to its numbers: the parent
partner, the demand source a deal buys for, a deal's settings, an app's store id, and so on.
"""

from __future__ import annotations

from .catalog import FORMAT_LABEL, Catalog


class Dims:
    def __init__(self, cat: Catalog):
        rows = lambda t: [dict(zip(t, v, strict=True)) for v in zip(*t.values(), strict=True)]
        self.dp = {r["dp_id"]: r for r in rows(cat.demand_partners)}
        self.ds = {r["ds_id"]: r for r in rows(cat.demand_sources)}
        self.pub = {r["pub_id"]: r for r in rows(cat.publishers)}
        self.plc = {r["plc_id"]: r for r in rows(cat.placements)}
        self.app = {r["app_id"]: r for r in rows(cat.apps)}
        self.deal = {r["deal_id"]: r for r in rows(cat.deals)}
        self._by_level = {
            "dp": self.dp,
            "ds": self.ds,
            "deal": self.deal,
            "pub": self.pub,
            "plc": self.plc,
            "app": self.app,
        }

    def names(self, level: str) -> dict[int, str]:
        return {k: v["name"] for k, v in self._by_level[level].items()}

    def name(self, level: str, eid: int) -> str:
        r = self._by_level[level].get(eid)
        return r["name"] if r else f"#{eid}"

    def parent(self, level: str, eid: int) -> tuple[str, int] | None:
        """The level above in the hierarchy (demand source → partner, app/placement → publisher)."""
        r = self._by_level[level].get(eid)
        if not r:
            return None
        if level == "ds":
            return "dp", r["dp_id"]
        if level in ("app", "plc"):
            return "pub", r["pub_id"]
        return None

    def attrs(self, level: str, eid: int) -> dict:
        r = self._by_level[level].get(eid)
        if r is None:
            return {"name": f"#{eid}"}
        if level == "dp":
            return {"name": r["name"]}
        if level == "ds":
            return {
                "name": r["name"],
                "partner": self.dp[r["dp_id"]]["name"],
                "partnerId": r["dp_id"],
                "format": FORMAT_LABEL[r["format"]],
                "region": r["region"],
            }
        if level == "pub":
            return {"name": r["name"], "region": r["region"]}
        if level == "plc":
            return {
                "name": r["name"],
                "partner": self.pub[r["pub_id"]]["name"],
                "partnerId": r["pub_id"],
                "format": FORMAT_LABEL[r["format"]],
            }
        if level == "app":
            return {
                "name": r["name"],
                "bundle": r["bundle"],
                "partner": self.pub[r["pub_id"]]["name"],
                "partnerId": r["pub_id"],
            }
        # deal
        ds = self.ds[r["ds_id"]]
        target = self.app.get(r["target_app_id"])
        return {
            "name": r["name"],
            "demand": ds["name"],
            "demandId": r["ds_id"],
            "partner": self.dp[r["dp_id"]]["name"],
            "partnerId": r["dp_id"],
            "placement": self.plc[r["plc_id"]]["name"],
            "publisher": self.pub[r["pub_id"]]["name"],
            "format": FORMAT_LABEL[r["format"]],
            "target": target["bundle"] if target else None,
            "mode": r["setup"],
            "enabled": r["status"],
            "cfgMargin": r["margin_pct"],
            "cfgQps": r["qps_cap"] or -1,
        }
