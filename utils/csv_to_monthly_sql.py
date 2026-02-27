#!/usr/bin/env python3
"""
Convert CSV files to SQL organized by year-month.
Reads from utils/data/*.csv and creates seeds_by_month/*.sql
"""

import csv
import os
from pathlib import Path
from collections import defaultdict

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

def csv_to_sql(csv_file):
    """Convert a single CSV file to SQL INSERT statements."""
    inserts = defaultdict(list)
    
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        for row in reader:
            # Extract year-month from started_at (format: YYYY-MM-DD HH:MM:SS)
            started_at = row.get('started_at', '')
            if not started_at or len(started_at) < 7:
                continue
            
            year_month = started_at[:7].replace('-', '')  # YYYYMM
            
            # Build INSERT statement with quoted column names
            columns = [
                'ride_id', 'rideable_type', 'started_at', 'ended_at',
                'start_station_name', 'start_station_id', 'end_station_name', 'end_station_id',
                'start_lat', 'start_lng', 'end_lat', 'end_lng', 'member_casual', 'route_polyline'
            ]
            
            values = []
            for col in columns:
                val = row.get(col, '')
                # Handle NULL values
                if val == '' or val is None:
                    values.append('NULL')
                else:
                    # Escape single quotes
                    val = val.replace("'", "''")
                    values.append(f"'{val}'")
            
            values_str = ', '.join(values)
            table_name = f"rides_{year_month}"
            insert_stmt = f"INSERT INTO \"{table_name}\" ({', '.join([f'\"{col}\"' for col in columns])}) VALUES ({values_str});\n"
            
            inserts[year_month].append(insert_stmt)
    
    return inserts

def main():
    data_dir = Path("data")
    output_dir = Path("seeds_by_month_csv")
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Collect all inserts by month
    monthly_inserts = defaultdict(list)
    
    csv_files = sorted(data_dir.glob("*-baywheels-tripdata.csv"))
    print(f"Found {len(csv_files)} CSV files")
    
    for idx, csv_file in enumerate(csv_files, 1):
        print(f"[{idx}/{len(csv_files)}] Processing {csv_file.name}...")
        
        inserts = csv_to_sql(csv_file)
        for month, stmts in inserts.items():
            monthly_inserts[month].extend(stmts)
    
    # Create table creation file
    init_file = output_dir / "00_create_tables.sql"
    with open(init_file, 'w') as f:
        f.write("-- Create all monthly ride tables\n")
        for year_month in sorted(monthly_inserts.keys()):
            table_name = f"rides_{year_month}"
            schema = get_table_schema().format(table_name=table_name)
            f.write(f"\n{schema}\n")
    print(f"  Created {init_file.name}")
    
    # Write monthly data files
    for year_month in sorted(monthly_inserts.keys()):
        output_file = output_dir / f"rides_{year_month}.sql"
        with open(output_file, 'w') as f:
            f.write(f"-- Data for {year_month}\n")
            for insert in monthly_inserts[year_month]:
                f.write(insert)
        
        print(f"  Created {output_file.name} with {len(monthly_inserts[year_month])} rows")
    
    # Create summary
    summary_file = output_dir / "_months.txt"
    with open(summary_file, 'w') as f:
        for year_month in sorted(monthly_inserts.keys()):
            f.write(f"{year_month}\n")
    
    print(f"\nConversion complete! {len(monthly_inserts)} months found:")
    for year_month in sorted(monthly_inserts.keys()):
        print(f"  {year_month}: {len(monthly_inserts[year_month])} rows")

if __name__ == "__main__":
    main()
