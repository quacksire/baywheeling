#!/usr/bin/env python3
"""
Self-contained pipeline: CSV → polyline backfill → monthly SQL files + KV upload.

Reads from utils/data/*.csv, fetches route polylines from OSRM (cached in kv.csv),
writes seeds_by_month_csv/*.sql with polylines baked in, and uploads routes to
Cloudflare KV when explicitly enabled by the caller.

Requires env vars for KV upload: CF_ACCOUNT_ID, CF_API_KEY
"""

import csv
import argparse
import json
import os
import ssl
import subprocess
import time
import urllib.request
from pathlib import Path
from collections import defaultdict


D1_DATABASE_ID = "1a853d41-9f8f-4963-a9f8-6d327e2831ee"
KV_NAMESPACE_ID = "4ba5cf8ffada4206a7a0a26843b0b524"

OSRM_BASE = "https://router.project-osrm.org/route/v1/cycling"
KV_CACHE_FILE = Path.cwd() / "kv.csv"
OSRM_CONTEXT = ssl.create_default_context()


def get_table_schema():
    """Return the table schema definition."""
    return """CREATE TABLE IF NOT EXISTS {table_name} (
   ride_id TEXT,
   rideable_type TEXT,
   started_at TEXT,
   ended_at TEXT,
   start_station_name TEXT,
   start_station_id TEXT,
   end_station_name TEXT,
   end_station_id TEXT,
   start_lat REAL,
   start_lng REAL,
   end_lat REAL,
   end_lng REAL,
   member_casual TEXT,
   "route_polyline" TEXT
);"""


def load_kv_cache():
    """Load cached route polylines from kv.csv."""
    cache = {}
    if KV_CACHE_FILE.exists():
        with open(KV_CACHE_FILE, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                key, polyline = line.split(",", 1)
                cache[key] = polyline
        print(f"  Loaded {len(cache)} cached routes from kv.csv")
    return cache


def save_kv_cache(cache):
    """Write the full cache back to kv.csv (deduped)."""
    temporary_file = KV_CACHE_FILE.with_suffix(".csv.tmp")
    with open(temporary_file, "w") as f:
        for key in sorted(cache.keys()):
            f.write(f"{key},{cache[key]}\n")
    temporary_file.replace(KV_CACHE_FILE)


def fetch_polyline(start_lng, start_lat, end_lng, end_lat):
    """Fetch a cycling route polyline from OSRM with retry/backoff."""
    url = f"{OSRM_BASE}/{start_lng},{start_lat};{end_lng},{end_lat}?overview=full&geometries=polyline"

    # The Apple-provided Python 3.9 on some VPS/macOS setups fails the TLS
    # handshake against OSRM. curl uses the system TLS implementation and is
    # more reliable here, while keeping urllib as a fallback for minimal hosts.
    try:
        for attempt in range(1, 4):
            result = subprocess.run(
                [
                    "curl", "-fsSL", "--http1.1", "--tlsv1.2",
                    "--connect-timeout", "10", "--max-time", "30",
                    "-A", "baywheelin-vps-importer/1.0", url,
                ],
                capture_output=True,
                text=True,
                timeout=35,
            )
            if result.returncode == 0:
                routes = json.loads(result.stdout).get("routes", [])
                if routes:
                    return routes[0].get("geometry")
            if attempt < 3:
                delay = attempt * 2
                print(f"    curl OSRM attempt {attempt} failed; retrying in {delay}s")
                time.sleep(delay)
    except FileNotFoundError:
        pass

    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "baywheelin-vps-importer/1.0"},
            )
            with urllib.request.urlopen(req, timeout=30, context=OSRM_CONTEXT) as resp:
                data = json.loads(resp.read())
                routes = data.get("routes", [])
                if routes:
                    return routes[0].get("geometry")
        except Exception as error:
            if attempt == 3:
                print(f"    OSRM error after 3 attempts: {error}")
            else:
                delay = attempt * 2
                print(f"    OSRM attempt {attempt} failed: {error}; retrying in {delay}s")
                time.sleep(delay)
    return None


def get_polyline(row, cache, new_routes):
    """Get polyline for a ride, using cache or fetching from OSRM."""
    start_station = row.get("start_station_id", "")
    end_station = row.get("end_station_id", "")
    start_lat = row.get("start_lat", "")
    start_lng = row.get("start_lng", "")
    end_lat = row.get("end_lat", "")
    end_lng = row.get("end_lng", "")

    if not all([start_station, end_station, start_lat, start_lng, end_lat, end_lng]):
        return None

    kv_key = f"route:{start_station}:{end_station}"

    if kv_key in cache:
        return cache[kv_key]

    reverse_key = f"route:{end_station}:{start_station}"
    if reverse_key in cache:
        cache[kv_key] = cache[reverse_key]
        return cache[reverse_key]

    polyline = fetch_polyline(start_lng, start_lat, end_lng, end_lat)
    if polyline:
        cache[kv_key] = polyline
        cache[reverse_key] = polyline
        new_routes[kv_key] = polyline
        # Rate limit: OSRM is a free service
        # Respect OSRM's public-service pacing between uncached requests.
        time.sleep(1.1)

    return polyline


def csv_to_sql(csv_file, cache, new_routes, limit=None):
    """Convert a single CSV file to SQL INSERT statements with polylines."""
    inserts = defaultdict(list)
    row_count = 0
    routed_count = 0
    fetched_count = 0

    with open(csv_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        for row in reader:
            if limit is not None and row_count >= limit:
                break
            started_at = row.get("started_at", "")
            if not started_at or len(started_at) < 7:
                continue

            year_month = started_at[:7].replace("-", "")  # YYYYMM
            row_count += 1
            prev_new = len(new_routes)

            # Fetch/cache polyline
            polyline = get_polyline(row, cache, new_routes)
            if len(new_routes) > prev_new:
              fetched_count += 1
              print(f"    Fetched from OSRM for {row.get('start_station_id')} → {row.get('end_station_id')}")

            if polyline:
                row["route_polyline"] = polyline
                routed_count += 1
                print(f"    Route found for {row.get('start_station_id')} → {row.get('end_station_id')}")
            if row_count % 1000 == 0:
              print(f"    {row_count} rows processed, {routed_count} routed, {fetched_count} fetched from OSRM...")
            columns = [
                "ride_id", "rideable_type", "started_at", "ended_at",
                "start_station_name", "start_station_id", "end_station_name", "end_station_id",
                "start_lat", "start_lng", "end_lat", "end_lng", "member_casual", "route_polyline",
            ]

            values = []
            for col in columns:
                val = row.get(col, "")
                if val == "" or val is None:
                    values.append("NULL")
                else:
                    val = val.replace("'", "''")
                    values.append(f"'{val}'")

            values_str = ", ".join(values)
            table_name = f"rides_{year_month}"
            col_list = ", ".join([f'"{col}"' for col in columns])
            insert_stmt = f'INSERT OR IGNORE INTO "{table_name}" ({col_list}) VALUES ({values_str});\n'

            inserts[year_month].append(insert_stmt)

    print(f"    {row_count} rows, {routed_count} routed")
    return inserts


def bulk_put_kv(new_routes):
    """Bulk upload new route polylines to Cloudflare KV."""
    cf_account_id = os.environ.get("CF_ACCOUNT_ID")
    cf_api_key = os.environ.get("CF_API_KEY")

    if not cf_account_id or not cf_api_key:
        print("  Skipping KV upload (CF_ACCOUNT_ID / CF_API_KEY not set)")
        return

    if not new_routes:
        print("  No new routes to upload to KV")
        return

    kv_api = f"https://api.cloudflare.com/client/v4/accounts/{cf_account_id}/storage/kv/namespaces/{KV_NAMESPACE_ID}/bulk"

    entries = [{"key": key, "value": polyline} for key, polyline in new_routes.items()]
    batch_size = 100

    for i in range(0, len(entries), batch_size):
        batch = entries[i : i + batch_size]
        body = json.dumps(batch).encode("utf-8")

        req = urllib.request.Request(kv_api, data=body, method="PUT")
        req.add_header("Authorization", f"Bearer {cf_api_key}")
        req.add_header("Content-Type", "application/json")

        batch_num = i // batch_size + 1
        print(f"  KV batch {batch_num}: uploading {len(batch)} entries...")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read())
                if result.get("success"):
                    print(f"  KV batch {batch_num}: OK")
                else:
                    print(f"  KV batch {batch_num}: FAILED - {result}")
        except Exception as e:
            print(f"  KV batch {batch_num}: ERROR - {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Process at most this many rides")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be at least 1")

    data_dir = Path("data")
    output_dir = Path("seeds_by_month_csv")

    os.makedirs(output_dir, exist_ok=True)

    # Load route cache
    print("=== Loading route cache ===")
    cache = load_kv_cache()
    new_routes = {}

    # Process CSVs
    monthly_inserts = defaultdict(list)
    csv_files = sorted(data_dir.glob("*-baywheels-tripdata.csv"))
    print(f"\n=== Processing {len(csv_files)} CSV files ===")

    remaining_limit = args.limit
    for idx, csv_file in enumerate(csv_files, 1):
        print(f"[{idx}/{len(csv_files)}] {csv_file.name}...")
        inserts = csv_to_sql(csv_file, cache, new_routes, remaining_limit)
        for month, stmts in inserts.items():
            monthly_inserts[month].extend(stmts)
        if remaining_limit is not None:
            processed = sum(len(stmts) for stmts in inserts.values())
            remaining_limit -= processed
            if remaining_limit <= 0:
                break

    # Save updated cache
    print(f"\n=== Saving route cache ({len(cache)} total, {len(new_routes)} new) ===")
    save_kv_cache(cache)

    # Write SQL files
    print("\n=== Writing SQL files ===")

    init_file = output_dir / "00_create_tables.sql"
    with open(init_file, "w") as f:
        f.write("-- Create all monthly ride tables\n")
        for year_month in sorted(monthly_inserts.keys()):
            table_name = f"rides_{year_month}"
            schema = get_table_schema().format(table_name=table_name)
            f.write(f"\n{schema}\n")
    print(f"  Created {init_file.name}")

    for year_month in sorted(monthly_inserts.keys()):
        output_file = output_dir / f"rides_{year_month}.sql"
        with open(output_file, "w") as f:
            f.write(f"-- Data for {year_month}\n")
            for insert in monthly_inserts[year_month]:
                f.write(insert)
        print(f"  Created {output_file.name} with {len(monthly_inserts[year_month])} rows")

    summary_file = output_dir / "_months.txt"
    with open(summary_file, "w") as f:
        for year_month in sorted(monthly_inserts.keys()):
            f.write(f"{year_month}\n")

    # Bulk upload new routes to KV
    #print(f"\n=== Uploading to Cloudflare KV ===")
    #bulk_put_kv(new_routes)

    # Summary
    print(f"\n=== Done! ===")
    print(f"  {len(monthly_inserts)} months, {len(cache)} cached routes ({len(new_routes)} new)")
    for year_month in sorted(monthly_inserts.keys()):
        print(f"  {year_month}: {len(monthly_inserts[year_month])} rows")


if __name__ == "__main__":
    main()
