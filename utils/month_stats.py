"""Build compact station/month stats and route counts directly from trip CSVs."""

import csv
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from csv_to_monthly_sql import normalize_row


def parse_timestamp(value):
    if not value:
        return None
    try:
        timestamp = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp


def parse_coordinate(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def empty_station_stats():
    return {
        "total_rides": 0,
        "member_count": 0,
        "casual_count": 0,
        "false_starts": 0,
        "avg_ride_seconds": None,
        "longest_ride_seconds": None,
        "rideableTypes": Counter(),
        "dayOfWeek": Counter(),
        "destinations": Counter(),
        "busiestHours": Counter(),
        "routeCounts": {},
        "duration_sum": 0.0,
        "duration_count": 0,
    }


def month_stats_from_csv(csv_files, month_override=None):
    """Summarize CSV rows, optionally assigning a rolling archive to its YYYYMM label."""
    months = defaultdict(dict)
    source_months = set()

    for csv_file in csv_files:
        with Path(csv_file).open(encoding="utf-8", newline="") as source:
            for raw_row in csv.DictReader(source):
                row = normalize_row(raw_row)
                started_at = str(row.get("started_at") or "")
                month_match = re.match(r"^(\d{4})-(\d{2})", started_at)
                if not month_match:
                    continue
                source_month = "".join(month_match.groups())
                station_id = str(row.get("start_station_id") or "").strip()
                if not station_id:
                    continue
                source_months.add(source_month)
                month = month_override or source_month

                station_stats = months[month].setdefault(station_id, empty_station_stats())
                station_stats["total_rides"] += 1
                member_type = str(row.get("member_casual") or "").strip().lower()
                if member_type == "member":
                    station_stats["member_count"] += 1
                elif member_type == "casual":
                    station_stats["casual_count"] += 1

                end_station_id = str(row.get("end_station_id") or "").strip()
                end_station_name = str(row.get("end_station_name") or "").strip() or None
                if end_station_id and end_station_id == station_id:
                    station_stats["false_starts"] += 1
                rideable_type = str(row.get("rideable_type") or "").strip() or None
                station_stats["rideableTypes"][rideable_type] += 1
                station_stats["destinations"][end_station_name] += 1

                started = parse_timestamp(started_at)
                if started:
                    station_stats["dayOfWeek"][str((started.weekday() + 1) % 7)] += 1
                    station_stats["busiestHours"][f"{started.hour:02d}"] += 1

                ended = parse_timestamp(row.get("ended_at"))
                if started and ended:
                    duration = (ended - started).total_seconds()
                    if duration > 0:
                        station_stats["duration_sum"] += duration
                        station_stats["duration_count"] += 1
                        longest = station_stats["longest_ride_seconds"]
                        station_stats["longest_ride_seconds"] = max(longest or 0, round(duration))

                if end_station_id:
                    routes = station_stats["routeCounts"]
                    route = routes.setdefault(end_station_id, {
                        "end_station_id": end_station_id,
                        "end_station_name": end_station_name,
                        "start_lat": parse_coordinate(row.get("start_lat")),
                        "start_lng": parse_coordinate(row.get("start_lng")),
                        "end_lat": parse_coordinate(row.get("end_lat")),
                        "end_lng": parse_coordinate(row.get("end_lng")),
                        "ride_count": 0,
                    })
                    route["ride_count"] += 1
                    if not route["end_station_name"] and end_station_name:
                        route["end_station_name"] = end_station_name
                    for coordinate in ("start_lat", "start_lng", "end_lat", "end_lng"):
                        if route[coordinate] is None:
                            route[coordinate] = parse_coordinate(row.get(coordinate))

    if month_override and month_override not in source_months:
        found = ", ".join(sorted(source_months))
        raise ValueError(f"Expected archive month {month_override}, but CSV dates contain: {found}")

    finalized = {}
    for month, stations in months.items():
        finalized[month] = {}
        for station_id, stats in stations.items():
            duration_count = stats.pop("duration_count")
            duration_sum = stats.pop("duration_sum")
            if duration_count:
                stats["avg_ride_seconds"] = round(duration_sum / duration_count)

            for key in ("rideableTypes", "dayOfWeek", "destinations", "busiestHours"):
                counter = stats[key]
                ordered = sorted(counter.items(), key=lambda item: (-item[1], str(item[0])))
                if key == "destinations":
                    ordered = ordered[:5]
                    stats[key] = [
                        {"end_station_name": name, "count": count}
                        for name, count in ordered
                    ]
                elif key == "rideableTypes":
                    stats[key] = [
                        {"rideable_type": name, "count": count}
                        for name, count in ordered
                    ]
                elif key == "dayOfWeek":
                    stats[key] = [
                        {"day_num": day, "count": count}
                        for day, count in sorted(ordered, key=lambda item: int(item[0]))
                    ]
                else:
                    stats[key] = [
                        {"hour": hour, "count": count}
                        for hour, count in sorted(ordered, key=lambda item: int(item[0]))
                    ]

            stats["routeCounts"] = sorted(
                stats["routeCounts"].values(),
                key=lambda route: (-route["ride_count"], route["end_station_id"]),
            )
            finalized[month][station_id] = stats

    return finalized
