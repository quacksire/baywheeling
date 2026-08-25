'use client'
import * as baywheelStations from "@/data/baywheels_station_information.json"
import {gbfsStationInfoToGeoJSON} from "@/utils/gbfsStationInfoToGeoJSON";
import { polyline } from "@/lib/polyline";
import { Layers, X, Loader2, Clock, Route, ChevronUp, ChevronDown, Link } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useId } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useMap, MapPopup, MapMarker, MarkerContent, MarkerLabel } from "@/components/ui/map";
import { DeckGLRoutes } from "@/components/deck-gl-routes";
import { StationInfoContent } from "@/components/station-info-content";
import { Drawer, DrawerTrigger, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { AboutInfo, type ImportProgress } from "@/components/about-info";

interface Ride {
    ride_id: string;
    rideable_type: string;
    started_at: string;
    start_station_name?: string;
    end_station_name: string;
    start_station_id?: string;
    end_station_id?: string;
    route_polyline?: string | null;
}

interface RouteData {
    coordinates: [number, number][];
    duration: number;
    distance: number;
}

interface CachedRoute {
    routeKey: string; // start_station_id:end_station_id
    coordinates: [number, number][];
    duration: number;
    distance: number;
    endStationName: string;
    rideCount: number; // Number of rides using this route
}

interface StationStats {
    total_rides: number;
    member_count: number;
    casual_count: number;
    false_starts: number;
    rideableTypes: Array<{ rideable_type: string; count: number }>;
    dayOfWeek: Array<{ day_num: string; count: number }>;
    destinations: Array<{ end_station_name: string; count: number }>;
    busiestHours: Array<{ hour: string; count: number }>;
}

interface StationInfo {
    [key: string]: {
        lat: number;
        lon: number;
        name: string;
    };
}

interface SelectedPoint {
    id: string;
    name: string;
    coordinates: [number, number];
    [key: string]: any;
}

interface ImporterJob {
    month: string;
    status: string;
    started_at?: string | null;
    import_complete?: number | null;
    total_rows: number;
    imported_rows: number;
    routed_rows: number;
    routes_processed?: number;
    routes_total?: number;
    routes_mapped?: number;
    routes_per_second?: number | null;
    eta_seconds?: number | null;
}

interface ImportMonthStatus {
    month: string;
    status: string;
}

interface ImportRateSample {
    label: string;
    routesProcessed: number;
    seenAt: number;
}

const IMPORT_RATE_WINDOW_MS = 60_000;

const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

function formatYearMonth(yearMonth: string) {
    const normalized = yearMonth.includes('-')
        ? yearMonth
        : `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}`;
    const [year, month] = normalized.split('-');
    return `${monthNames[parseInt(month) - 1]} ${year}`;
}

function formatSpeed(routesPerSecond: number | null | undefined) {
    if (!routesPerSecond || !Number.isFinite(routesPerSecond) || routesPerSecond <= 0) {
        return null;
    }

    return `${routesPerSecond.toFixed(routesPerSecond >= 10 ? 0 : 1)} routes/sec`;
}

function formatRemainingSeconds(seconds: number | null | undefined) {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
        return null;
    }

    const rounded = Math.max(0, Math.round(seconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;

    if (hours > 0) {
        return `${hours}h ${minutes.toString().padStart(2, '0')}m left`;
    }

    if (minutes > 0) {
        return `${minutes}m ${secs.toString().padStart(2, '0')}s left`;
    }

    return `${secs}s left`;
}

function monthIndex(yearMonth: string) {
    const [year, month] = yearMonth.split('-').map((value) => parseInt(value, 10));
    return year * 12 + month;
}

function nearestAvailableMonth(targetMonth: string, availableMonths: string[]) {
    if (!availableMonths.length) return null;
    if (availableMonths.includes(targetMonth)) return targetMonth;

    const targetIndex = monthIndex(targetMonth);
    return [...availableMonths].sort((a, b) => {
        const distance = Math.abs(monthIndex(a) - targetIndex) - Math.abs(monthIndex(b) - targetIndex);
        return distance || monthIndex(a) - monthIndex(b);
    })[0];
}




export function StationLayer() {
     const { map, isLoaded } = useMap();
     const [isMounted, setIsMounted] = useState(false);
     const isDesktop = useMediaQuery("(min-width: 768px)");
    const snapPoints = ['212px', '355px', 1];
    const [snap, setSnap] = useState<number | string | null>(snapPoints[0]);

     const [currentMonth, setCurrentMonth] = useState<{ year: string; month: string } | null>(null);
     const id = useId();
     const sourceId = `station-source-${id}`;
     const layerId = `station-layer-${id}`;
     const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null);
     const [rides, setRides] = useState<Ride[]>([]);
     const [loadingRides, setLoadingRides] = useState(false);
     const [selectedRideIndex, setSelectedRideIndex] = useState(0);
     const [routeData, setRouteData] = useState<RouteData | null>(null);
     const [loadingRoute, setLoadingRoute] = useState(false);
     const [cachedRoutes, setCachedRoutes] = useState<Map<string, CachedRoute>>(new Map());
     const [routesLoading, setRoutesLoading] = useState(0);
     const [routesTotal, setRoutesTotal] = useState(0);
     const [stats, setStats] = useState<StationStats | null>(null);
     const [discoveredMonths, setDiscoveredMonths] = useState<string[]>([]);
     const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
     const [importStatusesByMonth, setImportStatusesByMonth] = useState<Record<string, ImportMonthStatus>>({});
     const [loadingImportProgress, setLoadingImportProgress] = useState(false);
     const lastImportSample = useRef<ImportRateSample | null>(null);
     const importRateSamples = useRef<ImportRateSample[]>([]);
     const [selectedYear, setSelectedYear] = useState<string>('');
     const [selectedMonthNum, setSelectedMonthNum] = useState<string>('');
     const [drawerOpen, setDrawerOpen] = useState(true);
     const latestMonthInitializedStation = useRef<string | null>(null);
     const selectedMonth = selectedYear && selectedMonthNum ? `${selectedYear}-${selectedMonthNum}` : '';
     const selectedMonthImportStatus = importStatusesByMonth[selectedMonth]?.status ?? null;
     const availableMonths = discoveredMonths.filter((month) => {
         const status = importStatusesByMonth[month]?.status;
         return !status || status === 'complete';
     });

     useEffect(() => {
         console.log(selectedPoint);
     }, [selectedPoint])

     // Calculate current month (previous month from today)
      const getCurrentMonth = useCallback(() => {
          const today = new Date();
          const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
          return {
              year: lastMonth.getFullYear().toString(),
              month: (lastMonth.getMonth() + 1).toString().padStart(2, '0')
          };
      }, []);

     const isCurrentMonth = useCallback(() => {
         const latest = availableMonths[availableMonths.length - 1];
         if (!latest) {
             const current = getCurrentMonth();
             return selectedYear === current.year && selectedMonthNum === current.month;
         }
         return selectedMonth === latest;
     }, [availableMonths, selectedMonth, selectedYear, selectedMonthNum, getCurrentMonth]);

     const setSelectedYearMonth = useCallback((yearMonth: string) => {
         if (!/^\d{4}-\d{2}$/.test(yearMonth)) return;
         const [year, month] = yearMonth.split('-');
         setSelectedYear(year);
         setSelectedMonthNum(month);
     }, []);

     const handleMonthChange = (yearMonth: string) => {
         const nextMonth = nearestAvailableMonth(yearMonth, availableMonths);
         if (nextMonth) {
             setSelectedYearMonth(nextMonth);
         }
     };

     const handlePreviousMonth = () => {
         const index = availableMonths.indexOf(selectedMonth);
         if (index > 0) {
             setSelectedYearMonth(availableMonths[index - 1]);
         }
     };

     const handleNextMonth = () => {
         const index = availableMonths.indexOf(selectedMonth);
         if (index >= 0 && index < availableMonths.length - 1) {
             setSelectedYearMonth(availableMonths[index + 1]);
         }
     };
    const [stationMap] = useState<StationInfo>(() => {
        const map: StationInfo = {};
        const stationsData = baywheelStations as { data?: { stations?: Array<{ short_name: string; lat: number; lon: number; name: string }> } };
         if (stationsData.data?.stations) {
             stationsData.data.stations.forEach((station) => {
                // Use short_name as the key (e.g., "SF-J23-2", "SJ-K11")
                map[station.short_name] = {
                    lat: station.lat,
                    lon: station.lon,
                    name: station.name,
                };
            });
        }
        return map;
    });

    useEffect(() => {
        if (!map || !isLoaded) return;

        const geoData = gbfsStationInfoToGeoJSON(baywheelStations as any);
        console.log(geoData);

        map.addSource(sourceId, {
            type: "geojson",
            data: geoData,
        });

        map.addLayer({
            id: layerId,
            type: "circle",
            source: sourceId,
            paint: {
                "circle-radius": 3,
                "circle-color": "#ffffff",
                "circle-stroke-width": 0,
                "circle-stroke-color": "#ffffff",
                // add more paint properties here to customize the appearance of the markers
            },
        });

        const handleClick = (
            e: maplibregl.MapMouseEvent & {
                features?: maplibregl.MapGeoJSONFeature[];
            }
        ) => {
            if (!e.features?.length) return;

            const feature = e.features[0];
            const coords = (feature.geometry as GeoJSON.Point).coordinates as [
                number,
                number
            ];

            setSelectedPoint({
                id: feature.properties?.id,
                name: feature.properties?.name,
                coordinates: coords,
                ...feature.properties
            });
        };

        const handleMouseEnter = () => {
            map.getCanvas().style.cursor = "pointer";
        };

        const handleMouseLeave = () => {
            map.getCanvas().style.cursor = "";
        };

        map.on("click", layerId, handleClick);
        map.on("mouseenter", layerId, handleMouseEnter);
        map.on("mouseleave", layerId, handleMouseLeave);

        return () => {
            map.off("click", layerId, handleClick);
            map.off("mouseenter", layerId, handleMouseEnter);
            map.off("mouseleave", layerId, handleMouseLeave);

            try {
                if (map.getLayer(layerId)) map.removeLayer(layerId);
                if (map.getSource(sourceId)) map.removeSource(sourceId);
            } catch {
                // ignore cleanup errors
            }
        };
    }, [map, isLoaded, sourceId, layerId]);

    useEffect(() => {
        if (!selectedPoint || !map) return;

        // Zoom to selected station only when station first changes, not on month change
        if (selectedMonth) {
            map.flyTo({
                center: [selectedPoint.coordinates[0], selectedPoint.coordinates[1]],
                zoom: 14,
                duration: 1000,
            });
        }
    }, [selectedPoint, map]);

    // Open drawer on mobile when station is selected
    useEffect(() => {
        if (selectedPoint) {
            setDrawerOpen(true);
        }
        if (!isDesktop) {
            setSnap(snapPoints[2]); // Open at middle snap point on mobile
        }
    }, [selectedPoint, isDesktop]);


    const refreshAvailableMonths = useCallback(() => {
        fetch('/api/months')
            .then((res) => res.json())
            .then((data: any) => {
                if (!Array.isArray(data.months)) return;
                const months = data.months
                    .filter((month: unknown): month is string => typeof month === 'string' && /^\d{4}-\d{2}$/.test(month))
                    .sort();
                setDiscoveredMonths(months);
            })
            .catch((error) => {
                console.error('Error fetching available months:', error);
            });
    }, []);

    const refreshImportProgress = useCallback(() => {
        setLoadingImportProgress(true);
        const requestUrl = `/api/importer?ts=${Date.now()}`;
        fetch(requestUrl, { cache: 'no-store' })
            .then((res) => res.json())
            .then((data: any) => {
                const jobs = Array.isArray(data.jobs) ? data.jobs as ImporterJob[] : [];
                setImportStatusesByMonth(
                    Object.fromEntries(
                        jobs.map((job) => [
                            `${job.month.slice(0, 4)}-${job.month.slice(4, 6)}`,
                            { month: job.month, status: job.status },
                        ])
                    )
                );
                const activeJob = jobs.find((job) => job.status === 'running') || null;

                if (!activeJob) {
                    lastImportSample.current = null;
                    importRateSamples.current = [];
                    setImportProgress(null);
                    return;
                }

                const label = formatYearMonth(activeJob.month);
                const importedRows = activeJob.imported_rows || 0;
                const importComplete = Boolean(activeJob.import_complete);
                const routesMapped = activeJob.routes_mapped ?? activeJob.routed_rows ?? 0;
                const routesProcessed = activeJob.routes_processed ?? activeJob.routed_rows ?? routesMapped;
                const rawTotalRows = activeJob.total_rows || 0;
                const totalRows = Math.max(rawTotalRows, importedRows);
                const routesTotal = totalRows;
                const now = Date.now();
                const previousSample = lastImportSample.current;
                const sameLabel = previousSample?.label === label;
                const previousStartedAt = activeJob.started_at ?? null;
                const startedAtMs = activeJob.started_at ? Date.parse(activeJob.started_at) : Number.NaN;
                const elapsedAverageRate = Number.isFinite(startedAtMs) && startedAtMs > 0
                    ? routesProcessed / Math.max(1, (now - startedAtMs) / 1000)
                    : null;
                const backendRate = activeJob.routes_per_second ?? elapsedAverageRate ?? null;

                setImportProgress((previous) => {
                    const sameMonth = previous?.label === label;
                    const restartedRun = Boolean(
                        sameMonth
                        && (
                            (previous?.startedAt ?? null) !== previousStartedAt
                            || importedRows < previous.importedRows
                            || routesProcessed < (previous.routesProcessed ?? previous.routesMapped)
                        )
                    );
                    const preservePrevious = sameMonth && !restartedRun;
                    const previousRoutesProcessed = previous?.routesProcessed ?? previous?.routesMapped ?? 0;
                    if (!preservePrevious) {
                        importRateSamples.current = [];
                    }
                    const sampleHistory = preservePrevious
                        ? importRateSamples.current
                        : [];
                    const safeRoutesProcessed = preservePrevious
                        ? Math.max(previousRoutesProcessed, routesProcessed)
                        : routesProcessed;
                    const nextSample: ImportRateSample = {
                        label,
                        routesProcessed: safeRoutesProcessed,
                        seenAt: now,
                    };
                    const trimmedSamples = [...sampleHistory, nextSample].filter(
                        (sample) => sample.label === label && now - sample.seenAt <= IMPORT_RATE_WINDOW_MS,
                    );
                    const windowStartSample = trimmedSamples[0] ?? nextSample;
                    const windowRoutesDelta = Math.max(0, nextSample.routesProcessed - windowStartSample.routesProcessed);
                    const windowSeconds = Math.max(1, (nextSample.seenAt - windowStartSample.seenAt) / 1000);
                    const rollingRate = windowRoutesDelta > 0 ? windowRoutesDelta / windowSeconds : null;
                    const lockedRoutesTotal = preservePrevious && previous.routesTotal > 0
                        ? Math.max(previous.routesTotal, routesTotal)
                        : routesTotal;
                    const routesPerSecond = rollingRate ?? backendRate;
                    const remainingRoutes = Math.max(0, lockedRoutesTotal - routesProcessed);
                    const computedEta = routesPerSecond && remainingRoutes > 0
                        ? remainingRoutes / routesPerSecond
                        : activeJob.eta_seconds ?? null;
                    const etaSeconds = computedEta;
                    const phase: ImportProgress['phase'] = activeJob.status === 'failed'
                        ? 'failed'
                        : activeJob.status === 'queued'
                            ? 'queued'
                            : importComplete
                                ? 'mapping'
                                : 'importing';
                    const safeRoutesMapped = importComplete
                        ? routesMapped
                        : Math.min(routesMapped, importedRows);

                    const nextProgress = {
                        label,
                        status: activeJob.status,
                        phase,
                        importComplete,
                        importedRows: preservePrevious ? Math.max(previous.importedRows, importedRows) : importedRows,
                        totalRows: preservePrevious ? Math.max(previous.totalRows, totalRows) : totalRows,
                        routesMapped: preservePrevious ? Math.max(previous.routesMapped, safeRoutesMapped) : safeRoutesMapped,
                        routesTotal: lockedRoutesTotal,
                        startedAt: activeJob.started_at ?? (preservePrevious ? previous?.startedAt : null) ?? null,
                        routesPerSecond,
                        etaSeconds,
                        routesProcessed: safeRoutesProcessed,
                    };
                    importRateSamples.current = trimmedSamples;
                    lastImportSample.current = nextSample;
                    return nextProgress;
                });
            })
            .catch((error) => {
                console.error('Error fetching importer status:', error);
            })
            .finally(() => {
                setLoadingImportProgress(false);
            });
    }, []);

    useEffect(() => {
        refreshAvailableMonths();
        refreshImportProgress();
    }, [refreshAvailableMonths, refreshImportProgress]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                refreshAvailableMonths();
                refreshImportProgress();
            }
        };

        const handleFocus = () => {
            refreshAvailableMonths();
            refreshImportProgress();
        };

        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [refreshAvailableMonths, refreshImportProgress]);

    useEffect(() => {
        const interval = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                refreshImportProgress();
            }
        }, 1_000);

        return () => {
            window.clearInterval(interval);
        };
    }, [refreshImportProgress]);

    useEffect(() => {
        if (availableMonths.length && (!selectedMonth || !availableMonths.includes(selectedMonth))) {
            const nextMonth = selectedMonth
                ? nearestAvailableMonth(selectedMonth, availableMonths)
                : availableMonths[availableMonths.length - 1];

            if (nextMonth) {
                setSelectedYearMonth(nextMonth);
            }
        }
    }, [availableMonths, selectedMonth, setSelectedYearMonth]);

    // Reset to latest available month when station is selected
    useEffect(() => {
        const stationKey = selectedPoint?.short_name ?? selectedPoint?.id ?? null;
        if (!stationKey) {
            latestMonthInitializedStation.current = null;
            return;
        }

        if (latestMonthInitializedStation.current === stationKey) {
            return;
        }

        const latest = availableMonths[availableMonths.length - 1];
        if (latest) {
            setSelectedYearMonth(latest);
            latestMonthInitializedStation.current = stationKey;
        }
    }, [selectedPoint, availableMonths, setSelectedYearMonth]);

    // Initialize current month on mount
    useEffect(() => {
        if (selectedMonth) return;

        const latest = availableMonths[availableMonths.length - 1];
        if (latest) {
            setSelectedYearMonth(latest);
            return;
        }
        const current = getCurrentMonth();
        setCurrentMonth(current);
        setSelectedYearMonth(`${current.year}-${current.month}`);
    }, [availableMonths, getCurrentMonth, selectedMonth, setSelectedYearMonth]);

    useEffect(() => {
        if (!selectedPoint || !selectedMonth) return;

        // Clear old routes when selecting new station or month
        setCachedRoutes(new Map());
        setRoutesLoading(0);
        setRoutesTotal(0);
        setStats(null);

        setLoadingRides(true);
        setSelectedRideIndex(0);
        setRouteData(null);

        if (selectedMonthImportStatus === 'queued' || selectedMonthImportStatus === 'running' || selectedMonthImportStatus === 'failed') {
            setRides([]);
            setLoadingRides(false);
            return;
        }

        // Build query string with required month filter
        const ridesUrl = new URL('/api/rides', window.location.origin);
        ridesUrl.searchParams.set('station_id', selectedPoint?.short_name);
        ridesUrl.searchParams.set('year_month', selectedMonth);

        // Fetch rides
        fetch(ridesUrl.toString())
            .then(res => res.json())
            .then((data: any) => {
                if (data.error) {
                    console.error('API Error:', data.error);
                    setRides([]);
                } else if (data.results && Array.isArray(data.results)) {
                    setRides(data.results);
                } else if (Array.isArray(data)) {
                    setRides(data);
                } else {
                    setRides([]);
                }
            })
            .catch(err => {
                console.error('Error fetching rides:', err);
                setRides([]);
            })
            .finally(() => setLoadingRides(false));

        // Fetch station stats (streams as they come in)
        const statsUrl = new URL('/api/station-stats', window.location.origin);
        statsUrl.searchParams.set('station_id', selectedPoint?.short_name);
        statsUrl.searchParams.set('year_month', selectedMonth);

        fetch(statsUrl.toString())
            .then(res => {
                if (!res.body) throw new Error('No response body');
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                const partialStats: Partial<StationStats> = {};

                const processStream = async () => {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.trim()) {
                                try {
                                    const message = JSON.parse(line) as { type: string; data?: any };

                                    if (message.type === 'stats' && message.data) {
                                        Object.assign(partialStats, message.data);
                                    } else if (message.type === 'rideableTypes' && message.data) {
                                        partialStats.rideableTypes = message.data;
                                    } else if (message.type === 'dayOfWeek' && message.data) {
                                        partialStats.dayOfWeek = message.data;
                                    } else if (message.type === 'destinations' && message.data) {
                                        partialStats.destinations = message.data;
                                    } else if (message.type === 'busiestHours' && message.data) {
                                        partialStats.busiestHours = message.data;
                                    } else if (message.type === 'complete') {
                                        // All stats loaded
                                        setStats(partialStats as StationStats);
                                    }

                                    // Update UI with partial stats as they arrive
                                    if (Object.keys(partialStats).length > 0 && message.type !== 'complete') {
                                        setStats(partialStats as StationStats);
                                    }
                                } catch {
                                    // Ignore parse errors
                                }
                            }
                        }
                    }
                };

                return processStream();
            })
            .catch(err => {
                console.error('Error fetching station stats:', err);
            });
    }, [selectedPoint, selectedMonth, selectedMonthImportStatus]);



    // Load all routes with concurrency limit and cancellation support
    useEffect(() => {
        if (!rides.length || loadingRides) return;

        const abortController = new AbortController();
        const signal = abortController.signal;

        const newCached = new Map(cachedRoutes);
        const cachedCount = 0;

        // Count rides that already have polylines in D1
        const cachedRides: Ride[] = [];
        const uncachedRides: Ride[] = [];

        rides.forEach((ride) => {
            if (ride.route_polyline && typeof ride.route_polyline === 'string' && ride.route_polyline.length > 0) {
                cachedRides.push(ride);
                if (map) map.triggerRepaint();
            } else {
                uncachedRides.push(ride);
            }
        });

        setRoutesTotal(rides.length);
        setRoutesLoading(0);
        setCachedRoutes(new Map());
        console.log('Routes loaded:', rides.length, 'Cached count:', cachedRides.length, 'Uncached count:', uncachedRides.length);

        // Group rides by route (start_station_id:end_station_id) to count duplicates
        const routeGroups = new Map<string, Ride[]>();
        cachedRides.forEach((ride) => {
            const routeKey = `${ride.start_station_id}:${ride.end_station_id}`;
            if (!routeGroups.has(routeKey)) {
                routeGroups.set(routeKey, []);
            }
            routeGroups.get(routeKey)!.push(ride);
        });

        // Add all cached routes immediately
        routeGroups.forEach((groupRides, routeKey) => {
            const ride = groupRides[0]; // Use first ride as template
            try {
                const geojsonGeometry = polyline.toGeoJSON(ride.route_polyline!);
                const routeData = {
                    coordinates: geojsonGeometry.coordinates,
                    duration: 0,
                    distance: 0,
                };
                newCached.set(routeKey, {
                    routeKey,
                    ...routeData,
                    endStationName: ride.end_station_name,
                    rideCount: groupRides.length,
                });
            } catch (err) {
                console.warn('Error converting polyline for route', routeKey, err);
            }
        });
        setCachedRoutes(newCached);
        setRoutesLoading(cachedRides.length);


        const uncachedRouteGroups = new Map<string, Ride[]>();
        uncachedRides.forEach((ride) => {
            const routeKey = `${ride.start_station_id}:${ride.end_station_id}`;
            if (!uncachedRouteGroups.has(routeKey)) {
                uncachedRouteGroups.set(routeKey, []);
            }
            uncachedRouteGroups.get(routeKey)!.push(ride);
        });
        const uncachedRouteEntries = Array.from(uncachedRouteGroups.entries());

        // Concurrency limiter - these requests go through /api/route, which checks KV/D1 route caches first.
        const concurrencyLimit = 20;
        let activeRequests = 0;
        let queueIndex = 0;

        const processQueue = () => {
            while (activeRequests < concurrencyLimit && queueIndex < uncachedRouteEntries.length) {
                const [routeKey, groupRides] = uncachedRouteEntries[queueIndex];
                const ride = groupRides[0];
                queueIndex++;

                let startStation = ride.start_station_id ? stationMap[ride.start_station_id] : undefined;
                 let endStation = ride.end_station_id ? stationMap[ride.end_station_id] : undefined;

                 // If stations not found by ID, try to find by name in stationMap
                 if (!startStation && ride.start_station_name) {
                     startStation = Object.values(stationMap).find(s => s.name === ride.start_station_name);
                 }
                 if (!endStation && ride.end_station_name) {
                     endStation = Object.values(stationMap).find(s => s.name === ride.end_station_name);
                 }

                 if (!startStation || !endStation) {
                      setRoutesLoading(prev => prev + groupRides.length);
                      continue;
                  }

                activeRequests++;

                const routeUrl = new URL('/api/route', window.location.origin);
                routeUrl.searchParams.set('start_lon', startStation.lon.toString());
                routeUrl.searchParams.set('start_lat', startStation.lat.toString());
                routeUrl.searchParams.set('end_lon', endStation.lon.toString());
                routeUrl.searchParams.set('end_lat', endStation.lat.toString());
                routeUrl.searchParams.set('start_station_id', ride.start_station_id || '');
                routeUrl.searchParams.set('end_station_id', ride.end_station_id || '');
                routeUrl.searchParams.set('ride_id', ride.ride_id);
                routeUrl.searchParams.set('year_month', selectedMonth);

                const requestController = new AbortController();
                let timedOut = false;
                const abortRequest = () => requestController.abort();
                const timeout = window.setTimeout(() => {
                    timedOut = true;
                    requestController.abort();
                }, 8_000);
                signal.addEventListener('abort', abortRequest, { once: true });

                // Fetch from API (will check D1/KV cache and save if needed)
                fetch(routeUrl.toString(), { signal: requestController.signal })
                    .then(res => res.json())
                    .then((data: any) => {
                        if (signal.aborted) return;

                        if (data.routes?.length > 0) {
                            const route = data.routes[0];
                            const routeData = {
                                coordinates: route.geometry.coordinates,
                                duration: route.duration,
                                distance: route.distance,
                            };

                            newCached.set(routeKey, {
                                routeKey,
                                ...routeData,
                                endStationName: ride.end_station_name,
                                rideCount: groupRides.length,
                            });
                            console.log('Added route for ride', ride.ride_id, 'between', routeKey);
                            setCachedRoutes(new Map(newCached));
                            if (map) map.triggerRepaint();

                            setRoutesLoading(prev => prev + groupRides.length);
                        } else {
                            console.warn('No routes in response for ride', ride.ride_id, data);
                            setRoutesLoading(prev => prev + groupRides.length);
                        }
                    })
                    .catch(err => {
                        if (signal.aborted) return;
                        if (err.name === 'AbortError' && timedOut) {
                            console.warn('Route request timed out for ride', ride.ride_id);
                        } else {
                            console.error('Error fetching route for ride', ride.ride_id, err);
                        }
                        setRoutesLoading(prev => prev + groupRides.length);
                    })
                    .finally(() => {
                        window.clearTimeout(timeout);
                        signal.removeEventListener('abort', abortRequest);
                        activeRequests--;
                        if (!signal.aborted) {
                            processQueue();
                        }
                    });
            }
        };

        processQueue();

        return () => {
            abortController.abort();
        };
    }, [rides, loadingRides, stationMap, selectedPoint?.id, selectedMonth]);

    useEffect(() => {
        // Trigger repaint when cachedRoutes changes to ensure deck.gl updates
        if (map) {
            map.triggerRepaint();
        }
    }, [cachedRoutes]);

    return (
         <>
             {/* Ping animation marker on selected station */}
            {selectedPoint && (
                <MapMarker
                    longitude={selectedPoint.coordinates[0]}
                    latitude={selectedPoint.coordinates[1]}
                >
                    <MarkerContent>
                        <div className="relative w-6 h-6">
                            <div className="absolute inset-0 bg-white rounded-full animate-ping opacity-75" />
                            <div className="absolute inset-0 bg-white rounded-full" />
                        </div>
                    </MarkerContent>
                </MapMarker>
            )}

            {/* Display all routes with deck.gl for better performance */}
             {selectedPoint && cachedRoutes.size > 0 && (
                 <DeckGLRoutes
                     routes={cachedRoutes}
                     color={[255, 255, 255, 255]} // white
                     width={3}
                     opacity={153} // 0.6 * 255
                 />
             )}


            {/* Station info drawer */}
                <Drawer
                    open={drawerOpen}
                    onOpenChange={setDrawerOpen}
                    direction={isDesktop ? "left" : undefined}
                    modal={false}
                    dismissible={false}
                    disablePreventScroll={true}
                    {...(!isDesktop && {
                        snapPoints: snapPoints,
                        activeSnapPoint: snap,
                        setActiveSnapPoint: setSnap
                    })}
                >
                    <DrawerContent className={`${isDesktop ? 'p-4 w-96 overflow-y-auto max-h-screen' : 'w-full mx-auto px-4 pb-4 overflow-y-scroll'}`}>
                        <DrawerTitle className="sr-only">{selectedPoint?.name || 'Station Info'}</DrawerTitle>
                        {selectedPoint ? (
                            <StationInfoContent
                                stationName={selectedPoint.name}
                                ridesCount={rides.length}
                                selectedMonth={selectedMonth}
                                selectedYear={selectedYear}
                                selectedMonthNum={selectedMonthNum}
                                stats={stats}
                                loadingRides={loadingRides}
                                routesLoading={routesLoading}
                                routesTotal={routesTotal}
                                selectedMonthImportStatus={selectedMonthImportStatus}
                                isCurrentMonth={isCurrentMonth()}
                                availableMonths={availableMonths}
                                onPreviousMonth={handlePreviousMonth}
                                onNextMonth={handleNextMonth}
                                onMonthChange={handleMonthChange}
                                onRefreshMonths={refreshAvailableMonths}
                            />
                        ) : (
                            <AboutInfo
                                isDesktop={isDesktop}
                                importProgress={importProgress}
                                loadingImportProgress={loadingImportProgress}
                            />
                        )}

                        <div className="mt-8 pt-6">
                            <div className="text-xs text-muted-foreground space-y-2">
                                <div>
                                    {selectedPoint && (
                                        <a href="#" className="text-blue-400 hover:text-blue-300 transition-colors"

                                           onClick={(e) => {
                                               e.preventDefault();
                                               // unselect station
                                               setSelectedPoint(null);
                                           }}
                                        >
                                            About <span className="mx-2">·</span>
                                        </a>
                                    )}
                                    <span>Not affiliated with BayWheels, Lyft, MTC, or Motivate.</span>
                                </div>
                                <div>
                                    <span><a href={"https://samjeffs.net"} target={'_blank'}>made with ♥️ in 🌉 by sam 🐱</a></span>
                                </div>
                            </div>
                        </div>
                    </DrawerContent>
                </Drawer>
        </>
    );
}
