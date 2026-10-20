"""The fictional marketplace: who buys, who sells, and how they are wired together.

Everything here is invented. Names are hand-picked; the wiring (which demand source buys which
placement, deal settings, app popularity) is drawn from a seeded RNG, so the same seed always
produces the same marketplace.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

FORMATS = ("display", "video", "native", "ctv")
FORMAT_LABEL = {"display": "Display", "video": "Video", "native": "Native", "ctv": "CTV"}

# typical clearing CPM ($ per 1,000 impressions) by format
BASE_CPM = {"display": 0.85, "video": 6.2, "native": 1.7, "ctv": 13.5}
# share of won auctions that render an impression
RENDER_RATE = {"display": 0.93, "video": 0.86, "native": 0.95, "ctv": 0.9}
# share of started video ads that play to the end
COMPLETION = {"video": 0.71, "ctv": 0.93}

# name, short code, formats it buys
DEMAND_PARTNERS = [
    ("Kestrel DSP", "KES", ("display", "video", "native")),
    ("Bluefinch Media", "BLF", ("video", "ctv")),
    ("Orchardly", "ORC", ("display", "native")),
    ("Polarbid", "POL", ("display", "video")),
    ("Halcyon Reach", "HAL", ("video", "ctv", "display")),
    ("Tidewater Demand", "TDW", ("display",)),
    ("Northvane", "NVN", ("native", "display", "video")),
    ("Copperleaf Ads", "CPL", ("display", "video")),
    ("Quillbid", "QLB", ("video",)),
    ("Sablepoint", "SBP", ("ctv", "video")),
    ("Brightmoor Digital", "BRM", ("display", "native")),
    ("Lumenpike", "LMP", ("display", "video", "ctv")),
]
REGIONS = (("US", "US"), ("EU", "EU"), ("APAC", "AP"), ("Global", "GL"))

# name, code, audience region (sets the daily peak), weekend lift, placements as (label, code, format)
PUBLISHERS = [
    (
        "Pinecone Games",
        "PNC",
        "US",
        1.12,
        [("Rewarded Video", "RWV", "video"), ("Interstitial", "INT", "display"), ("Banner", "BNR", "display")],
    ),
    (
        "Driftwood Studios",
        "DRW",
        "EU",
        1.10,
        [("Rewarded Video", "RWV", "video"), ("Banner", "BNR", "display"), ("Native Feed", "NTV", "native")],
    ),
    (
        "Arcadia Apps",
        "ARC",
        "US",
        1.05,
        [
            ("Interstitial", "INT", "display"),
            ("Rewarded Video", "RWV", "video"),
            ("Native Feed", "NTV", "native"),
            ("Banner", "BNR", "display"),
        ],
    ),
    (
        "Lantern Labs",
        "LNT",
        "APAC",
        1.08,
        [("Banner", "BNR", "display"), ("Interstitial", "INT", "display"), ("Rewarded Video", "RWV", "video")],
    ),
    (
        "Moss & Wren",
        "MSW",
        "EU",
        0.86,
        [("Native Feed", "NTV", "native"), ("In-Article Video", "IAV", "video"), ("Banner", "BNR", "display")],
    ),
    (
        "Riverstone Media",
        "RVS",
        "US",
        0.88,
        [("Pre-roll", "PRE", "video"), ("Native Feed", "NTV", "native"), ("Banner", "BNR", "display")],
    ),
    ("Tinybyte", "TNB", "APAC", 1.06, [("Interstitial", "INT", "display"), ("Rewarded Video", "RWV", "video")]),
    ("Glasshouse TV", "GLS", "US", 1.18, [("CTV Pre-roll", "CPR", "ctv"), ("CTV Mid-roll", "CMR", "ctv")]),
    (
        "Ember Mobile",
        "EMB",
        "EU",
        1.04,
        [("Banner", "BNR", "display"), ("Interstitial", "INT", "display"), ("Native Feed", "NTV", "native")],
    ),
    (
        "Foxglove Interactive",
        "FXG",
        "US",
        1.09,
        [("Rewarded Video", "RWV", "video"), ("Interstitial", "INT", "display"), ("Playable", "PLY", "video")],
    ),
]
# hour (UTC) when each audience region is busiest
PEAK_HOUR = {"US": 1.5, "EU": 19.0, "APAC": 12.5}

APP_WORDS_A = [
    "Word",
    "Merge",
    "Puzzle",
    "Pixel",
    "Idle",
    "Tiny",
    "Solitaire",
    "Block",
    "Garden",
    "Ocean",
    "Star",
    "Color",
    "Tile",
    "Dream",
    "Bubble",
    "Cozy",
    "Rocket",
    "Farm",
    "Zen",
    "Brain",
    "Magic",
    "Candy",
    "Hidden",
    "Daily",
    "Pocket",
    "Retro",
    "Jungle",
    "Snow",
    "City",
    "Royal",
]
APP_WORDS_B = [
    "Tiles",
    "Quest",
    "Harbor",
    "Garden",
    "Kitchen",
    "Run",
    "Craft",
    "Match",
    "Dash",
    "Mania",
    "Saga",
    "Islands",
    "Tower",
    "Story",
    "Builder",
    "Hunt",
    "Puzzle",
    "Blast",
    "Friends",
    "Legends",
    "Journal",
    "News",
    "Weather",
    "Recipes",
    "Scanner",
    "Radio",
    "Notes",
    "Fitness",
    "Sudoku",
    "Chess",
]
CTV_APPS = [
    "Movies",
    "Classic TV",
    "Kids",
    "Docs",
    "Sports Replay",
    "Comedy",
    "News Live",
    "Westerns",
    "Cooking",
    "Anime",
]


@dataclass
class Catalog:
    """Dimension tables as column lists, plus the arrays the generator needs."""

    demand_partners: dict = field(default_factory=dict)
    demand_sources: dict = field(default_factory=dict)
    publishers: dict = field(default_factory=dict)
    placements: dict = field(default_factory=dict)
    apps: dict = field(default_factory=dict)
    deals: dict = field(default_factory=dict)
    # deal × app pairs the deal can serve ("lanes") and placement × app pairs that receive traffic ("slots")
    lanes: dict = field(default_factory=dict)
    slots: dict = field(default_factory=dict)


def _slug(s: str) -> str:
    return "".join(c for c in s.lower() if c.isalnum())


def build_catalog(seed: int = 7) -> Catalog:
    rng = np.random.default_rng(seed)
    cat = Catalog()

    # ---- demand: partners → sources (one per region × format the partner buys, trimmed) ----
    dp = {"dp_id": [], "name": [], "code": []}
    ds = {"ds_id": [], "dp_id": [], "name": [], "code": [], "format": [], "region": [], "bid_rate": [], "price": []}
    for i, (name, code, fmts) in enumerate(DEMAND_PARTNERS, start=1):
        dp["dp_id"].append(i)
        dp["name"].append(name)
        dp["code"].append(code)
        regions = [REGIONS[j] for j in sorted(rng.choice(len(REGIONS), size=rng.integers(1, 3), replace=False))]
        for fmt in fmts:
            for region, rcode in regions:
                if len(ds["ds_id"]) and rng.random() < 0.25:
                    continue  # not every partner buys every region × format
                ds["ds_id"].append(100 + len(ds["ds_id"]) + 1)
                ds["dp_id"].append(i)
                ds["name"].append(f"{name.split()[0]} {region} {FORMAT_LABEL[fmt]}")
                ds["code"].append(f"{code}-{rcode}{fmt[0].upper()}")
                ds["format"].append(fmt)
                ds["region"].append(region)
                ds["bid_rate"].append(float(np.clip(rng.lognormal(np.log(0.16), 0.55), 0.02, 0.6)))
                ds["price"].append(float(rng.lognormal(0, 0.22)))
    cat.demand_partners, cat.demand_sources = dp, ds

    # ---- supply: publishers → placements, publishers → apps ----
    pub = {"pub_id": [], "name": [], "code": [], "region": [], "weekend": []}
    plc = {"plc_id": [], "pub_id": [], "name": [], "code": [], "format": []}
    app = {"app_id": [], "pub_id": [], "bundle": [], "name": [], "daily_opps": [], "quality": [], "completion": []}
    used = set()
    for p, (name, code, region, weekend, placements) in enumerate(PUBLISHERS, start=1):
        pub["pub_id"].append(p)
        pub["name"].append(name)
        pub["code"].append(code)
        pub["region"].append(region)
        pub["weekend"].append(weekend)
        for label, pcode, fmt in placements:
            plc["plc_id"].append(1000 + len(plc["plc_id"]) + 1)
            plc["pub_id"].append(p)
            plc["name"].append(f"{name} · {label}")
            plc["code"].append(f"{code}-{pcode}")
            plc["format"].append(fmt)
        is_ctv = all(f == "ctv" for _, _, f in placements)
        n_apps = len(CTV_APPS) if is_ctv else int(rng.integers(6, 26))
        for k in range(n_apps):
            if is_ctv:
                title = CTV_APPS[k]
                bundle = f"tv.{_slug(name.split()[0])}.{_slug(title)}"
            else:
                while True:
                    title = f"{rng.choice(APP_WORDS_A)} {rng.choice(APP_WORDS_B)}"
                    if title not in used:
                        break
                bundle = f"com.{_slug(name.split()[0])}.{_slug(title)}"
            used.add(title)
            app["app_id"].append(len(app["app_id"]) + 1)
            app["pub_id"].append(p)
            app["bundle"].append(bundle)
            app["name"].append(title)
            # app popularity is heavy-tailed: a few hits, a long tail
            app["daily_opps"].append(float(rng.lognormal(np.log(900_000), 1.25)) * (0.35 if is_ctv else 1.0))
            app["quality"].append(float(rng.lognormal(0, 0.25)))
            app["completion"].append(float(np.clip(rng.normal(1.0, 0.06), 0.8, 1.1)))
    cat.publishers, cat.placements, cat.apps = pub, plc, app

    # ---- deals: placement × demand source that buys its format ----
    deal = {
        "deal_id": [],
        "name": [],
        "plc_id": [],
        "ds_id": [],
        "dp_id": [],
        "pub_id": [],
        "format": [],
        "target_app_id": [],
        "setup": [],
        "status": [],
        "margin_pct": [],
        "qps_cap": [],
        "participation": [],
        "win_rate": [],
        "never_bids": [],
    }
    ds_by_fmt = {f: [j for j, x in enumerate(ds["format"]) if x == f] for f in FORMATS}
    apps_by_pub = {}
    for a, p in enumerate(app["pub_id"]):
        apps_by_pub.setdefault(p, []).append(a)
    for i, p_id in enumerate(plc["plc_id"]):
        fmt = plc["format"][i]
        pool = ds_by_fmt[fmt]
        k = int(min(len(pool), rng.integers(3, 9)))
        for j in rng.choice(pool, size=k, replace=False):
            dedicated = rng.random() < 0.22
            pub_apps = apps_by_pub[plc["pub_id"][i]]
            target = int(app["app_id"][int(rng.choice(pub_apps))]) if dedicated else 0
            deal["deal_id"].append(5000 + len(deal["deal_id"]) + 1)
            deal["name"].append(f"{plc['code'][i]}·{ds['code'][j]}")
            deal["plc_id"].append(p_id)
            deal["ds_id"].append(ds["ds_id"][j])
            deal["dp_id"].append(ds["dp_id"][j])
            deal["pub_id"].append(plc["pub_id"][i])
            deal["format"].append(fmt)
            deal["target_app_id"].append(target)
            deal["setup"].append("Manual" if rng.random() < 0.3 else "Auto")
            deal["status"].append("Paused" if rng.random() < 0.07 else "On")
            deal["margin_pct"].append(int(rng.choice([15, 20, 22, 25, 28, 30, 35, 40])))
            deal["qps_cap"].append(int(rng.choice([0, 0, 0, 500, 1000, 2500, 5000])))  # 0 = no cap
            deal["participation"].append(float(rng.uniform(0.35, 1.0)))
            deal["win_rate"].append(float(np.clip(rng.lognormal(np.log(0.24), 0.35), 0.05, 0.6)))
            deal["never_bids"].append(bool(rng.random() < 0.04))  # misconfigured: gets traffic, never bids
    cat.deals = deal

    # ---- slots (placement × app) and lanes (deal × app) ----
    slots = {"plc": [], "app": [], "share": []}
    slot_of = {}
    for i in range(len(plc["plc_id"])):
        for a in apps_by_pub[plc["pub_id"][i]]:
            slot_of[(i, a)] = len(slots["plc"])
            slots["plc"].append(i)
            slots["app"].append(a)
            slots["share"].append(float(rng.uniform(0.25, 0.7)))  # share of the app's opportunities on this placement
    lanes = {"deal": [], "slot": []}
    plc_index = {p_id: i for i, p_id in enumerate(plc["plc_id"])}
    app_index = {a_id: a for a, a_id in enumerate(app["app_id"])}
    for d, p_id in enumerate(deal["plc_id"]):
        i = plc_index[p_id]
        targets = [app_index[deal["target_app_id"][d]]] if deal["target_app_id"][d] else apps_by_pub[plc["pub_id"][i]]
        for a in targets:
            lanes["deal"].append(d)
            lanes["slot"].append(slot_of[(i, a)])
    cat.slots = {k: np.asarray(v) for k, v in slots.items()}
    cat.lanes = {k: np.asarray(v) for k, v in lanes.items()}
    return cat
