#!/usr/bin/env python3
import argparse
import csv
from datetime import datetime
from pathlib import Path

# Input columns expected in the CSVs (extra CSV columns are ignored)
CSV_COLUMNS = [
    "ride_id","rideable_type","started_at","ended_at",
    "start_station_name","start_station_id",
    "end_station_name","end_station_id",
    "start_lat","start_lng","end_lat","end_lng",
    "member_casual",
]

# Output columns to insert (route_polyline is always NULL)
OUT_COLUMNS = CSV_COLUMNS + ["route_polyline"]

NUMERIC_COLS = {"start_lat","start_lng","end_lat","end_lng"}

def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"

def to_sql_value(col: str, raw):
    # Always NULL for route_polyline
    if col == "route_polyline":
        return "NULL"

    if raw is None:
        return "NULL"

    s = str(raw).strip()
    if s == "":
        return "NULL"

    if col in NUMERIC_COLS:
        try:
            float(s)
            return s  # numeric literal
        except ValueError:
            return sql_quote(s)

    return sql_quote(s)

def main():
    ap = argparse.ArgumentParser(
        description="Convert all .csv files in a directory into chunked .sql files for Cloudflare D1 (no BEGIN/COMMIT)."
    )
    ap.add_argument("csv_dir", help="Directory containing .csv files")
    ap.add_argument("--out-dir", default="./seeds", help="Where to write .sql parts (default: ./seeds)")
    ap.add_argument("--base", default="all_rides", help="Base name for output files (default: all_rides)")
    ap.add_argument("--table", default="rides", help="Target table (default: rides)")
    ap.add_argument("--insert-or-ignore", action="store_true", help="Use INSERT OR IGNORE (recommended)")
    ap.add_argument("--max-mb", type=int, default=20, help="Max size per .sql file in MB (default: 20)")
    ap.add_argument("--no-header", action="store_true", help="Do not write comment header")
    args = ap.parse_args()

    csv_dir = Path(args.csv_dir).expanduser().resolve()
    if not csv_dir.is_dir():
        raise SystemExit(f"Not a directory: {csv_dir}")

    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    max_bytes = max(1, args.max_mb) * 1024 * 1024
    insert_kw = "INSERT OR IGNORE" if args.insert_or_ignore else "INSERT"

    csv_files = sorted(csv_dir.glob("*.csv"), key=lambda p: p.name.lower())
    if not csv_files:
        raise SystemExit(f"No .csv files found in: {csv_dir}")

    col_list = ", ".join(f'"{c}"' for c in OUT_COLUMNS)

    part = 1
    current_bytes = 0
    total_rows = 0

    def open_part_file(p: int):
        nonlocal current_bytes
        path = out_dir / f"{args.base}_part_{p:04d}.sql"
        f = path.open("w", encoding="utf-8")
        if not args.no_header:
            f.write("-- CSV → SQL seed for Cloudflare D1 (no explicit transactions)\n")
            f.write("-- route_polyline is always NULL\n")
            f.write(f"-- Generated: {datetime.utcnow().isoformat()}Z\n")
        current_bytes = f.tell()
        print(f"Writing {path}")
        return f, path

    f_out, _ = open_part_file(part)

    for csv_path in csv_files:
        print(f"Reading {csv_path.name}")
        with csv_path.open("r", newline="", encoding="utf-8") as f_in:
            reader = csv.DictReader(f_in)

            # Figure out which of the expected CSV columns are present.
            present = set(reader.fieldnames or [])
            # We'll read only from CSV_COLUMNS and fill missing as NULL.
            for row in reader:
                values = [to_sql_value(c, row.get(c) if c in present else None) for c in CSV_COLUMNS]
                values.append("NULL")  # route_polyline

                line = (
                    f'{insert_kw} INTO "{args.table}" ({col_list}) '
                    f'VALUES ({", ".join(values)});\n'
                )

                b = line.encode("utf-8")
                if current_bytes + len(b) > max_bytes:
                    f_out.close()
                    part += 1
                    f_out, _ = open_part_file(part)

                f_out.write(line)
                current_bytes += len(b)
                total_rows += 1

    f_out.close()
    print(f"Done. {len(csv_files)} CSV(s), {total_rows} row(s), {part} SQL part(s) in {out_dir}")

if __name__ == "__main__":
    main()
