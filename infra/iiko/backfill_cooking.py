#!/usr/bin/env python3
"""
Backfill chicko.dish_cooking_daily from iiko OLAP.
Period: 2026-01-01 .. 2026-05-07 (inclusive end == day-after for filter).
Idempotent: ReplacingMergeTree(inserted_at) collapses duplicates.
"""
import os, sys, json, time, hashlib, urllib.parse
from datetime import date, timedelta, datetime
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import ssl

# ── config ─────────────────────────────────────────────────────────────
IIKO_HOST = "https://chiko-riko-ip-kachaev-r-o-co.iiko.it"
IIKO_LOGIN = "OLAP"
IIKO_PASS_PLAIN = os.environ.get("IIKO_OLAP_PASSWORD") or open("/Users/alekseymelnikov/Developer/chicko-api-proxy/.iiko.env").read().split("IIKO_OLAP_PASSWORD=")[1].strip()
IIKO_PASS_SHA1 = hashlib.sha1(IIKO_PASS_PLAIN.encode()).hexdigest()

CH_HOST = "https://rc1d-3r30isjr73k4uue8.mdb.yandexcloud.net:8443"
CH_USER = "Claude"
CH_PASS = os.environ.get("CLICKHOUSE_PASSWORD") or open("/Users/alekseymelnikov/Developer/chicko-api-proxy/.b360.env").read().split("CLICKHOUSE_PASSWORD=")[1].strip()
CA_FILE = "/Users/alekseymelnikov/.clickhouse/YandexInternalRootCA.crt"

START = date(2026, 1, 2)
END   = date(2026, 5, 7)  # inclusive

DRY_RUN = "--dry" in sys.argv
ONLY_FIRST = "--first" in sys.argv

# ── ssl ctx ───────────────────────────────────────────────────────────
ch_ctx = ssl.create_default_context(cafile=CA_FILE)
iiko_ctx = ssl.create_default_context()  # iiko uses public cert

# ── iiko auth ─────────────────────────────────────────────────────────
def iiko_auth():
    body = urllib.parse.urlencode({"login": IIKO_LOGIN, "pass": IIKO_PASS_SHA1}).encode()
    req = Request(f"{IIKO_HOST}/resto/api/auth", data=body,
                  headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urlopen(req, context=iiko_ctx, timeout=30) as r:
        token = r.read().decode().strip()
    print(f"  iiko token: {token[:8]}…", flush=True)
    return token

def iiko_olap(token, day):
    """Fetch OLAP for one day (filter from=day, to=day+1, exclusive high)."""
    nxt = day + timedelta(days=1)
    body = {
        "reportType": "SALES",
        "buildSummary": "false",
        "groupByRowFields": [
            "Department.Id", "Department",
            "DishCode", "DishName", "DishCategory", "DishGroup"
        ],
        "aggregateFields": [
            "Cooking.CookingDuration.Avg",
            "Cooking.KitchenTime.Avg",
            "Cooking.GuestWaitTime.Avg",
            "Cooking.ServeTime.Avg",
            "Cooking.StartDelayTime.Avg",
            "Cooking.CookingLateTime.Avg",
            "Cooking.FeedLateTime.Avg",
            "DishAmountInt",
        ],
        "filters": {
            "OpenDate.Typed": {
                "filterType": "DateRange", "periodType": "CUSTOM",
                "from": day.isoformat(), "to": nxt.isoformat(),
                "includeLow": True, "includeHigh": False
            }
        }
    }
    req = Request(
        f"{IIKO_HOST}/resto/api/v2/reports/olap?key={token}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urlopen(req, context=iiko_ctx, timeout=120) as r:
        return json.loads(r.read())

# ── ch insert ─────────────────────────────────────────────────────────
def ch_post(query, body=b""):
    url = f"{CH_HOST}/?database=chicko&query={urllib.parse.quote(query)}"
    req = Request(url, data=body, method="POST")
    auth = f"{CH_USER}:{CH_PASS}".encode()
    import base64
    req.add_header("Authorization", "Basic " + base64.b64encode(auth).decode())
    req.add_header("Content-Type", "text/plain")
    with urlopen(req, context=ch_ctx, timeout=120) as r:
        return r.read().decode()

def ch_query(sql):
    url = f"{CH_HOST}/?database=chicko"
    req = Request(url, data=sql.encode(), method="POST")
    auth = f"{CH_USER}:{CH_PASS}".encode()
    import base64
    req.add_header("Authorization", "Basic " + base64.b64encode(auth).decode())
    req.add_header("Content-Type", "text/plain")
    with urlopen(req, context=ch_ctx, timeout=120) as r:
        return r.read().decode()

# ── transform ─────────────────────────────────────────────────────────
def to_int_or_none(v):
    if v is None or v == "" or v == "NULL":
        return None
    try:
        f = float(v)
        if f != f:  # NaN
            return None
        return int(round(f))
    except Exception:
        return None

def transform(rows, day):
    out = []
    for r in rows:
        cd  = to_int_or_none(r.get("Cooking.CookingDuration.Avg"))
        kt  = to_int_or_none(r.get("Cooking.KitchenTime.Avg"))
        gw  = to_int_or_none(r.get("Cooking.GuestWaitTime.Avg"))
        sv  = to_int_or_none(r.get("Cooking.ServeTime.Avg"))
        sd  = to_int_or_none(r.get("Cooking.StartDelayTime.Avg"))
        cl  = to_int_or_none(r.get("Cooking.CookingLateTime.Avg"))
        fl  = to_int_or_none(r.get("Cooking.FeedLateTime.Avg"))
        qty = r.get("DishAmountInt") or 0
        try: qty = float(qty)
        except: qty = 0.0
        has = 1 if any(x is not None for x in (cd, kt, gw, sv)) else 0
        dept_uuid = r.get("Department.Id") or ""
        if not dept_uuid:
            continue  # skip rows without department id
        out.append({
            "report_date": day.isoformat(),
            "dept_uuid":   dept_uuid,
            "restaurant_name": r.get("Department") or "",
            "city": "",
            "dish_code":     r.get("DishCode") or "",
            "dish_name":     r.get("DishName") or "",
            "dish_category": r.get("DishCategory") or "",
            "dish_group":    r.get("DishGroup") or "",
            "cooking_duration_avg_sec": cd,
            "kitchen_time_avg_sec": kt,
            "guest_wait_avg_sec": gw,
            "serve_time_avg_sec": sv,
            "start_delay_avg_sec": sd,
            "cooking_late_avg_sec": cl,
            "feed_late_avg_sec": fl,
            "qty_total": qty,
            "has_cooking_data": has,
        })
    return out

# ── main loop ─────────────────────────────────────────────────────────
def main():
    token = iiko_auth()
    token_at = time.time()

    cur = START
    total_rows = 0
    while cur <= END:
        # refresh iiko token every 25 min
        if time.time() - token_at > 25*60:
            token = iiko_auth()
            token_at = time.time()

        t0 = time.time()
        try:
            d = iiko_olap(token, cur)
        except HTTPError as e:
            if e.code in (401, 403):
                print(f"  reauth on {cur}", flush=True)
                token = iiko_auth(); token_at = time.time()
                d = iiko_olap(token, cur)
            else:
                raise
        rows = d.get("data", [])
        items = transform(rows, cur)
        n = len(items)

        if DRY_RUN:
            print(f"  {cur}  rows={len(rows):>5}  insert={n:>5}  has_cooking={sum(x['has_cooking_data'] for x in items):>5}  ({time.time()-t0:.1f}s) [DRY]", flush=True)
        elif n:
            payload = "\n".join(json.dumps(x, ensure_ascii=False) for x in items).encode()
            ch_post("INSERT INTO chicko.dish_cooking_daily FORMAT JSONEachRow", payload)
            total_rows += n
            cov = sum(x["has_cooking_data"] for x in items)
            print(f"  {cur}  olap={len(rows):>5}  ins={n:>5}  cov={cov:>5}  ({time.time()-t0:.1f}s)", flush=True)
        else:
            print(f"  {cur}  EMPTY  ({time.time()-t0:.1f}s)", flush=True)

        if ONLY_FIRST:
            break
        cur += timedelta(days=1)

    print(f"\nDONE. inserted total = {total_rows}")

if __name__ == "__main__":
    main()
