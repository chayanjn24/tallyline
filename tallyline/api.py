"""HTTP API (FastAPI) and the static front end. Every endpoint is a read-only GET."""

from __future__ import annotations

import threading
import time
from contextlib import asynccontextmanager, closing

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import anomalies, config, queries
from .dims import Dims
from .scope import LEVELS, Scope, ScopeError
from .warehouse import Warehouse


class TTLCache:
    """Tiny thread-safe cache for the slower endpoints (anomaly scans take ~1 s)."""

    def __init__(self, size: int = 64):
        self.size, self.data, self.lock = size, {}, threading.Lock()

    def get(self, key, ttl: float, make):
        now = time.monotonic()
        with self.lock:
            hit = self.data.get(key)
            if hit and now - hit[0] < ttl:
                return hit[1]
        value = make()
        with self.lock:
            if len(self.data) >= self.size:
                self.data.pop(next(iter(self.data)))
            self.data[key] = (now, value)
        return value


def create_app(wh: Warehouse | None = None) -> FastAPI:
    state = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state["wh"] = wh or Warehouse()
        state["dims"] = Dims(state["wh"].cat)
        yield
        if wh is None:
            state["wh"].close()

    app = FastAPI(
        title="Tallyline",
        version="1.0.0",
        lifespan=lifespan,
        description="Read-only analytics API over a synthetic ad exchange.",
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    @app.middleware("http")
    async def revalidate_assets(request: Request, call_next):
        # the front end is plain ES modules with no hashed file names: make browsers revalidate
        # (a cheap 304 via ETag) so a deploy is picked up on the next load
        response = await call_next(request)
        if not request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-cache")
        return response

    cache = TTLCache()

    @app.exception_handler(ScopeError)
    async def bad_scope(_: Request, e: ScopeError):
        return JSONResponse({"error": str(e)}, status_code=400)

    @app.exception_handler(RequestValidationError)
    async def bad_params(_: Request, e: RequestValidationError):
        err = e.errors()[0] if e.errors() else {}
        where = ".".join(str(x) for x in err.get("loc", [])[1:]) or "request"
        return JSONResponse({"error": f"{where}: {err.get('msg', 'invalid value')}"}, status_code=400)

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, e: HTTPException):
        return JSONResponse({"error": e.detail}, status_code=e.status_code)

    def scope_of(request: Request, cur) -> Scope:
        live_ts, _ = state["wh"].live()
        sc = Scope.parse(request.query_params, today=live_ts.date())
        first = state["wh"].first_ts().date()
        if sc.end < first or sc.start > live_ts.date():
            raise ScopeError(f"data covers {first} to {live_ts.date()} (UTC)")
        return sc.bind(live_ts)

    # ------------------------------------------------------------------ endpoints
    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    @app.get("/api/meta")
    def meta():
        wh = state["wh"]
        live_ts, frac = wh.live()
        return {
            "name": "Tallyline",
            "tz": "UTC",
            "seed": wh.seed,
            "latestUtc": queries.label(live_ts),
            "liveShare": round(frac, 3),
            "firstDay": str(wh.first_ts().date()),
            "today": str(live_ts.date()),
            "maxRangeDays": config.MAX_RANGE_DAYS,
            "maxFilterValues": config.MAX_FILTER_VALUES,
        }

    @app.get("/api/summary")
    def summary(request: Request):
        with closing(state["wh"].cursor()) as cur:
            return queries.summary(cur, scope_of(request, cur))

    @app.get("/api/breakdown")
    def breakdown(request: Request, dim: str = Query(..., pattern="^(" + "|".join(queries.DIMS) + ")$")):
        with closing(state["wh"].cursor()) as cur:
            return queries.breakdown(cur, scope_of(request, cur), dim, state["dims"])

    @app.get("/api/options")
    def options(request: Request, level: str = Query(..., pattern="^(" + "|".join(LEVELS) + ")$")):
        with closing(state["wh"].cursor()) as cur:
            return queries.options(cur, scope_of(request, cur), level, state["dims"])

    @app.get("/api/deal-apps/counts")
    def deal_app_counts(request: Request):
        with closing(state["wh"].cursor()) as cur:
            return queries.deal_app_counts(cur, scope_of(request, cur))

    @app.get("/api/deal-apps")
    def deal_apps(request: Request, deal: int):
        with closing(state["wh"].cursor()) as cur:
            return queries.deal_apps(cur, scope_of(request, cur), deal, state["dims"])

    @app.get("/api/anomalies")
    def anomaly_list(request: Request):
        wh = state["wh"]
        with closing(wh.cursor()) as cur:
            sc = scope_of(request, cur)
            # results only use completed hours, so they hold until the clock enters a new hour
            key = ("anomalies", str(request.query_params), sc.live_ts)
            alerts = cache.get(key, 3600, lambda: anomalies.detect(cur, sc, state["dims"], wh.first_ts()))
        s0, s1 = sc.cur
        return {
            "from": queries.label(s0),
            "to": queries.label(min(s1, sc.live_ts)),
            "alerts": alerts,
            "baselineWeeks": anomalies.BASELINE_DAYS // 7,
            "z": anomalies.Z,
        }

    @app.get("/api/anomalies/scorecard")
    def scorecard(request: Request):
        wh = state["wh"]
        with closing(wh.cursor()) as cur:
            sc = scope_of(request, cur)
            key = ("scorecard", str(sc.start), str(sc.end), sc.live_ts)
            return cache.get(key, 3600, lambda: anomalies.scorecard(cur, sc, state["dims"], wh.first_ts()))

    # the front end: index.html at /, report.html at /report.html, assets under /css and /js
    app.mount("/", StaticFiles(directory=config.WEB_DIR, html=True), name="web")
    return app


app = create_app()
