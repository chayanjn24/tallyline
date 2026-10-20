"""What a request is asking about: a date range, its comparison window, and filters.

Comparison rule: while the range is still running, both sides are cut at the start of the live
hour, so "today so far" is compared with "yesterday up to the same hour". The live hour itself is
never part of a delta.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from . import config

LEVELS = ("dp", "ds", "deal", "pub", "plc", "app")
COLUMN = {"dp": "dp_id", "ds": "ds_id", "deal": "deal_id", "pub": "pub_id", "plc": "plc_id", "app": "app_id"}
DEMAND_SIDE = {"dp", "ds", "deal"}
SUPPLY_SIDE = {"pub", "plc", "app"}
DAY = timedelta(days=1)


class ScopeError(ValueError):
    """Bad request parameters (turned into HTTP 400)."""


def _date(s: str | None, name: str) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError as e:
        raise ScopeError(f"{name} must be YYYY-MM-DD") from e


def _ids(raw: list[str]) -> list[int]:
    out = []
    for part in raw:
        for x in str(part).split(","):
            x = x.strip()
            if not x:
                continue
            if not x.isdigit():
                raise ScopeError(f"ids must be numbers, got {x!r}")
            out.append(int(x))
    if len(out) > config.MAX_FILTER_VALUES:
        raise ScopeError(f"at most {config.MAX_FILTER_VALUES} values per filter")
    return sorted(set(out))


def _midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day)


@dataclass
class Scope:
    start: date
    end: date
    pstart: date
    pend: date
    filters: dict[str, list[int]] = field(default_factory=dict)
    live_ts: datetime | None = None  # set by bind()

    # ---- construction
    @classmethod
    def parse(cls, q, today: date) -> Scope:
        """q: a mapping with getlist (Starlette QueryParams)."""
        start = _date(q.get("start"), "start") or today
        end = _date(q.get("end"), "end") or start
        if end < start:
            start, end = end, start
        n = (end - start).days + 1
        if n > config.MAX_RANGE_DAYS:
            raise ScopeError(f"the range can be at most {config.MAX_RANGE_DAYS} days")
        pstart, pend = _date(q.get("pstart"), "pstart"), _date(q.get("pend"), "pend")
        if not (pstart and pend):
            pstart, pend = start - n * DAY, start - DAY
        if pend < pstart:
            pstart, pend = pend, pstart
        if (pend - pstart).days + 1 > config.MAX_RANGE_DAYS:
            raise ScopeError(f"the comparison range can be at most {config.MAX_RANGE_DAYS} days")
        filters = {lv: _ids(q.getlist(lv)) for lv in LEVELS}
        return cls(start, end, pstart, pend, {k: v for k, v in filters.items() if v})

    def bind(self, live_ts: datetime) -> Scope:
        self.live_ts = live_ts
        return self

    # ---- windows (half-open [a, b) in naive UTC)
    @property
    def cur(self) -> tuple[datetime, datetime]:
        return _midnight(self.start), _midnight(self.end) + DAY

    @property
    def prev(self) -> tuple[datetime, datetime]:
        return _midnight(self.pstart), _midnight(self.pend) + DAY

    @property
    def running(self) -> bool:
        a, b = self.cur
        return self.live_ts is not None and a <= self.live_ts < b

    @property
    def cut(self) -> datetime:
        """End of the completed part of the current window."""
        return self.live_ts if self.running else self.cur[1]

    @property
    def pcut(self) -> datetime:
        """The comparison window, cut at the same offset as the current one."""
        p0, p1 = self.prev
        return min(p1, p0 + (self.cut - self.cur[0])) if self.running else p1

    def params(self) -> dict:
        (c0, c1), (p0, p1) = self.cur, self.prev
        return {
            "c0": c0,
            "c1": c1,
            "cut": self.cut,
            "p0": p0,
            "p1": p1,
            "pcut": self.pcut,
            **{lv: ids for lv, ids in self.filters.items()},
        }

    # ---- filters
    @property
    def demand_filtered(self) -> bool:
        return any(lv in self.filters for lv in DEMAND_SIDE)

    @property
    def needs_app_grain(self) -> bool:
        return "app" in self.filters

    def where(self, side: str = "delivery", skip: str | None = None) -> str:
        """AND-joined filter predicates. Values are bound as $dp, $ds, … (never pasted into SQL)."""
        levels = LEVELS if side == "delivery" else SUPPLY_SIDE
        parts = [
            f"{COLUMN[lv]} IN (SELECT unnest(${lv}))"
            for lv in LEVELS
            if lv in self.filters and lv in levels and lv != skip
        ]
        return "".join(f" AND {p}" for p in parts)

    def without(self, level: str) -> Scope:
        f = {k: v for k, v in self.filters.items() if k != level}
        return Scope(self.start, self.end, self.pstart, self.pend, f, self.live_ts)

    def only(self, level: str, entity_id: int) -> Scope:
        f = {**self.filters, level: [entity_id]}
        return Scope(self.start, self.end, self.pstart, self.pend, f, self.live_ts)
