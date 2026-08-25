#!/usr/bin/env python3
"""
CSV → monthly SQL files with polylines from local kv.csv cache.
No network calls. Matches routes bidirectionally (A→B and B→A).
"""

import csv
import os
from pathlib import Path
from collections import defaultdict

SCRIPT_DIR = Path(__file__).parent
KV_CACHE_FILE = SCRIPT_DIR / "kv.csv"


def get_table_schema():
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
                # Also index the reverse direction
                parts = key.split(":")
                if len(parts) == 3:
                    reverse_key = f"{parts[0]}:{parts[2]}:{parts[1]}"
                    if reverse_key not in cache:
                        cache[reverse_key] = polyline
        print(f"  Loaded {len(cache)} cached routes from kv.csv (including reverse)")
    return cache


def csv_to_sql(csv_file, cache):
    """Convert a single CSV file to SQL INSERT statements with cached polylines."""
    inserts = defaultdict(list)
    row_count = 0
    routed_count = 0

    with open(csv_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        notrouted = 0
        for row in reader:
            started_at = row.get("started_at", "")
            if not started_at or len(started_at) < 7:
                continue

            year_month = started_at[:7].replace("-", "")
            row_count += 1

            # Look up polyline from cache
            start_station = row.get("start_station_id", "")
            end_station = row.get("end_station_id", "")
            if start_station and end_station:
                kv_key = f"route:{start_station}:{end_station}"
                polyline = cache.get(kv_key)
                if polyline:
                    row["route_polyline"] = polyline
                    routed_count += 1
                else:
                 notrouted += 1

            if row_count % 10000 == 0:
                print(f"    {row_count} rows, {routed_count} routed...")

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
            insert_stmt = f'INSERT INTO "{table_name}" ({col_list}) VALUES ({values_str});\n'

            inserts[year_month].append(insert_stmt)

    print(f"    {notrouted} routes not found")
    print(f"    {row_count} rows, {routed_count} routed")
    return inserts


def main():
    data_dir = SCRIPT_DIR / "data"
    output_dir = SCRIPT_DIR / "seeds_by_month_csv"

    os.makedirs(output_dir, exist_ok=True)

    print("=== Loading route cache ===")
    cache = load_kv_cache()

    monthly_inserts = defaultdict(list)
    csv_files = sorted(data_dir.glob("*-baywheels-tripdata.csv"))
    print(f"\n=== Processing {len(csv_files)} CSV files ===")

    for idx, csv_file in enumerate(csv_files, 1):
        print(f"[{idx}/{len(csv_files)}] {csv_file.name}...")
        inserts = csv_to_sql(csv_file, cache)
        for month, stmts in inserts.items():
            monthly_inserts[month].extend(stmts)

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

    print(f"\n=== Done! ===")
    for year_month in sorted(monthly_inserts.keys()):
        print(f"  {year_month}: {len(monthly_inserts[year_month])} rows")


if __name__ == "__main__":
    main()
