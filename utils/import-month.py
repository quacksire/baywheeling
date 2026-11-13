#!/usr/bin/env python3
"""Import Bay Wheels archives as compact station/month data in Cloudflare KV.

Usage:
    python3 utils/import-month.py 2018-02 2018-03
    python3 utils/import-month.py 2017
    python3 utils/import-month.py

Ride rows are streamed from the archive CSV and discarded after station stats
and origin/destination counts have been written to KV.
"""

import argparse
import importlib.util
import re
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

from month_stats import month_stats_from_csv


REPO_ROOT = Path(__file__).resolve().parents[1]
STATS_CACHE_SCRIPT = Path(__file__).with_name("cache-month-stats.py").resolve()
S3_BUCKET_URL = "https://s3.amazonaws.com/baywheels-data"


def normalize_period(value: str) -> str:
    period = value.replace("-", "")
    if re.fullmatch(r"\d{4}", period) and 2010 <= int(period) <= 2100:
        return period
    if not re.fullmatch(r"\d{6}", period) or not 1 <= int(period[4:]) <= 12:
        raise argparse.ArgumentTypeError("period must be YYYY-MM, YYYYMM, or an archive year")
    if int(period[:4]) < 2010 or int(period[:4]) > 2100:
        raise argparse.ArgumentTypeError("period must contain a valid year")
    return period


def list_source_keys() -> list[tuple[str, str]]:
    print("Listing Bay Wheels source files...")
    with urllib.request.urlopen(S3_BUCKET_URL, timeout=30) as response:
        listing = response.read().decode("utf-8")

    keys = re.findall(r"<Key>([^<]+)</Key>", listing)
    matches = []
    for key in keys:
        match = re.fullmatch(
            r"(\d{6})-(?:baywhee+ls|fordgobike)-tripdata(?:\.csv)?\.zip",
            key,
        )
        if not match:
            match = re.fullmatch(r"(\d{4})-fordgobike-tripdata(?:\.csv)?\.zip", key)
        if match:
            matches.append((match.group(1), key))
    return sorted(matches)


def find_source_key(period: str, source_keys: list[tuple[str, str]]) -> str:
    for source_period, key in source_keys:
        if source_period == period:
            return key
    raise RuntimeError(f"No Bay Wheels ZIP found for {period}")


def download_and_extract(key: str, destination: Path) -> list[Path]:
    archive = destination / key
    url = f"{S3_BUCKET_URL}/{key}"
    print(f"Downloading {url}")
    for attempt in range(1, 6):
        try:
            offset = archive.stat().st_size if archive.exists() else 0
            request = urllib.request.Request(
                url,
                headers={"Range": f"bytes={offset}-"} if offset else {},
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                resumed = offset > 0 and response.status == 206
                mode = "ab" if resumed else "wb"
                start = offset if resumed else 0
                expected = response.headers.get("Content-Length")
                expected_size = start + int(expected) if expected else None
                downloaded = start
                next_report = downloaded + 32 * 1024 * 1024
                with archive.open(mode) as target:
                    while chunk := response.read(1024 * 1024):
                        target.write(chunk)
                        downloaded += len(chunk)
                        if downloaded >= next_report:
                            print(f"Downloaded {downloaded / (1024 * 1024):.0f} MB...")
                            next_report = downloaded + 32 * 1024 * 1024
                if expected_size is not None and downloaded != expected_size:
                    raise OSError(
                        f"Incomplete download: received {downloaded} of {expected_size} bytes"
                    )
            break
        except Exception:
            if attempt == 5:
                raise
            delay = 2 ** attempt
            print(f"Download attempt {attempt} failed; resuming in {delay}s...")
            time.sleep(delay)

    extract_dir = destination / "data"
    extract_dir.mkdir()
    print(f"Extracting {archive.name}")
    with zipfile.ZipFile(archive) as zip_file:
        csv_members = [
            name for name in zip_file.namelist()
            if name.lower().endswith(".csv")
            and not Path(name).name.startswith("._")
            and "__MACOSX" not in Path(name).parts
        ]
        if not csv_members:
            raise RuntimeError(f"No CSV file found inside {key}")
        csv_files = []
        for member in csv_members:
            csv_path = extract_dir / Path(member).name
            with zip_file.open(member) as source, csv_path.open("wb") as target:
                shutil.copyfileobj(source, target)
            raw = csv_path.read_bytes()
            for encoding in ("utf-8-sig", "cp1252", "latin-1"):
                try:
                    text = raw.decode(encoding)
                    break
                except UnicodeDecodeError:
                    continue
            else:
                raise RuntimeError(f"Could not decode downloaded CSV: {csv_path.name}")
            with csv_path.open("w", encoding="utf-8", newline="") as normalized_csv:
                normalized_csv.write(text)
            csv_files.append(csv_path)
    return csv_files


def load_stats_cache_module():
    spec = importlib.util.spec_from_file_location("baywheelin_stats_cache", STATS_CACHE_SCRIPT)
    if not spec or not spec.loader:
        raise RuntimeError(f"Could not load {STATS_CACHE_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def import_archive(period: str, key: str, stats_cache) -> None:
    with tempfile.TemporaryDirectory(prefix=f"baywheelin-{period}-") as temp:
        csv_files = download_and_extract(key, Path(temp))
        months = month_stats_from_csv(
            csv_files,
            month_override=period if len(period) == 6 else None,
        )
        if not months:
            raise RuntimeError(f"No station/month data found in {key}")

        if len(period) == 4 and any(not month.startswith(period) for month in months):
            raise RuntimeError(f"Annual archive {key} contains dates outside {period}")

        for month, stats in sorted(months.items()):
            print(f"Writing compact stats and {sum(len(s['routeCounts']) for s in stats.values())} route counts for {month[:4]}-{month[4:]}...")
            stats_cache.upload_month(month, stats_cache.kv_entries(month, stats))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "periods",
        nargs="*",
        type=normalize_period,
        help="Month (YYYY-MM) or the yearly archive (2017). Omit to process all source archives.",
    )
    args = parser.parse_args()

    source_keys = list_source_keys()
    if args.periods:
        archives = [
            (period, find_source_key(period, source_keys))
            for period in dict.fromkeys(args.periods)
        ]
    else:
        archives = source_keys
    if not archives:
        raise RuntimeError("No Bay Wheels archives found")

    stats_cache = load_stats_cache_module()
    print(f"Found {len(archives)} archive(s) to summarize")
    failed = []
    for index, (period, key) in enumerate(archives, 1):
        label = f"{period[:4]}-{period[4:]}" if len(period) == 6 else period
        print(f"\n=== [{index}/{len(archives)}] Summarizing {label} ===")
        try:
            import_archive(period, key, stats_cache)
        except Exception as error:
            failed.append((label, str(error)))
            print(f"FAILED {label}: {error}", file=sys.stderr)

    if failed:
        print("Failed archives:", file=sys.stderr)
        for label, error in failed:
            print(f"  {label}: {error}", file=sys.stderr)
        raise SystemExit(1)
    print(f"Summarized {len(archives)} archive(s) into KV.")


if __name__ == "__main__":
    main()
