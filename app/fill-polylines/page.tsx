'use client';

import { useState, useCallback, useRef } from 'react';
import * as station_data from '../../data/baywheels_station_information.json'
import { Button } from '@/components/ui/button';

interface Ride {
  ride_id: string;
  started_at: string;
  start_station_id: string;
  end_station_id: string;
  route_polyline: string | null;
}

interface StationCoordinates {
  lat: number;
  lon: number;
}

interface StationInfo {
  [key: string]: StationCoordinates;
}

interface Station {
  station_id: string;
  short_name: string;
  lat: number;
  lon: number;
}

interface StationDataFile {
  data: {
    stations: Station[];
  };
}

interface RouteResponse {
  routes: Array<{
    geometry: string;
    duration: number;
    distance: number;
  }>;
}

interface RideStatus {
  ride_id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
}

export default function FillPolylines() {
  const [status, setStatus] = useState<string>('Idle');
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const [isCaching, setIsCaching] = useState(false);
  const [cachingProgress, setCachingProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [allRideStatuses, setAllRideStatuses] = useState<RideStatus[]>([]);
  const [totalRides, setTotalRides] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadStationCoordinates = useCallback(async (): Promise<StationInfo> => {
    const data = station_data as StationDataFile;

    const stationInfo: StationInfo = {};
    data.data.stations.forEach((station: Station) => {
      // Use short_name as the key since that matches the database
      stationInfo[station.short_name] = {
        lat: station.lat,
        lon: station.lon,
      };
    });

    return stationInfo;
  }, []);

  const fetchRidesToFill = useCallback(async (): Promise<Ride[]> => {
    const response = await fetch('/api/rides-to-fill');
    if (!response.ok) throw new Error('Failed to fetch rides');
    const data = await response.json() as { success?: boolean; results?: Ride[] };
    console.log('Rides API response:', data);
    const rides = data.results || [];
    console.log('Parsed rides:', rides.length, 'Sample:', rides.slice(0, 3));
    return rides;
  }, []);

  const fillPolylines = useCallback(async (): Promise<void> => {
    if (isRunning) return;

    setIsRunning(true);
    setError(null);
    abortControllerRef.current = new AbortController();
    const batchSize = 100;

    try {
      setStatus('Loading station coordinates...');
      const stationInfo = await loadStationCoordinates();

      let totalProcessed = 0;
      let hasMoreRides = true;

      while (hasMoreRides && !abortControllerRef.current?.signal.aborted) {
        setStatus('Fetching rides without polylines...');
        const rides = await fetchRidesToFill();

        if (rides.length === 0) {
          hasMoreRides = false;
          break;
        }

        setTotalRides(totalProcessed + rides.length);

        // Shuffle rides for random display order
        const displayRides = [...rides].sort(() => Math.random() - 0.5);
        // Shuffle rides again for random processing order (different from display)
        const processRides = [...rides].sort(() => Math.random() - 0.5);

        // Initialize all rides with pending status in display order
        setAllRideStatuses(displayRides.map(ride => ({ ride_id: ride.ride_id, status: 'pending' })));
        setProgress({ current: totalProcessed, total: totalProcessed + rides.length });

        // Helper function to process a single ride
        const processRide = async (ride: Ride): Promise<void> => {
          const updateStatus = (newStatus: RideStatus['status']): void => {
            setAllRideStatuses(prev =>
              prev.map(r => r.ride_id === ride.ride_id ? { ...r, status: newStatus } : r)
            );
          };

          updateStatus('processing');

          const startStation = stationInfo[ride.start_station_id];
          const endStation = stationInfo[ride.end_station_id];

          if (!startStation || !endStation) {
            console.warn(`Skipping ride ${ride.ride_id} - station coordinates not found`);
            updateStatus('error');
            return;
          }

          try {
            // Fetch and save polyline directly (no D1 read check)
            const saveResponse = await fetch('/api/save-polyline', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ride_id: ride.ride_id,
                start_lon: startStation.lon,
                start_lat: startStation.lat,
                end_lon: endStation.lon,
                end_lat: endStation.lat,
                start_station_id: ride.start_station_id,
                end_station_id: ride.end_station_id
              }),
              signal: abortControllerRef.current?.signal
            });

            if (!saveResponse.ok) {
              console.warn(`Error saving polyline for ride ${ride.ride_id}: ${saveResponse.status}`);
              updateStatus('error');
              return;
            }

            updateStatus('done');
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
              throw err;
            }
            console.warn(
              `Error processing ride ${ride.ride_id}: ${err instanceof Error ? err.message : 'Unknown error'}`
            );
            updateStatus('error');
          }
        };

        // Process rides with a queue of concurrent requests
        let rideIndex = 0;
        let processedCount = 0;
        const activePromises = new Set<Promise<void>>();

        const startNextRide = async (): Promise<void> => {
          if (rideIndex >= processRides.length || abortControllerRef.current?.signal.aborted) {
            return;
          }

          const ride = processRides[rideIndex];
          rideIndex++;

          const promise = processRide(ride)
            .then(() => {
              activePromises.delete(promise);
              processedCount++;
              setProgress({ current: totalProcessed + processedCount, total: totalProcessed + processRides.length });
            })
            .catch((err) => {
              activePromises.delete(promise);
              processedCount++;
              if (!(err instanceof Error && err.name === 'AbortError')) {
                setProgress({ current: totalProcessed + processedCount, total: totalProcessed + processRides.length });
              }
            });

          activePromises.add(promise);

          // When a request finishes, immediately start the next one
          await promise;
          if (rideIndex < processRides.length) {
            await startNextRide();
          }
        };

        // Start batchSize concurrent requests
        const initialRequests = [];
        for (let i = 0; i < Math.min(batchSize, processRides.length); i++) {
          initialRequests.push(startNextRide());
        }

        // Wait for all to complete
        await Promise.all(initialRequests);

        totalProcessed += rides.length;
      }

      if (!abortControllerRef.current?.signal.aborted) {
        setStatus(`Completed! Processed ${totalProcessed} rides`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      setStatus(`Error: ${errorMsg}`);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, loadStationCoordinates, fetchRidesToFill]);

  const handleStop = (): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsRunning(false);
      setStatus('Stopping...');
    }
  };

  const handleCacheRoutes = async (): Promise<void> => {
    setIsCaching(true);
    setCachingProgress({ current: 0, total: 0 });
    setStatus('Pre-caching existing routes...');
    
    try {
      const response = await fetch('/api/cache-routes', {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error('Failed to cache routes');
      }
      
      // Use streaming to get progress updates
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('No response body');
      }
      
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line) as { current?: number; total?: number; success?: boolean; cached?: number };
              if (data.current !== undefined && data.total !== undefined) {
                setCachingProgress({ current: data.current, total: data.total });
              }
              if (data.success) {
                setStatus(`✓ Cached ${data.cached} routes (${data.total} total)`);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
      
      setIsCaching(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      setStatus(`Error: ${errorMsg}`);
      setIsCaching(false);
    }
  };



  const progressPercent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-background font-mono text-xs">
      {/* Header */}
      <div className="border-b border-border px-4 py-2">
        <div className="text-foreground font-bold">fill-polylines</div>
        {totalRides !== null && (
          <div className="text-muted-foreground text-xs mt-1">
            total: {totalRides.toLocaleString()} | completed: {progress.current.toLocaleString()} | {progressPercent}%
          </div>
        )}
      </div>

      {/* Status Line */}
      <div className="border-b border-border px-4 py-1 text-muted-foreground">{status}</div>

      {/* Caching Progress Bar */}
      {isCaching && cachingProgress.total > 0 && (
        <div className="border-b border-border px-4 py-1">
          <div className="flex gap-1">
            <div className="w-24">
              [{Math.round((cachingProgress.current / cachingProgress.total) * 100).toString().padStart(3)}%]
            </div>
            <div className="flex-1 bg-muted">
              <div className="bg-blue-500 h-full" style={{ width: `${(cachingProgress.current / cachingProgress.total) * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {totalRides !== null && totalRides > 0 && (
        <div className="border-b border-border px-4 py-1">
          <div className="flex gap-1">
            <div className="w-24">
              [{progressPercent.toString().padStart(3)}%]
            </div>
            <div className="flex-1 bg-muted">
              <div className="bg-primary h-full" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Ride Status List */}
      {allRideStatuses.length > 0 && (
        <div className="flex-1 overflow-hidden flex flex-col border-b border-border">
          <div className="px-4 py-1 border-b border-border text-muted-foreground bg-muted/30">rides ({allRideStatuses.length})</div>
          <div className="flex-1 overflow-auto px-4 py-1">
            <div className="flex flex-wrap gap-2 content-start">
              {allRideStatuses.map((rideStatus) => (
                <div key={rideStatus.ride_id} className="flex items-center gap-1 text-foreground text-xs whitespace-nowrap">
                  <span className="w-1 text-mono">
                    {rideStatus.status === 'done' && <span className="font-bold">●</span>}
                    {rideStatus.status === 'processing' && <span className="animate-pulse">○</span>}
                    {rideStatus.status === 'pending' && <span className="text-muted-foreground"></span>}
                    {rideStatus.status === 'error' && <span className="text-red-500">⊝</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="border-b border-border px-4 py-1 text-red-500">
          error: {error}
        </div>
      )}

      {/* Controls Footer */}
      <div className="border-t border-border px-4 py-2 flex gap-2">
        <Button
          onClick={fillPolylines}
          disabled={isRunning}
          size="xs"
          className="px-3"
        >
          start
        </Button>
        <Button
          onClick={handleStop}
          disabled={!isRunning}
          variant="destructive"
          size="xs"
          className="px-3"
        >
          stop
        </Button>
        <Button
          onClick={handleCacheRoutes}
          disabled={isRunning || isCaching}
          variant="secondary"
          size="xs"
          className="px-3"
        >
          {isCaching && cachingProgress.total > 0
            ? `caching... ${Math.round((cachingProgress.current / cachingProgress.total) * 100)}%`
            : 'pre-cache routes'}
        </Button>
        <Button
          onClick={async () => {
            setStatus('Caching stations...');
            try {
              const res = await fetch('/api/cache-stations', { method: 'POST' });
              const data = await res.json() as { cached: number };
              setStatus(`✓ Cached ${data.cached} stations`);
            } catch (err) {
              setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
            }
          }}
          disabled={isRunning || isCaching}
          variant="secondary"
          size="xs"
          className="px-3"
        >
          cache stations
        </Button>
      </div>
    </div>
  );
}
