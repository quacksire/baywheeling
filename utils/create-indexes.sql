-- Create indexes after data is loaded (to avoid memory issues during bulk insert)
CREATE INDEX IF NOT EXISTS idx_rides_start_station_started_at ON rides(start_station_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_end_station_started_at ON rides(end_station_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_polyline_null ON rides(route_polyline) WHERE route_polyline IS NULL;
