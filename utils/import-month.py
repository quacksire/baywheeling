#!/usr/bin/env python3
"""
Download one Bay Wheels month, run the existing CSV converter, and load it into D1.

This is intentionally a small, synchronous importer for a VPS. It keeps the
route-pair cache in utils/kv.csv while the conversion itself runs in /tmp.

Usage:
    python3 utils/import-month.py 2025-06
    python3 utils/import-month.py
    npm run import:month -- 2025-06
"""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CONVERTER = Path(__file__).with_name("csv_to_monthly_sql.py").resolve()
KV_CACHE_FILE = Path(__file__).with_name("kv.csv").resolve()
S3_BUCKET_URL = "https://s3.amazonaws.com/baywheels-data"


def normalize_month(value: str) -> str:
    month = value.replace("-", "")
    if not re.fullmatch(r"\d{6}", month):
        raise argparse.ArgumentTypeError("month must be YYYY-MM or YYYYMM")
    year = int(month[:4])
    month_number = int(month[4:])
    if not 1 <= month_number <= 12:
        raise argparse.ArgumentTypeError("month must contain a valid month")
    if year < 2010 or year > 2100:
        raise argparse.ArgumentTypeError("month must contain a valid year")
    return month


def list_source_keys() -> list[tuple[str, str]]:
    print("Listing Bay Wheels source files...")
    with urllib.request.urlopen(S3_BUCKET_URL, timeout=30) as response:
        listing = response.read().decode("utf-8")

    keys = re.findall(r"<Key>([^<]+)</Key>", listing)
    matches = []
    for key in keys:
        match = re.fullmatch(r"(\d{6})-baywhee+ls-tripdata(?:\.csv)?\.zip", key)
        if match:
            matches.append((match.group(1), key))
    return sorted(matches)


def find_source_key(month: str, source_keys: list[tuple[str, str]]) -> str:
    for source_month, key in source_keys:
        if source_month == month:
            return key
    raise RuntimeError(f"No Bay Wheels ZIP found for {month[:4]}-{month[4:]}")


def download_and_extract(key: str, destination: Path) -> Path:
    archive = destination / key
    url = f"{S3_BUCKET_URL}/{key}"
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, archive)

    extract_dir = destination / "data"
    extract_dir.mkdir()
    print(f"Extracting {archive.name}")
    with zipfile.ZipFile(archive) as zip_file:
        csv_members = [name for name in zip_file.namelist() if name.lower().endswith(".csv")]
        if not csv_members:
            raise RuntimeError(f"No CSV file found inside {key}")
        for member in csv_members:
            source_name = Path(member).name
            with zip_file.open(member) as source, (extract_dir / source_name).open("wb") as target:
                shutil.copyfileobj(source, target)

    # The Bay Wheels archive can contain Windows-1252 CSV bytes. The existing
    # converter intentionally reads UTF-8, so normalize only the temporary copy
    # created by this standalone importer and leave the converter untouched.
    for csv_path in extract_dir.glob("*.csv"):
        raw = csv_path.read_bytes()
        for encoding in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                text = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise RuntimeError(f"Could not decode downloaded CSV: {csv_path.name}")
        csv_path.write_text(text, encoding="utf-8", newline="")

    return extract_dir


def run_converter(data_dir: Path, work_dir: Path, month: str) -> Path:
    # The converter resolves data/ and kv.csv relative to its working directory.
    # Keep the large, persistent pair cache in the repository, but give the
    # temporary conversion workspace a copy so a failed run cannot truncate it.
    if KV_CACHE_FILE.exists():
        shutil.copy2(KV_CACHE_FILE, work_dir / "kv.csv")

    print("Running the existing csv_to_monthly_sql.py converter...")
    subprocess.run(
        [sys.executable, str(CONVERTER)],
        cwd=work_dir,
        check=True,
    )

    sql_dir = work_dir / "seeds_by_month_csv"
    create_tables = sql_dir / "00_create_tables.sql"
    month_sql = sql_dir / f"rides_{month}.sql"
    if not create_tables.exists():
        raise RuntimeError("Converter did not create 00_create_tables.sql")
    if not month_sql.exists():
        raise RuntimeError(f"Converter did not create {month_sql.name}")

    converted_cache = work_dir / "kv.csv"
    if converted_cache.exists():
        converted_cache.replace(KV_CACHE_FILE)
    return month_sql


def apply_to_d1(create_tables: Path, month_sql: Path) -> None:
    def execute(sql_file: Path) -> None:
        print(f"Applying {sql_file.name} to remote D1...")
        subprocess.run(
            [
                "npx",
                "wrangler",
                "d1",
                "execute",
                "baywheels",
                "--remote",
                "--file",
                str(sql_file),
                "--yes",
            ],
            cwd=REPO_ROOT,
            check=True,
        )

    execute(create_tables)
    execute(month_sql)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "month",
        nargs="?",
        type=normalize_month,
        help="Month to import: YYYY-MM or YYYYMM. Omit to import every available month.",
    )
    args = parser.parse_args()

    source_keys = list_source_keys()
    if args.month:
        months_to_import = [(args.month, find_source_key(args.month, source_keys))]
    else:
        months_to_import = source_keys

    if not months_to_import:
        raise RuntimeError("No Bay Wheels monthly ZIP files were found")

    print(f"Found {len(months_to_import)} month(s) to import")
    for index, (month, source_key) in enumerate(months_to_import, 1):
        print(f"\n=== [{index}/{len(months_to_import)}] Importing {month[:4]}-{month[4:]} ===")
        with tempfile.TemporaryDirectory(prefix=f"baywheelin-{month}-") as temp:
            work_dir = Path(temp)
            data_dir = download_and_extract(source_key, work_dir)
            month_sql = run_converter(data_dir, work_dir, month)
            apply_to_d1(work_dir / "seeds_by_month_csv" / "00_create_tables.sql", month_sql)

    print(f"Imported {len(months_to_import)} month(s) into remote D1.")


if __name__ == "__main__":
    main()
