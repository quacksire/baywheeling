#!/usr/bin/env python3
"""
Fetch missing route polylines from OSRM and save to kv.csv.
Scans CSVs for unique station pairs not already cached.
Verbose output, 0.1s cooldown between requests.

Usage: python3 fetch_routes.py
"""

import asyncio
import csv
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
KV_CACHE_FILE = SCRIPT_DIR / "kv.csv"
OSRM_BASE = "https://router.project-osrm.org/route/v1/cycling"


def load_kv_cache():
    """Load cached route polylines from kv.csv, indexed both directions."""
    cache = {}
    if KV_CACHE_FILE.exists():
        with open(KV_CACHE_FILE, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                key, polyline = line.split(",", 1)
                cache[key] = polyline
                parts = key.split(":")
                if len(parts) == 3:
                    reverse_key = f"{parts[0]}:{parts[2]}:{parts[1]}"
                    if reverse_key not in cache:
                        cache[reverse_key] = polyline
    return cache


def save_kv_cache(cache):
    """Write the cache back to kv.csv (deduped, forward keys only)."""
    seen = set()
    temporary_file = KV_CACHE_FILE.with_suffix(".csv.tmp")
    with open(temporary_file, "w") as f:
        for key in sorted(cache.keys()):
            parts = key.split(":")
            if len(parts) == 3:
                canonical = tuple(sorted([parts[1], parts[2]]))
                if canonical in seen:
                    continue
            seen.add(canonical)
            f.write(f"{key},{cache[key]}\n")
    temporary_file.replace(KV_CACHE_FILE)


def collect_missing_routes(csv_files, cache):
    """Scan CSVs and return missing station pairs with sample coords."""
    missing = {}
    for csv_file in csv_files:
        with open(csv_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                s = row.get("start_station_id", "")
                e = row.get("end_station_id", "")
                if not all([s, e, row.get("start_lat"), row.get("start_lng"),
                            row.get("end_lat"), row.get("end_lng")]):
                    continue
                kv_key = f"route:{s}:{e}"
                if kv_key not in cache and kv_key not in missing:
                    missing[kv_key] = (row["start_lng"], row["start_lat"],
                                       row["end_lng"], row["end_lat"])
    return missing


def _fetch_one(kv_key, coords):
    """Fetch a single route from OSRM (blocking)."""
    slng, slat, elng, elat = coords
    url = f"{OSRM_BASE}/{slng},{slat};{elng},{elat}?overview=full&geometries=polyline"
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=10) as resp:
            data = json.loads(resp.read())
            routes = data.get("routes", [])
            if routes:
                return routes[0].get("geometry")
    except Exception as ex:
        print(f"    ERROR {kv_key}: {ex}")
    return None


async def fetch_missing_routes(missing, cache):
    """Async fetch all missing routes from OSRM with 0.1s cooldown."""
    total = len(missing)
    if total == 0:
        print("  No missing routes to fetch")
        return 0

    print(f"  Fetching {total} routes from OSRM...")
    fetched = 0
    failed = 0
    loop = asyncio.get_event_loop()

    with ThreadPoolExecutor(max_workers=1) as pool:
        for i, (kv_key, coords) in enumerate(missing.items(), 1):
            polyline = await loop.run_in_executor(pool, _fetch_one, kv_key, coords)
            if polyline:
                cache[kv_key] = polyline
                parts = kv_key.split(":")
                reverse_key = f"{parts[0]}:{parts[2]}:{parts[1]}"
                cache[reverse_key] = polyline
                fetched += 1
                print(f"    [{i}/{total}] OK    {kv_key}")
            else:
                failed += 1
                print(f"    [{i}/{total}] FAIL  {kv_key}")
            await asyncio.sleep(0.1)

    print(f"  Done: {fetched} fetched, {failed} failed")
    return fetched


def main():
    data_dir = SCRIPT_DIR / "data"
    csv_files = sorted(data_dir.glob("*-baywheels-tripdata.csv"))

    print(f"=== Loading route cache ===")
    cache = load_kv_cache()
    print(f"  {len(cache)} cached routes (including reverse)")

    print(f"\n=== Scanning {len(csv_files)} CSV files for missing routes ===")
    missing = collect_missing_routes(csv_files, cache)
    print(f"  Found {len(missing)} missing station pairs")

    print(f"\n=== Fetching from OSRM ===")
    asyncio.run(fetch_missing_routes(missing, cache))

    print(f"\n=== Saving cache ===")
    save_kv_cache(cache)
    print(f"  Saved {len(cache)} routes to kv.csv")


if __name__ == "__main__":
    main()
