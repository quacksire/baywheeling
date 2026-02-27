#!/usr/bin/env python3
"""
Reorganize seed files to create separate INSERT statements per year-month table.
Transforms: INSERT INTO "rides" ... to INSERT INTO "rides_2025_09" ...
"""

import os
import re
from pathlib import Path
from collections import defaultdict

def extract_date_from_insert(insert_line):
    """Extract the date from an INSERT statement."""
    # Look for 'started_at' value in format YYYY-MM-DD
    match = re.search(r"'(\d{4}-\d{2}-\d{2})", insert_line)
    if match:
        date_str = match.group(1)
        year_month = date_str[:7]  # YYYY-MM
        return year_month
    return None

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

def reorganize_seeds(seeds_dir="seeds", output_dir="seeds_by_month"):
    """Read all seed files and reorganize by year-month."""
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Group INSERTs by month
    monthly_inserts = defaultdict(list)
    
    # Process all seed files
    seed_files = sorted(Path(seeds_dir).glob("all_rides_part_*.sql"))
    print(f"Found {len(seed_files)} seed files")
    
    for idx, filename in enumerate(seed_files, 1):
        print(f"[{idx}/{len(seed_files)}] Processing {filename.name}...")
        
        with open(filename, 'r') as f:
            for line in f:
                # Skip comments
                if line.strip().startswith('--'):
                    continue
                    
                if 'INSERT INTO' in line and 'rides' in line:
                    year_month = extract_date_from_insert(line)
                    if year_month:
                        # Transform table name
                        transformed_line = line.replace('INSERT INTO "rides"', f'INSERT INTO "rides_{year_month}"')
                        monthly_inserts[year_month].append(transformed_line)
    
    # Create table creation file (run once before seeds)
    init_file = Path(output_dir) / "00_create_tables.sql"
    with open(init_file, 'w') as f:
        f.write("-- Create all monthly ride tables\n")
        for year_month in sorted(monthly_inserts.keys()):
            table_name = f"rides_{year_month}"
            schema = get_table_schema().format(table_name=table_name)
            f.write(f"\n{schema}\n")
    print(f"  Created {init_file.name}")
    
    # Write monthly data files (no CREATE TABLE)
    for year_month in sorted(monthly_inserts.keys()):
        output_file = Path(output_dir) / f"rides_{year_month}.sql"
        with open(output_file, 'w') as f:
            f.write(f"-- Data for {year_month}\n")
            for insert in monthly_inserts[year_month]:
                f.write(insert)
        
        print(f"  Created {output_file.name} with {len(monthly_inserts[year_month])} rows")
    
    # Create a summary file listing all months
    summary_file = Path(output_dir) / "_months.txt"
    with open(summary_file, 'w') as f:
        for year_month in sorted(monthly_inserts.keys()):
            f.write(f"{year_month}\n")
    
    print(f"\nReorganization complete! {len(monthly_inserts)} months found:")
    for year_month in sorted(monthly_inserts.keys()):
        print(f"  {year_month}: {len(monthly_inserts[year_month])} rows")

if __name__ == "__main__":
    reorganize_seeds()
