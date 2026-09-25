#!/usr/bin/env python3
"""Precompute station/month summaries in the existing remote KV namespace.

Run once without arguments to backfill all existing rides_YYYYMM tables, or
pass one or more months to refresh only those summaries:

    python3 utils/cache-month-stats.py
    python3 utils/cache-month-stats.py 2026-02
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WRANGLER_ENV = None
TABLES_QUERY = """
SELECT name
FROM sqlite_master
WHERE type = 'table'
  AND name GLOB 'rides_[0-9][0-9][0-9][0-9][0-9][0-9]'
ORDER BY name
"""


def normalize_month(value: str) -> str:
    month = value.replace("-", "")
    if not re.fullmatch(r"\d{6}", month) or not 1 <= int(month[4:]) <= 12:
        raise argparse.ArgumentTypeError("month must be YYYY-MM or YYYYMM")
    return month


def selected_wrangler_env() -> dict[str, str]:
    global WRANGLER_ENV
    if WRANGLER_ENV is not None:
        return WRANGLER_ENV

    WRANGLER_ENV = os.environ.copy()
    if WRANGLER_ENV.get("CLOUDFLARE_ACCOUNT_ID"):
        return WRANGLER_ENV

    result = subprocess.run(
        ["npx", "wrangler", "whoami", "--json"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    data = json.loads(result.stdout)
    accounts = data.get("accounts", []) if isinstance(data, dict) else []
    account = next(
        (item for item in accounts if item.get("name") == "Sam Jeffs (quacksire.dev)"),
        None,
    )
    if not account or not account.get("id"):
        available = ", ".join(item.get("name", "") for item in accounts)
        raise RuntimeError(
            "Could not resolve Wrangler account 'Sam Jeffs (quacksire.dev)'. "
            f"Available accounts: {available}"
        )

    WRANGLER_ENV["CLOUDFLARE_ACCOUNT_ID"] = account["id"]
    return WRANGLER_ENV


def wrangler(*args: str, capture_output: bool = False) -> subprocess.CompletedProcess:
    result = subprocess.run(
        ["npx", "wrangler", *args],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
        env=selected_wrangler_env(),
    )
    if result.returncode:
        details = (result.stderr or "").strip() or (result.stdout or "").strip()
        raise RuntimeError(details or f"Wrangler exited with status {result.returncode}")
    if not capture_output:
        if result.stdout:
            print(result.stdout, end="", flush=True)
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr, flush=True)
    return result


def result_sets(payload: object) -> list[list[dict]]:
    if isinstance(payload, dict):
        items = [payload]
    elif isinstance(payload, list):
        items = payload
    else:
        return []

    return [
        [row for row in item.get("results", []) if isinstance(row, dict)]
        for item in items
        if isinstance(item, dict) and isinstance(item.get("results"), list)
    ]


def discover_months() -> list[str]:
    result = wrangler(
        "d1", "execute", "baywheels", "--remote", "--command", TABLES_QUERY,
        "--json", "--yes", capture_output=True,
    )
    rows = [row for result_set in result_sets(json.loads(result.stdout)) for row in result_set]
    return sorted({
        match.group(1)
        for row in rows
        if (match := re.fullmatch(r"rides_(\d{6})", str(row.get("name", ""))))
        and 1 <= int(match.group(1)[4:]) <= 12
    })


def month_stats_query(month: str) -> str:
    table_name = f"rides_{month}"
    station_filter = "start_station_id IS NOT NULL AND start_station_id <> ''"
    return f"""
SELECT start_station_id AS station_id,
       COUNT(*) AS total_rides,
       SUM(CASE WHEN member_casual = 'member' THEN 1 ELSE 0 END) AS member_count,
       SUM(CASE WHEN member_casual = 'casual' THEN 1 ELSE 0 END) AS casual_count,
       SUM(CASE WHEN end_station_id = start_station_id THEN 1 ELSE 0 END) AS false_starts,
       AVG(CASE WHEN julianday(ended_at) > julianday(started_at)
           THEN (julianday(ended_at) - julianday(started_at)) * 86400 END) AS avg_ride_seconds,
       MAX(CASE WHEN julianday(ended_at) > julianday(started_at)
           THEN (julianday(ended_at) - julianday(started_at)) * 86400 END) AS longest_ride_seconds
FROM {table_name}
WHERE {station_filter}
GROUP BY start_station_id;

SELECT start_station_id AS station_id, rideable_type, COUNT(*) AS count
FROM {table_name}
WHERE {station_filter}
GROUP BY start_station_id, rideable_type
ORDER BY start_station_id, count DESC;

SELECT start_station_id AS station_id,
       strftime('%w', substr(started_at, 1, 10)) AS day_num,
       COUNT(*) AS count
FROM {table_name}
WHERE {station_filter}
GROUP BY start_station_id, day_num
ORDER BY start_station_id, CAST(day_num AS INTEGER);

WITH destination_counts AS (
    SELECT start_station_id AS station_id, end_station_name, COUNT(*) AS count
    FROM {table_name}
    WHERE {station_filter}
    GROUP BY start_station_id, end_station_name
), ranked_destinations AS (
    SELECT station_id, end_station_name, count,
           ROW_NUMBER() OVER (
               PARTITION BY station_id ORDER BY count DESC, end_station_name
           ) AS rank_num
    FROM destination_counts
)
SELECT station_id, end_station_name, count
FROM ranked_destinations
WHERE rank_num <= 5
ORDER BY station_id, rank_num;

SELECT start_station_id AS station_id,
       substr(started_at, 12, 2) AS hour,
       COUNT(*) AS count
FROM {table_name}
WHERE {station_filter}
GROUP BY start_station_id, hour
ORDER BY start_station_id, CAST(hour AS INTEGER);

SELECT start_station_id AS station_id,
       end_station_id,
       MAX(end_station_name) AS end_station_name,
       MAX(start_lat) AS start_lat,
       MAX(start_lng) AS start_lng,
       MAX(end_lat) AS end_lat,
       MAX(end_lng) AS end_lng,
       MAX(route_polyline) AS route_polyline,
       COUNT(*) AS ride_count
FROM {table_name}
WHERE {station_filter} AND end_station_id IS NOT NULL AND end_station_id <> ''
GROUP BY start_station_id, end_station_id
ORDER BY start_station_id, ride_count DESC;
"""


def month_stats(month: str) -> dict[str, dict]:
    result = wrangler(
        "d1", "execute", "baywheels", "--remote", "--command",
        month_stats_query(month), "--json", "--yes", capture_output=True,
    )
    rows_by_query = result_sets(json.loads(result.stdout))
    if len(rows_by_query) != 6:
        raise RuntimeError(f"Expected six result sets for {month}, got {len(rows_by_query)}")

    stats = {
        str(row["station_id"]): {
            "total_rides": int(row["total_rides"] or 0),
            "member_count": int(row["member_count"] or 0),
            "casual_count": int(row["casual_count"] or 0),
            "false_starts": int(row["false_starts"] or 0),
            "avg_ride_seconds": round(float(row["avg_ride_seconds"])) if row.get("avg_ride_seconds") is not None else None,
            "longest_ride_seconds": round(float(row["longest_ride_seconds"])) if row.get("longest_ride_seconds") is not None else None,
            "rideableTypes": [],
            "dayOfWeek": [],
            "destinations": [],
            "busiestHours": [],
            "routeCounts": [],
        }
        for row in rows_by_query[0]
    }

    def station_for(row: dict) -> dict:
        return stats.setdefault(str(row["station_id"]), {
            "total_rides": 0,
            "member_count": 0,
            "casual_count": 0,
            "false_starts": 0,
            "avg_ride_seconds": None,
            "longest_ride_seconds": None,
            "rideableTypes": [],
            "dayOfWeek": [],
            "destinations": [],
            "busiestHours": [],
            "routeCounts": [],
        })

    for row in rows_by_query[1]:
        station_for(row)["rideableTypes"].append({
            "rideable_type": row.get("rideable_type"),
            "count": int(row["count"]),
        })
    for row in rows_by_query[2]:
        station_for(row)["dayOfWeek"].append({
            "day_num": row.get("day_num"),
            "count": int(row["count"]),
        })
    for row in rows_by_query[3]:
        station_for(row)["destinations"].append({
            "end_station_name": row.get("end_station_name"),
            "count": int(row["count"]),
        })
    for row in rows_by_query[4]:
        station_for(row)["busiestHours"].append({
            "hour": row.get("hour"),
            "count": int(row["count"]),
        })
    for row in rows_by_query[5]:
        station_for(row)["routeCounts"].append({
            "end_station_id": str(row["end_station_id"]),
            "end_station_name": row.get("end_station_name"),
            "start_lat": row.get("start_lat"),
            "start_lng": row.get("start_lng"),
            "end_lat": row.get("end_lat"),
            "end_lng": row.get("end_lng"),
            "route_polyline": row.get("route_polyline"),
            "ride_count": int(row["ride_count"]),
        })

    return stats


def kv_entries(month: str, stats: dict[str, dict]) -> list[dict[str, str]]:
    entries = []
    for station_id, snapshot in stats.items():
        route_entries = []
        for route in snapshot.get("routeCounts", []):
            route_polyline = route.get("route_polyline")
            route_entries.append({key: value for key, value in route.items() if key != "route_polyline"})
            if route_polyline:
                entries.append({
                    "key": f"route:{station_id}:{route['end_station_id']}",
                    "value": route_polyline,
                })
        snapshot["routeCounts"] = route_entries
        entries.append({
            "key": f"station-stats:v1:{month[:4]}-{month[4:]}:{station_id}",
            "value": json.dumps(snapshot, separators=(",", ":")),
        })
    entries.append({
        "key": f"station-stats:v1:{month[:4]}-{month[4:]}:_ready",
        "value": "{\"ready\":true}",
    })
    entries.append({
        "key": f"month-index:v1:{month[:4]}-{month[4:]}",
        "value": "1",
    })
    return entries


def upload_month(month: str, entries: list[dict[str, str]]) -> None:
    with tempfile.TemporaryDirectory(prefix=f"baywheelin-kv-stats-{month}-") as temp:
        for batch_number, start in enumerate(range(0, len(entries), 10_000), 1):
            path = Path(temp) / f"stats-{month}-{batch_number:04d}.json"
            path.write_text(json.dumps(entries[start:start + 10_000]), encoding="utf-8")
            wrangler(
                "kv", "bulk", "put", str(path), "--binding", "baywheel_kv", "--remote",
            )


def refresh_month(month: str) -> None:
    for attempt in range(1, 4):
        print(f"Reading station stats for {month[:4]}-{month[4:]}...")
        try:
            stats = month_stats(month)
            print(f"Uploading {len(stats)} station summaries for {month[:4]}-{month[4:]}...")
            upload_month(month, kv_entries(month, stats))
            return
        except RuntimeError as error:
            message = str(error)
            if "Upstream service unavailable" not in message or attempt == 3:
                raise
            delay = attempt * 3
            print(f"Cloudflare API is unavailable; retrying in {delay}s.")
            time.sleep(delay)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("months", nargs="*", type=normalize_month)
    args = parser.parse_args()

    months = sorted(set(args.months)) if args.months else discover_months()
    if not months:
        print("No monthly ride tables found in D1.")
        return

    print(f"Found {len(months)} month(s) to precompute.")
    for month in months:
        refresh_month(month)
    print(f"Precomputed station stats for {len(months)} month(s) in KV.")


if __name__ == "__main__":
    main()
