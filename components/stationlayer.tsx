'use client'
import * as baywheelStations from "@/data/baywheels_station_information.json"
import {gbfsStationInfoToGeoJSON} from "@/utils/gbfsStationInfoToGeoJSON";
import { polyline } from "@/lib/polyline";
import { Layers, X, Loader2, Clock, Route, ChevronUp, ChevronDown, Link } from "lucide-react";
import { useCallback, useEffect, useState, useId } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useMap, MapPopup, MapMarker, MarkerContent, MarkerLabel } from "@/components/ui/map";
import { DeckGLRoutes } from "@/components/deck-gl-routes";
import { StationInfoContent } from "@/components/station-info-content";
import { Drawer, DrawerTrigger, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { AboutInfo } from "@/components/about-info";

interface Ride {
    ride_id: string;
    rideable_type: string;
    started_at: string;
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
    rideId: string;
    coordinates: [number, number][];
    duration: number;
    distance: number;
    endStationName: string;
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
     const [selectedYear, setSelectedYear] = useState<string>('');
     const [selectedMonthNum, setSelectedMonthNum] = useState<string>('');
     const [drawerOpen, setDrawerOpen] = useState(true);
     const selectedMonth = selectedYear && selectedMonthNum ? `${selectedYear}-${selectedMonthNum}` : '';

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
         const current = getCurrentMonth();
         return selectedYear === current.year && selectedMonthNum === current.month;
     }, [selectedYear, selectedMonthNum, getCurrentMonth]);

     const handlePreviousMonth = () => {
         let year = parseInt(selectedYear);
         let month = parseInt(selectedMonthNum);

         month--;
         if (month === 0) {
             month = 12;
             year--;
         }

         setSelectedYear(year.toString());
         setSelectedMonthNum(month.toString().padStart(2, '0'));
     };

     const handleNextMonth = () => {
         let year = parseInt(selectedYear);
         let month = parseInt(selectedMonthNum);

         month++;
         if (month === 13) {
             month = 1;
             year++;
         }

         setSelectedYear(year.toString());
         setSelectedMonthNum(month.toString().padStart(2, '0'));
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


    // Reset to current month when station is selected
    useEffect(() => {
        if (selectedPoint) {
            const current = getCurrentMonth();
            setSelectedYear(current.year);
            setSelectedMonthNum(current.month);
        }
    }, [selectedPoint, getCurrentMonth]);

    // Initialize current month on mount
    useEffect(() => {
        const current = getCurrentMonth();
        setCurrentMonth(current);
        setSelectedYear(current.year);
        setSelectedMonthNum(current.month);
    }, [getCurrentMonth]);

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
    }, [selectedPoint, selectedMonth]);



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
            } else {
                uncachedRides.push(ride);
            }
        });

        setRoutesTotal(rides.length);
        setRoutesLoading(0);
        setCachedRoutes(new Map());
        console.log('Routes loaded:', rides.length, 'Cached count:', cachedRides.length, 'Uncached count:', uncachedRides.length);

        // Add all cached routes immediately
        cachedRides.forEach((ride) => {
            try {
                const geojsonGeometry = polyline.toGeoJSON(ride.route_polyline!);
                const routeData = {
                    coordinates: geojsonGeometry.coordinates,
                    duration: 0,
                    distance: 0,
                };
                newCached.set(ride.ride_id, {
                    rideId: ride.ride_id,
                    ...routeData,
                    endStationName: ride.end_station_name,
                });
            } catch (err) {
                console.warn('Error converting polyline for ride', ride.ride_id, err);
            }
        });
        setCachedRoutes(newCached);
        setRoutesLoading(cachedRides.length);
        if (map) map.triggerRepaint();

        // Concurrency limiter - limit to 10 parallel requests for uncached routes only
        const concurrencyLimit = 10;
        let activeRequests = 0;
        let queueIndex = 0;

        const processQueue = () => {
            while (activeRequests < concurrencyLimit && queueIndex < uncachedRides.length) {
                const ride = uncachedRides[queueIndex];
                queueIndex++;

                if (!ride.start_station_id || !ride.end_station_id) {
                    setRoutesLoading(prev => prev + 1);
                    continue;
                }

                const startStation = stationMap[ride.start_station_id];
                const endStation = stationMap[ride.end_station_id];

                if (!startStation || !endStation) {
                    setRoutesLoading(prev => prev + 1);
                    continue;
                }

                activeRequests++;

                // Fetch from API (will check D1 cache and save if needed)
                fetch(
                    `/api/route?start_lon=${startStation.lon}&start_lat=${startStation.lat}&end_lon=${endStation.lon}&end_lat=${endStation.lat}&ride_id=${encodeURIComponent(ride.ride_id)}`,
                    { signal }
                )
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

                            newCached.set(ride.ride_id, {
                                rideId: ride.ride_id,
                                ...routeData,
                                endStationName: ride.end_station_name,
                            });
                            console.log('Added route for ride', ride.ride_id, 'Cache size now:', newCached.size);
                            setCachedRoutes(new Map(newCached));
                            if (map) map.triggerRepaint();

                            setRoutesLoading(prev => prev + 1);
                        } else {
                            console.warn('No routes in response for ride', ride.ride_id, data);
                        }
                    })
                    .catch(err => {
                        if (err.name === 'AbortError') return;
                        console.error('Error fetching route:', err);
                        setRoutesLoading(prev => prev + 1);
                    })
                    .finally(() => {
                        activeRequests--;
                        processQueue();
                    });
            }
        };

        processQueue();

        return () => {
            abortController.abort();
        };
    }, [rides, loadingRides, stationMap, selectedPoint?.id]);

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
                                isCurrentMonth={isCurrentMonth()}
                                onPreviousMonth={handlePreviousMonth}
                                onNextMonth={handleNextMonth}
                            />
                        ) : (
                            <AboutInfo isDesktop={isDesktop} />
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
