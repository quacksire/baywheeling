CREATE TABLE IF NOT EXISTS rides (
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
)
